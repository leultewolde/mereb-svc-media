import {
  buildKafkaConfigFromEnv,
  createIntegrationEventEnvelope,
  createKafkaIntegrationEventPublisher,
  createLogger,
  type IntegrationEventEnvelope,
  type IntegrationEventPublisher
} from '@mereb/shared-packages';
import { PrismaMediaOutboxRelayStore } from '../adapters/outbound/prisma/media-prisma-asset-repository.js';
import {
  recordMediaOutboxFlushMetrics,
  setMediaOutboxQueueDepth
} from './outbox-metrics.js';

const logger = createLogger('svc-media-outbox-relay');

export interface MediaOutboxRelayStartOptions {
  unrefTimer?: boolean;
  intervalMs?: number;
}

export interface MediaOutboxFlushOptions {
  limit?: number;
  store?: PrismaMediaOutboxRelayStore;
  publisher?: IntegrationEventPublisher;
}

function isRelayEnabled(): boolean {
  if ((process.env.MEDIA_EVENTS_ENABLED ?? 'false') !== 'true') {
    return false;
  }
  return (process.env.MEDIA_OUTBOX_RELAY_ENABLED ?? 'true') === 'true';
}

function isDlqEnabled(): boolean {
  return (process.env.MEDIA_OUTBOX_DLQ_ENABLED ?? 'false') === 'true';
}

function getRelayIntervalMs(fallback?: number): number {
  const value = fallback ?? Number(process.env.MEDIA_OUTBOX_RELAY_INTERVAL_MS ?? 5000);
  if (!Number.isFinite(value) || value < 250) {
    return 5000;
  }
  return Math.floor(value);
}

function getMaxAttempts(): number {
  const value = Number(process.env.MEDIA_OUTBOX_MAX_ATTEMPTS ?? 10);
  if (!Number.isFinite(value) || value < 1) {
    return 10;
  }
  return Math.floor(value);
}

function retryDelayMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts, 1), 6);
  return Math.min(60_000, 1000 * (2 ** exponent));
}

function resolveDlqTopic(topic: string): string {
  return process.env.MEDIA_OUTBOX_DLQ_TOPIC ?? `${topic}.dlq`;
}

async function updateQueueDepthMetrics(store: PrismaMediaOutboxRelayStore): Promise<void> {
  try {
    const counts = await store.countByStatus();
    setMediaOutboxQueueDepth(counts);
  } catch (error) {
    logger.warn({ err: error }, 'Failed to refresh media outbox queue depth metrics');
  }
}

async function publishToDlq(
  topic: string,
  event: {
    id: string;
    eventType: string;
    eventKey: string | null;
    attempts: number;
    envelope: IntegrationEventEnvelope<unknown>;
  },
  errorMessage: string
): Promise<void> {
  const config = buildKafkaConfigFromEnv({ clientId: 'svc-media-outbox-relay-dlq' });
  if (!config) {
    throw new Error('Kafka config missing for media DLQ publish');
  }

  const publisher = createKafkaIntegrationEventPublisher(config);
  const dlqTopic = resolveDlqTopic(topic);
  const dlqEnvelope = createIntegrationEventEnvelope({
    eventType: `${event.eventType}.dead_lettered`,
    producer: 'svc-media-outbox-relay',
    data: {
      outbox_id: event.id,
      original_topic: topic,
      original_event_type: event.eventType,
      original_event_key: event.eventKey,
      attempts: event.attempts,
      error: errorMessage,
      failed_at: new Date().toISOString(),
      envelope: event.envelope
    }
  });

  await publisher.publish(dlqTopic, dlqEnvelope, {
    key: event.eventKey ?? event.id
  });
}

async function flushOnce(
  limit = 50,
  store = new PrismaMediaOutboxRelayStore(),
  publisherOverride?: IntegrationEventPublisher
): Promise<void> {
  const publisher =
    publisherOverride ??
    (() => {
      const config = buildKafkaConfigFromEnv({ clientId: 'svc-media-outbox-relay' });
      if (!config) {
        logger.warn('Media outbox relay enabled but Kafka config is missing; skipping flush');
        return null;
      }
      return createKafkaIntegrationEventPublisher(config);
    })();
  if (!publisher) {
    return;
  }
  const due = await store.listDue(limit);
  const maxAttempts = getMaxAttempts();

  if (due.length === 0) {
    await updateQueueDepthMetrics(store);
    return;
  }

  let publishedCount = 0;
  let retryScheduledCount = 0;
  let terminalFailureCount = 0;
  let skippedCount = 0;

  for (const event of due) {
    const claimed = await store.claim(event.id);
    if (!claimed) {
      skippedCount += 1;
      continue;
    }

    try {
      await publisher.publish(
        event.topic,
        event.envelope as IntegrationEventEnvelope<unknown>,
        { key: event.eventKey ?? undefined }
      );
      await store.markPublished(event.id);
      publishedCount += 1;
    } catch (error) {
      const attempt = event.attempts + 1;
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const shouldStopRetrying = attempt >= maxAttempts;

      if (shouldStopRetrying) {
        let deadLetterTopic: string | null = null;

        if (isDlqEnabled()) {
          try {
            deadLetterTopic = resolveDlqTopic(event.topic);
            await publishToDlq(event.topic, { ...event, attempts: attempt }, message);
          } catch (dlqError) {
            logger.error(
              {
                err: dlqError,
                outboxId: event.id,
                topic: event.topic,
                eventType: event.eventType,
                attempts: attempt
              },
              'Failed to publish media outbox event to DLQ'
            );
            deadLetterTopic = null;
          }
        }

        terminalFailureCount += 1;
        await store.markDeadLetter(
          event.id,
          `[DEAD_LETTER after ${attempt} attempts] ${message}`,
          { deadLetteredAt: new Date(), deadLetterTopic }
        );
        logger.error(
          {
            err: error,
            outboxId: event.id,
            topic: event.topic,
            eventType: event.eventType,
            attempts: attempt,
            maxAttempts,
            deadLetterTopic
          },
          'Media outbox event reached max attempts and was moved to DEAD_LETTER'
        );
      } else {
        retryScheduledCount += 1;
        await store.markFailed(
          event.id,
          message,
          new Date(Date.now() + retryDelayMs(attempt))
        );
        logger.warn(
          {
            err: error,
            outboxId: event.id,
            topic: event.topic,
            eventType: event.eventType,
            attempts: attempt,
            maxAttempts
          },
          'Failed to publish media outbox event; retry scheduled'
        );
      }
    }
  }

  await updateQueueDepthMetrics(store);
  recordMediaOutboxFlushMetrics({
    batchSize: due.length,
    publishedCount,
    retryScheduledCount,
    terminalFailureCount,
    skippedCount
  });

  logger.info(
    {
      batchSize: due.length,
      publishedCount,
      retryScheduledCount,
      terminalFailureCount,
      skippedCount,
      maxAttempts
    },
    'Media outbox relay flush completed'
  );
}

export async function flushMediaOutboxOnce(
  input: MediaOutboxFlushOptions = {}
): Promise<void> {
  await flushOnce(input.limit ?? 50, input.store, input.publisher);
}

export function startMediaOutboxRelay(options: MediaOutboxRelayStartOptions = {}): () => void {
  if (!isRelayEnabled()) {
    return () => {};
  }

  const intervalMs = getRelayIntervalMs(options.intervalMs);
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await flushOnce();
    } catch (error) {
      logger.error({ err: error }, 'Unexpected error in media outbox relay');
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (options.unrefTimer !== false) {
    timer.unref?.();
  }

  logger.info({ intervalMs }, 'Media outbox relay started');

  return () => clearInterval(timer);
}

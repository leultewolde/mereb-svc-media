import {
  buildKafkaConfigFromEnv,
  createIntegrationEventEnvelope,
  createLogger,
  getProducer
} from '@mereb/shared-packages';
import type { MediaEventPublisherPort } from '../../../application/media/ports.js';
import {
  MEDIA_EVENT_TOPICS,
  type MediaAssetReadyEventData,
  type MediaUploadRequestedEventData
} from '../../../contracts/media-events.js';

type KafkaConfig = NonNullable<ReturnType<typeof buildKafkaConfigFromEnv>>;

const logger = createLogger('svc-media-events');

function isEnabled(): boolean {
  return (process.env.MEDIA_EVENTS_ENABLED ?? 'false') === 'true';
}

class NoopMediaEventPublisherAdapter implements MediaEventPublisherPort {
  async publishUploadRequested(): Promise<void> {
    return;
  }

  async publishAssetReady(): Promise<void> {
    return;
  }
}

class KafkaMediaEventPublisherAdapter implements MediaEventPublisherPort {
  constructor(private readonly config: KafkaConfig) {}

  async publishUploadRequested(input: {
    assetId: string;
    ownerId: string;
    kind: string;
    s3Key: string;
    occurredAt?: Date;
  }): Promise<void> {
    await this.publish<MediaUploadRequestedEventData>({
      topic: MEDIA_EVENT_TOPICS.uploadRequested,
      eventType: MEDIA_EVENT_TOPICS.uploadRequested,
      key: input.assetId,
      occurredAt: input.occurredAt,
      data: {
        asset_id: input.assetId,
        owner_id: input.ownerId,
        kind: input.kind,
        s3_key: input.s3Key
      }
    });
  }

  async publishAssetReady(input: {
    assetId: string;
    ownerId: string;
    status: string;
    s3Key: string;
    occurredAt?: Date;
  }): Promise<void> {
    await this.publish<MediaAssetReadyEventData>({
      topic: MEDIA_EVENT_TOPICS.assetReady,
      eventType: MEDIA_EVENT_TOPICS.assetReady,
      key: input.assetId,
      occurredAt: input.occurredAt,
      data: {
        asset_id: input.assetId,
        owner_id: input.ownerId,
        status: input.status,
        s3_key: input.s3Key
      }
    });
  }

  private async publish<TData>(input: {
    topic: string;
    eventType: string;
    key: string;
    data: TData;
    occurredAt?: Date;
  }): Promise<void> {
    try {
      const producer = await getProducer(this.config);
      const envelope = createIntegrationEventEnvelope({
        eventType: input.eventType,
        producer: 'svc-media',
        data: input.data,
        occurredAt: input.occurredAt
      });

      await producer.send({
        topic: input.topic,
        messages: [{ key: input.key, value: JSON.stringify(envelope) }]
      });
    } catch (error) {
      logger.warn(
        {
          err: error,
          topic: input.topic,
          eventType: input.eventType
        },
        'Failed to publish media integration event'
      );
    }
  }
}

export function createMediaEventPublisherAdapter(): MediaEventPublisherPort {
  if (!isEnabled()) {
    return new NoopMediaEventPublisherAdapter();
  }

  const config = buildKafkaConfigFromEnv({ clientId: 'svc-media' });
  if (!config) {
    logger.warn(
      'MEDIA_EVENTS_ENABLED=true but Kafka config missing; media event publishing disabled'
    );
    return new NoopMediaEventPublisherAdapter();
  }

  return new KafkaMediaEventPublisherAdapter(config);
}

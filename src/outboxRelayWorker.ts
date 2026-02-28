import {
  buildKafkaConfigFromEnv,
  createLogger,
  initDefaultTelemetry,
  loadEnv
} from '@mereb/shared-packages';
import { startMediaOutboxRelay } from './bootstrap/outbox-relay.js';

const logger = createLogger('svc-media-outbox-worker');

function waitForShutdown(stop: () => void): Promise<void> {
  return new Promise((resolve) => {
    let stopping = false;
    const handleSignal = (signal: NodeJS.Signals) => {
      if (stopping) {
        return;
      }
      stopping = true;
      logger.info({ signal }, 'Shutting down media outbox relay worker');
      stop();
      resolve();
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
  });
}

loadEnv();
initDefaultTelemetry('svc-media-outbox-relay');

if ((process.env.MEDIA_EVENTS_ENABLED ?? 'false') !== 'true') {
  logger.error('MEDIA_EVENTS_ENABLED must be true for outbox relay worker');
  process.exit(1);
}

if ((process.env.MEDIA_OUTBOX_RELAY_ENABLED ?? 'true') !== 'true') {
  logger.error('MEDIA_OUTBOX_RELAY_ENABLED=false; dedicated outbox relay worker will not start');
  process.exit(1);
}

if (!buildKafkaConfigFromEnv({ clientId: 'svc-media-outbox-relay' })) {
  logger.error('Kafka config missing; cannot start media outbox relay worker');
  process.exit(1);
}

try {
  const stop = startMediaOutboxRelay({ unrefTimer: false });
  logger.info('Media outbox relay worker started');
  await waitForShutdown(stop);
} catch (error) {
  logger.error({ err: error }, 'Failed to start media outbox relay worker');
  process.exit(1);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '../generated/client/index.js';
import { createMediaApplicationModule } from '../src/application/media/use-cases.js';
import {
  PrismaMediaAssetRepository,
  PrismaMediaOutboxRelayStore,
  PrismaMediaTransactionRunner
} from '../src/adapters/outbound/prisma/media-prisma-asset-repository.js';
import { MEDIA_EVENT_TOPICS } from '../src/contracts/media-events.js';
import { flushMediaOutboxOnce } from '../src/bootstrap/outbox-relay.js';
import {
  ensureKafkaTopicExists,
  createSocketForwardKafkaPublisher,
  createTemporarySchemaName,
  dropSchema,
  installDnsOverride,
  provisionSchema,
  runPrismaMigrateDeploy,
  waitForKafkaMessage,
  withSchema
} from '../../../scripts/test-support/db-kafka-integration.mjs';

test('requestUpload writes to outbox and publishes to Kafka', { timeout: 30_000 }, async () => {
  const adminUrl =
    process.env.MEDIA_INTEGRATION_DATABASE_ADMIN_URL ??
    'postgresql://postgres:postgres@localhost:5432/mereb-db?schema=public';
  const baseServiceUrl =
    process.env.MEDIA_INTEGRATION_DATABASE_URL ??
    'postgresql://svc_media_rw:svc_media_rw@localhost:5432/mereb-db?schema=svc_media';
  const schemaOwner = process.env.MEDIA_INTEGRATION_SCHEMA_OWNER ?? 'svc_media_rw';
  const brokers = (
    process.env.MEDIA_INTEGRATION_KAFKA_BROKERS ??
    process.env.KAFKA_BROKERS ??
    'localhost:9092'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const schema = createTemporarySchemaName('svc_media_it');
  const databaseUrl = withSchema(baseServiceUrl, schema);
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let prisma: PrismaClient | null = null;
  let publisherHandle:
    | Awaited<ReturnType<typeof createSocketForwardKafkaPublisher>>
    | null = null;
  const restoreDns = installDnsOverride(
    brokers.map((broker) => broker.split(':')[0] ?? broker)
  );
  const useRpkConsumer = Boolean(
    process.env.KAFKA_RPK_NAMESPACE &&
      process.env.KAFKA_RPK_POD &&
      process.env.KAFKA_RPK_BROKER
  );

  const previousKafkaBrokers = process.env.KAFKA_BROKERS;
  const previousKafkaSsl = process.env.KAFKA_SSL;
  const previousKafkaPortForwardHost = process.env.KAFKA_PORT_FORWARD_HOST;
  const previousKafkaPortForwardPort = process.env.KAFKA_PORT_FORWARD_PORT;

  try {
    await provisionSchema(admin, { schema, ownerRole: schemaOwner });
    await runPrismaMigrateDeploy({
      serviceDir: 'services/svc-media',
      databaseUrl
    });

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const assets = new PrismaMediaAssetRepository(prisma);
    const transactionRunner = new PrismaMediaTransactionRunner(prisma);
    const media = createMediaApplicationModule({
      assets,
      uploadKeyGenerator: {
        createUploadKey(ownerId, filename) {
          return `uploads/${ownerId}/${filename}`;
        }
      },
      uploadUrlSigner: {
        async createPutUrl(key, contentType) {
          return `put:${key}:${contentType}`;
        }
      },
      mediaUrlSigner: {
        signMediaUrl(key) {
          return `get:${key}`;
        }
      },
      transactionRunner
    });

    let expectedAssetId = '';
    delete process.env.KAFKA_PORT_FORWARD_HOST;
    delete process.env.KAFKA_PORT_FORWARD_PORT;
    const consumeMessage = useRpkConsumer
      ? null
      : waitForKafkaMessage({
          brokers,
          topic: MEDIA_EVENT_TOPICS.uploadRequested,
          groupId: `svc-media-it-${schema}`,
          predicate: ({ value }) => {
            const parsed = JSON.parse(value) as { data?: { asset_id?: string } };
            return parsed.data?.asset_id === expectedAssetId;
          }
        });

    const response = await media.commands.requestUpload.execute(
      { filename: 'avatar.png', contentType: 'image/png' },
      media.helpers.toExecutionContext('user-1')
    );
    expectedAssetId = response.assetId;

    const store = new PrismaMediaOutboxRelayStore(prisma);
    const pendingBefore = await store.listDue(10);
    assert.equal(pendingBefore.length, 1);

    await ensureKafkaTopicExists(MEDIA_EVENT_TOPICS.uploadRequested);
    publisherHandle = await createSocketForwardKafkaPublisher({
      brokers,
      clientId: `svc-media-it-publisher-${schema}`,
      forwardHost: '127.0.0.1',
      forwardPort: 19092,
      sslInsecure: true
    });

    await flushMediaOutboxOnce({
      limit: 10,
      store,
      publisher: publisherHandle.publisher
    });
    const message = useRpkConsumer
      ? await waitForKafkaMessage({
          brokers,
          topic: MEDIA_EVENT_TOPICS.uploadRequested,
          groupId: `svc-media-it-${schema}`,
          predicate: ({ value }) => {
            const parsed = JSON.parse(value) as { data?: { asset_id?: string } };
            return parsed.data?.asset_id === expectedAssetId;
          }
        })
      : await consumeMessage;
    const envelope = JSON.parse(message.value) as {
      event_type: string;
      data: { asset_id: string };
    };

    assert.equal(envelope.event_type, MEDIA_EVENT_TOPICS.uploadRequested);
    assert.equal(envelope.data.asset_id, response.assetId);

    const row = await prisma.outboxEvent.findUnique({
      where: { id: pendingBefore[0]?.id ?? '' }
    });
    assert.equal(row?.status, 'PUBLISHED');
  } finally {
    if (previousKafkaBrokers === undefined) {
      delete process.env.KAFKA_BROKERS;
    } else {
      process.env.KAFKA_BROKERS = previousKafkaBrokers;
    }

    if (previousKafkaSsl === undefined) {
      delete process.env.KAFKA_SSL;
    } else {
      process.env.KAFKA_SSL = previousKafkaSsl;
    }

    if (previousKafkaPortForwardHost === undefined) {
      delete process.env.KAFKA_PORT_FORWARD_HOST;
    } else {
      process.env.KAFKA_PORT_FORWARD_HOST = previousKafkaPortForwardHost;
    }

    if (previousKafkaPortForwardPort === undefined) {
      delete process.env.KAFKA_PORT_FORWARD_PORT;
    } else {
      process.env.KAFKA_PORT_FORWARD_PORT = previousKafkaPortForwardPort;
    }

    if (prisma) {
      await prisma.$disconnect();
    }
    if (publisherHandle) {
      await publisherHandle.disconnect();
    }
    await dropSchema(admin, schema);
    await admin.$disconnect();
    restoreDns();
  }
});

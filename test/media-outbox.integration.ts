import assert from 'node:assert/strict';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, test } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import {
  createKafkaIntegrationEventPublisher,
  disconnectProducer
} from '@mereb/shared-packages';
import {
  createTemporarySchemaName,
  dropSchema,
  provisionSchema,
  runPrismaMigrateDeploy,
  withSchema
} from '@mereb/shared-packages/testing/db';
import {
  ensureKafkaTopicExists,
  waitForKafkaTopicMessages
} from '@mereb/shared-packages/testing/kafka';
import { PrismaClient } from '../generated/client/index.js';
import {
  PrismaMediaAssetRepository,
  PrismaMediaOutboxRelayStore,
  PrismaMediaTransactionRunner
} from '../src/adapters/outbound/prisma/media-prisma-asset-repository.js';
import { createMediaApplicationModule } from '../src/application/media/use-cases.js';
import { flushMediaOutboxOnce } from '../src/bootstrap/outbox-relay.js';
import { MEDIA_EVENT_TOPICS } from '../src/contracts/media-events.js';

const serviceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseName = 'mereb-db';
const roleName = 'svc_media_rw';

type StartedContainer = Awaited<ReturnType<GenericContainer['start']>>;

let postgresContainer: StartedContainer | null = null;
let redpandaContainer: StartedContainer | null = null;

beforeAll(async () => {
  postgresContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_DB: databaseName,
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'postgres'
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections'))
    .start();

  redpandaContainer = await new GenericContainer('redpandadata/redpanda:v24.1.11')
    .withCommand([
      'redpanda',
      'start',
      '--overprovisioned',
      '--smp',
      '1',
      '--memory',
      '1G',
      '--reserve-memory',
      '0M',
      '--node-id',
      '0',
      '--check=false'
    ])
    .withExposedPorts(9092)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
}, 180_000);

afterAll(async () => {
  await disconnectProducer().catch(() => undefined);
  if (redpandaContainer) {
    await redpandaContainer.stop();
  }
  if (postgresContainer) {
    await postgresContainer.stop();
  }
}, 180_000);

function getAdminDatabaseUrl(): string {
  if (!postgresContainer) {
    throw new Error('Postgres container not started');
  }

  return `postgresql://postgres:postgres@${postgresContainer.getHost()}:${postgresContainer.getMappedPort(5432)}/${databaseName}?schema=public`;
}

function getBaseServiceDatabaseUrl(): string {
  if (!postgresContainer) {
    throw new Error('Postgres container not started');
  }

  return `postgresql://${roleName}:${roleName}@${postgresContainer.getHost()}:${postgresContainer.getMappedPort(5432)}/${databaseName}?schema=svc_media`;
}

function getKafkaConfig(): Parameters<typeof createKafkaIntegrationEventPublisher>[0] {
  if (!redpandaContainer) {
    throw new Error('Redpanda container not started');
  }

  const host = redpandaContainer.getHost();
  const port = redpandaContainer.getMappedPort(9092);

  return {
    clientId: 'svc-media-it',
    brokers: [`${host}:${port}`],
    socketFactory: ({ onConnect }) => net.connect({ host, port }, onConnect)
  };
}

async function ensureServiceRole(admin: PrismaClient): Promise<void> {
  await admin.$executeRawUnsafe(`
    DO $role$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
        CREATE ROLE ${roleName} LOGIN PASSWORD '${roleName}';
      ELSE
        ALTER ROLE ${roleName} WITH LOGIN PASSWORD '${roleName}';
      END IF;
    END
    $role$;
  `);
  await admin.$executeRawUnsafe(
    `GRANT CONNECT ON DATABASE "${databaseName}" TO ${roleName}`
  );
}

test(
  'requestUpload writes an outbox event and publishes it to Kafka',
  { timeout: 180_000 },
  async () => {
    const schema = createTemporarySchemaName('svc_media_it');
    const databaseUrl = withSchema(getBaseServiceDatabaseUrl(), schema);
    const kafkaConfig = getKafkaConfig();
    const admin = new PrismaClient({
      datasources: {
        db: {
          url: getAdminDatabaseUrl()
        }
      }
    });
    let prisma: PrismaClient | null = null;

    try {
      await ensureServiceRole(admin);
      await provisionSchema(admin, { schema, ownerRole: roleName });
      await runPrismaMigrateDeploy({
        cwd: serviceDir,
        databaseUrl
      });

      prisma = new PrismaClient({
        datasources: {
          db: {
            url: databaseUrl
          }
        }
      });

      const media = createMediaApplicationModule({
        assets: new PrismaMediaAssetRepository(prisma),
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
        uploadedObjectInspector: {
          async inspectUploadedObject() {
            return null;
          }
        },
        mediaUrlSigner: {
          signMediaUrl(key) {
            return `get:${key}`;
          }
        },
        transactionRunner: new PrismaMediaTransactionRunner(prisma)
      });

      const response = await media.commands.requestUpload.execute(
        { filename: 'avatar.png', contentType: 'image/png' },
        media.helpers.toExecutionContext('user-1')
      );

      const asset = await prisma.mediaAsset.findUnique({
        where: { id: response.assetId }
      });
      assert.equal(asset?.ownerId, 'user-1');

      const store = new PrismaMediaOutboxRelayStore(prisma);
      const pendingBefore = await store.listDue(10);
      assert.equal(pendingBefore.length, 1);
      assert.equal(pendingBefore[0]?.topic, MEDIA_EVENT_TOPICS.uploadRequested);
      assert.equal(
        (pendingBefore[0]?.envelope.data as { asset_id?: string } | undefined)?.asset_id,
        response.assetId
      );

      await ensureKafkaTopicExists({
        ...kafkaConfig,
        topic: MEDIA_EVENT_TOPICS.uploadRequested
      });

      await flushMediaOutboxOnce({
        limit: 10,
        store,
        publisher: createKafkaIntegrationEventPublisher(kafkaConfig)
      });

      const messageCount = await waitForKafkaTopicMessages({
        ...kafkaConfig,
        topic: MEDIA_EVENT_TOPICS.uploadRequested,
        minMessages: 1
      });
      assert.equal(messageCount, 1);

      const row = await prisma.outboxEvent.findUnique({
        where: { id: pendingBefore[0]?.id ?? '' }
      });
      assert.equal(row?.status, 'PUBLISHED');
    } finally {
      await disconnectProducer().catch(() => undefined);
      if (prisma) {
        await prisma.$disconnect();
      }
      await dropSchema(admin, schema);
      await admin.$disconnect();
    }
  }
);

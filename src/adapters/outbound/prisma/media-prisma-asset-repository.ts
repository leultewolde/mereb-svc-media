import {
  createIntegrationEventEnvelope,
  type IntegrationEventEnvelope
} from '@mereb/shared-packages';
import { prisma } from '../../../prisma.js';
import type {
  MediaAssetRepositoryPort,
  MediaEventPublisherPort,
  MediaMutationPorts,
  MediaTransactionPort
} from '../../../application/media/ports.js';
import { MEDIA_EVENT_TOPICS } from '../../../contracts/media-events.js';
import type {
  CreatePendingMediaAssetDraft,
  MediaAssetRecord
} from '../../../domain/media/asset.js';
import { OutboxEventStatus, type Prisma, type PrismaClient } from '../../../../generated/client/index.js';

type MediaPrismaDb = PrismaClient | Prisma.TransactionClient;

function toMediaAssetRecord(input: {
  id: string;
  ownerId: string;
  kind: string;
  s3Key: string;
  status: string;
  variants: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}): MediaAssetRecord {
  return {
    id: input.id,
    ownerId: input.ownerId,
    kind: input.kind,
    s3Key: input.s3Key,
    status: input.status,
    variants: input.variants,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export class PrismaMediaAssetRepository implements MediaAssetRepositoryPort {
  constructor(private readonly db: MediaPrismaDb = prisma) {}

  async createPendingAsset(input: CreatePendingMediaAssetDraft): Promise<MediaAssetRecord> {
    const asset = await this.db.mediaAsset.create({
      data: {
        ownerId: input.ownerId,
        kind: input.kind,
        s3Key: input.s3Key,
        status: 'pending'
      }
    });

    return toMediaAssetRecord(asset);
  }

  async markAssetReady(id: string): Promise<MediaAssetRecord> {
    const asset = await this.db.mediaAsset.update({
      where: { id },
      data: { status: 'ready' }
    });

    return toMediaAssetRecord(asset);
  }

  async findAssetById(id: string): Promise<MediaAssetRecord | null> {
    const asset = await this.db.mediaAsset.findUnique({ where: { id } });
    return asset ? toMediaAssetRecord(asset) : null;
  }
}

export class PrismaMediaOutboxEventPublisher implements MediaEventPublisherPort {
  constructor(private readonly db: MediaPrismaDb = prisma) {}

  async publishUploadRequested(input: {
    assetId: string;
    ownerId: string;
    kind: string;
    s3Key: string;
    occurredAt?: Date;
  }): Promise<void> {
    const envelope = createIntegrationEventEnvelope({
      eventType: MEDIA_EVENT_TOPICS.uploadRequested,
      producer: 'svc-media',
      data: {
        asset_id: input.assetId,
        owner_id: input.ownerId,
        kind: input.kind,
        s3_key: input.s3Key
      },
      occurredAt: input.occurredAt
    });

    await this.createOutboxEvent(
      envelope.event_id,
      MEDIA_EVENT_TOPICS.uploadRequested,
      input.assetId,
      envelope
    );
  }

  async publishAssetReady(input: {
    assetId: string;
    ownerId: string;
    status: string;
    s3Key: string;
    occurredAt?: Date;
  }): Promise<void> {
    const envelope = createIntegrationEventEnvelope({
      eventType: MEDIA_EVENT_TOPICS.assetReady,
      producer: 'svc-media',
      data: {
        asset_id: input.assetId,
        owner_id: input.ownerId,
        status: input.status,
        s3_key: input.s3Key
      },
      occurredAt: input.occurredAt
    });

    await this.createOutboxEvent(
      envelope.event_id,
      MEDIA_EVENT_TOPICS.assetReady,
      input.assetId,
      envelope
    );
  }

  private async createOutboxEvent(
    id: string,
    topic: string,
    eventKey: string,
    envelope: IntegrationEventEnvelope<unknown>
  ): Promise<void> {
    await this.db.outboxEvent.create({
      data: {
        id,
        topic,
        eventType: envelope.event_type,
        eventKey,
        payload: envelope as unknown as Prisma.InputJsonValue,
        status: OutboxEventStatus.PENDING
      }
    });
  }
}

export interface PendingMediaOutboxEvent {
  id: string;
  topic: string;
  eventType: string;
  eventKey: string | null;
  envelope: IntegrationEventEnvelope<unknown>;
  attempts: number;
}

export interface MediaOutboxStatusCounts {
  pending: number;
  processing: number;
  published: number;
  failed: number;
  deadLetter: number;
}

export class PrismaMediaOutboxRelayStore {
  constructor(private readonly db: MediaPrismaDb = prisma) {}

  async listDue(limit: number, now = new Date()): Promise<PendingMediaOutboxEvent[]> {
    const rows = await this.db.outboxEvent.findMany({
      where: {
        status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] },
        nextAttemptAt: { lte: now }
      },
      orderBy: [{ createdAt: 'asc' }],
      take: limit
    });

    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      eventType: row.eventType,
      eventKey: row.eventKey,
      envelope: row.payload as unknown as IntegrationEventEnvelope<unknown>,
      attempts: row.attempts
    }));
  }

  async claim(id: string): Promise<boolean> {
    const result = await this.db.outboxEvent.updateMany({
      where: {
        id,
        status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] }
      },
      data: {
        status: OutboxEventStatus.PROCESSING,
        attempts: { increment: 1 },
        lastError: null
      }
    });

    return result.count > 0;
  }

  async markPublished(id: string, publishedAt = new Date()): Promise<void> {
    await this.db.outboxEvent.updateMany({
      where: { id },
      data: {
        status: OutboxEventStatus.PUBLISHED,
        publishedAt,
        lastError: null
      }
    });
  }

  async markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.db.outboxEvent.updateMany({
      where: { id },
      data: {
        status: OutboxEventStatus.FAILED,
        lastError: error.slice(0, 4000),
        nextAttemptAt,
        publishedAt: null,
        deadLetteredAt: null,
        deadLetterTopic: null
      }
    });
  }

  async markDeadLetter(
    id: string,
    error: string,
    input?: { deadLetteredAt?: Date; deadLetterTopic?: string | null }
  ): Promise<void> {
    await this.db.outboxEvent.updateMany({
      where: { id },
      data: {
        status: OutboxEventStatus.DEAD_LETTER,
        lastError: error.slice(0, 4000),
        deadLetteredAt: input?.deadLetteredAt ?? new Date(),
        deadLetterTopic: input?.deadLetterTopic ?? null,
        publishedAt: null
      }
    });
  }

  async countByStatus(): Promise<MediaOutboxStatusCounts> {
    const rows = await this.db.outboxEvent.groupBy({
      by: ['status'],
      _count: { _all: true }
    });

    const counts: MediaOutboxStatusCounts = {
      pending: 0,
      processing: 0,
      published: 0,
      failed: 0,
      deadLetter: 0
    };

    for (const row of rows) {
      switch (row.status) {
        case OutboxEventStatus.PENDING:
          counts.pending = row._count._all;
          break;
        case OutboxEventStatus.PROCESSING:
          counts.processing = row._count._all;
          break;
        case OutboxEventStatus.PUBLISHED:
          counts.published = row._count._all;
          break;
        case OutboxEventStatus.FAILED:
          counts.failed = row._count._all;
          break;
        case OutboxEventStatus.DEAD_LETTER:
          counts.deadLetter = row._count._all;
          break;
        default:
          break;
      }
    }

    return counts;
  }
}

export class PrismaMediaTransactionRunner implements MediaTransactionPort {
  constructor(private readonly db: PrismaClient = prisma) {}

  async run<T>(callback: (ports: MediaMutationPorts) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) =>
      callback({
        assets: new PrismaMediaAssetRepository(tx),
        eventPublisher: new PrismaMediaOutboxEventPublisher(tx)
      })
    );
  }
}

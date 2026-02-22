import { prisma } from '../../../prisma.js';
import type { MediaAssetRepositoryPort } from '../../../application/media/ports.js';
import type {
  CreatePendingMediaAssetDraft,
  MediaAssetRecord
} from '../../../domain/media/asset.js';

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
  async createPendingAsset(input: CreatePendingMediaAssetDraft): Promise<MediaAssetRecord> {
    const asset = await prisma.mediaAsset.create({
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
    const asset = await prisma.mediaAsset.update({
      where: { id },
      data: { status: 'ready' }
    });

    return toMediaAssetRecord(asset);
  }

  async findAssetById(id: string): Promise<MediaAssetRecord | null> {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    return asset ? toMediaAssetRecord(asset) : null;
  }
}

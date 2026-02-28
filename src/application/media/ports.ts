import type { MediaAssetRecord, CreatePendingMediaAssetDraft } from '../../domain/media/asset.js';

export interface MediaAssetRepositoryPort {
  createPendingAsset(input: CreatePendingMediaAssetDraft): Promise<MediaAssetRecord>;
  markAssetReady(id: string): Promise<MediaAssetRecord>;
  findAssetById(id: string): Promise<MediaAssetRecord | null>;
}

export interface MediaMutationPorts {
  assets: MediaAssetRepositoryPort;
  eventPublisher: MediaEventPublisherPort;
}

export interface MediaTransactionPort {
  run<T>(callback: (ports: MediaMutationPorts) => Promise<T>): Promise<T>;
}

export interface UploadKeyGeneratorPort {
  createUploadKey(ownerId: string, filename: string): string;
}

export interface UploadUrlSignerPort {
  createPutUrl(key: string, contentType: string): Promise<string>;
}

export interface MediaUrlSignerPort {
  signMediaUrl(key: string): string;
}

export interface MediaEventPublisherPort {
  publishUploadRequested(input: {
    assetId: string;
    ownerId: string;
    kind: string;
    s3Key: string;
    occurredAt?: Date;
  }): Promise<void>;
  publishAssetReady(input: {
    assetId: string;
    ownerId: string;
    status: string;
    s3Key: string;
    occurredAt?: Date;
  }): Promise<void>;
}

import {
  createMediaApplicationModule,
  type MediaApplicationModule
} from '../application/media/use-cases.js';
import { PrismaMediaAssetRepository } from '../adapters/outbound/prisma/media-prisma-asset-repository.js';
import { S3UploadUrlSignerAdapter } from '../adapters/outbound/signing/s3-upload-url-signer.js';
import { S3UploadedObjectInspectorAdapter } from '../adapters/outbound/signing/s3-uploaded-object-inspector.js';
import {
  SharedMediaUrlSignerAdapter,
  SharedUploadKeyGeneratorAdapter
} from '../adapters/outbound/media/shared-media-signers.js';
import { PrismaMediaTransactionRunner } from '../adapters/outbound/prisma/media-prisma-asset-repository.js';

export interface MediaContainer {
  media: MediaApplicationModule;
}

export function createContainer(): MediaContainer {
  const assets = new PrismaMediaAssetRepository();
  const uploadUrlSigner = new S3UploadUrlSignerAdapter();
  const uploadedObjectInspector = new S3UploadedObjectInspectorAdapter();
  const mediaUrlSigner = new SharedMediaUrlSignerAdapter();
  const uploadKeyGenerator = new SharedUploadKeyGeneratorAdapter();
  const transactionRunner = new PrismaMediaTransactionRunner();
  const uploadUrlExpirationSeconds = Number(process.env.UPLOAD_URL_EXPIRATION_SECONDS ?? 900);

  return {
    media: createMediaApplicationModule({
      assets,
      uploadKeyGenerator,
      uploadUrlSigner,
      uploadedObjectInspector,
      mediaUrlSigner,
      transactionRunner,
      uploadUrlExpirationSeconds:
        Number.isFinite(uploadUrlExpirationSeconds) && uploadUrlExpirationSeconds > 0
          ? Math.floor(uploadUrlExpirationSeconds)
          : 900
    })
  };
}

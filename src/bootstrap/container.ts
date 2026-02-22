import {
  createMediaApplicationModule,
  type MediaApplicationModule
} from '../application/media/use-cases.js';
import { PrismaMediaAssetRepository } from '../adapters/outbound/prisma/media-prisma-asset-repository.js';
import { S3UploadUrlSignerAdapter } from '../adapters/outbound/signing/s3-upload-url-signer.js';
import {
  SharedMediaUrlSignerAdapter,
  SharedUploadKeyGeneratorAdapter
} from '../adapters/outbound/media/shared-media-signers.js';
import { createMediaEventPublisherAdapter } from '../adapters/outbound/events/media-event-publisher.js';

export interface MediaContainer {
  media: MediaApplicationModule;
}

export function createContainer(): MediaContainer {
  const assets = new PrismaMediaAssetRepository();
  const uploadUrlSigner = new S3UploadUrlSignerAdapter();
  const mediaUrlSigner = new SharedMediaUrlSignerAdapter();
  const uploadKeyGenerator = new SharedUploadKeyGeneratorAdapter();
  const eventPublisher = createMediaEventPublisherAdapter();

  return {
    media: createMediaApplicationModule({
      assets,
      uploadKeyGenerator,
      uploadUrlSigner,
      mediaUrlSigner,
      eventPublisher
    })
  };
}

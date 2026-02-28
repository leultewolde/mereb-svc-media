import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createMediaApplicationModule } from '../src/application/media/use-cases.js';
import type {
  MediaAssetRepositoryPort,
  MediaEventPublisherPort,
  MediaTransactionPort,
  MediaUrlSignerPort,
  UploadKeyGeneratorPort,
  UploadUrlSignerPort
} from '../src/application/media/ports.js';
import type { MediaAssetRecord } from '../src/domain/media/asset.js';
import { AuthenticationRequiredError } from '../src/domain/media/errors.js';

function mediaAsset(overrides: Partial<MediaAssetRecord> = {}): MediaAssetRecord {
  return {
    id: 'asset-1',
    ownerId: 'user-1',
    kind: 'image',
    s3Key: 'uploads/user-1/avatar.png',
    status: 'pending',
    variants: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

function transactionRunner(
  assets: MediaAssetRepositoryPort,
  eventPublisher: MediaEventPublisherPort
): MediaTransactionPort {
  return {
    async run<T>(callback): Promise<T> {
      return callback({ assets, eventPublisher });
    }
  };
}

test('requestUpload creates asset and returns signed URLs', async () => {
  const createCalls: Array<{ ownerId: string; kind: string; s3Key: string }> = [];
  const uploadEventCalls: Array<unknown> = [];

  const assets: MediaAssetRepositoryPort = {
    async createPendingAsset(input) {
      createCalls.push(input);
      return mediaAsset({
        ownerId: input.ownerId,
        kind: input.kind,
        s3Key: input.s3Key
      });
    },
    async markAssetReady() {
      throw new Error('not used');
    },
    async findAssetById() {
      throw new Error('not used');
    }
  };

  const uploadKeyGenerator: UploadKeyGeneratorPort = {
    createUploadKey(ownerId, filename) {
      return `uploads/${ownerId}/${filename}`;
    }
  };
  const uploadUrlSigner: UploadUrlSignerPort = {
    async createPutUrl(key, contentType) {
      return `put:${key}:${contentType}`;
    }
  };
  const mediaUrlSigner: MediaUrlSignerPort = {
    signMediaUrl(key) {
      return `get:${key}`;
    }
  };
  const eventPublisher: MediaEventPublisherPort = {
    async publishUploadRequested(input) {
      uploadEventCalls.push(input);
    },
    async publishAssetReady() {
      throw new Error('not used');
    }
  };

  const media = createMediaApplicationModule({
    assets,
    uploadKeyGenerator,
    uploadUrlSigner,
    mediaUrlSigner,
    transactionRunner: transactionRunner(assets, eventPublisher)
  });

  const response = await media.commands.requestUpload.execute(
    {
      filename: 'avatar.png',
      contentType: 'image/png'
    },
    media.helpers.toExecutionContext('user-1')
  );

  assert.deepEqual(response, {
    assetId: 'asset-1',
    putUrl: 'put:uploads/user-1/avatar.png:image/png',
    getUrl: 'get:uploads/user-1/avatar.png'
  });
  assert.deepEqual(createCalls, [
    {
      ownerId: 'user-1',
      kind: 'image',
      s3Key: 'uploads/user-1/avatar.png'
    }
  ]);
  assert.equal(uploadEventCalls.length, 1);
});

test('requestUpload requires authentication', async () => {
  const assets: MediaAssetRepositoryPort = {
    async createPendingAsset() {
      throw new Error('not used');
    },
    async markAssetReady() {
      throw new Error('not used');
    },
    async findAssetById() {
      throw new Error('not used');
    }
  };
  const eventPublisher: MediaEventPublisherPort = {
    async publishUploadRequested() {
      return;
    },
    async publishAssetReady() {
      return;
    }
  };

  const media = createMediaApplicationModule({
    assets,
    uploadKeyGenerator: { createUploadKey: () => 'unused' },
    uploadUrlSigner: { async createPutUrl() { return 'unused'; } },
    mediaUrlSigner: { signMediaUrl: () => 'unused' },
    transactionRunner: transactionRunner(assets, eventPublisher)
  });

  await assert.rejects(
    () =>
      media.commands.requestUpload.execute(
        { filename: 'avatar.png', contentType: 'image/png' },
        media.helpers.toExecutionContext(undefined)
      ),
    AuthenticationRequiredError
  );
});

test('completeUpload and getAssetById preserve response shapes', async () => {
  const readyAsset = mediaAsset({
    status: 'ready',
    variants: [{ name: 'thumb' }]
  });
  const readyEventCalls: Array<unknown> = [];

  const assets: MediaAssetRepositoryPort = {
    async createPendingAsset() {
      throw new Error('not used');
    },
    async markAssetReady(id) {
      return { ...readyAsset, id };
    },
    async findAssetById(id) {
      if (id === 'missing') return null;
      return { ...readyAsset, id };
    }
  };
  const eventPublisher: MediaEventPublisherPort = {
    async publishUploadRequested() {
      return;
    },
    async publishAssetReady(input) {
      readyEventCalls.push(input);
    }
  };

  const media = createMediaApplicationModule({
    assets,
    uploadKeyGenerator: { createUploadKey: () => 'unused' },
    uploadUrlSigner: { async createPutUrl() { return 'unused'; } },
    mediaUrlSigner: {
      signMediaUrl(key) {
        return `signed:${key}`;
      }
    },
    transactionRunner: transactionRunner(assets, eventPublisher)
  });

  const complete = await media.commands.completeUpload.execute(
    { assetId: 'asset-2' },
    media.helpers.toExecutionContext('user-1')
  );
  assert.deepEqual(complete, {
    assetId: 'asset-2',
    status: 'ready',
    getUrl: 'signed:uploads/user-1/avatar.png'
  });
  assert.equal(readyEventCalls.length, 1);

  const found = await media.queries.getAssetById.execute({ assetId: 'asset-2' });
  assert.deepEqual(found, {
    assetId: 'asset-2',
    ownerId: 'user-1',
    status: 'ready',
    variants: [{ name: 'thumb' }],
    url: 'signed:uploads/user-1/avatar.png'
  });

  const missing = await media.queries.getAssetById.execute({ assetId: 'missing' });
  assert.equal(missing, null);
});

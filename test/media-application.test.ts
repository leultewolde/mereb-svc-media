import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createMediaApplicationModule } from '../src/application/media/use-cases.js';
import type {
  MediaAssetRepositoryPort,
  MediaEventPublisherPort,
  MediaTransactionPort,
  MediaUrlSignerPort,
  UploadedObjectInspectorPort,
  UploadKeyGeneratorPort,
  UploadUrlSignerPort
} from '../src/application/media/ports.js';
import type { MediaAssetRecord } from '../src/domain/media/asset.js';
import {
  AuthenticationRequiredError,
  MediaAssetOwnershipError,
  UnsupportedMediaContentTypeError
} from '../src/domain/media/errors.js';

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
    uploadedObjectInspector: {
      async inspectUploadedObject() {
        throw new Error('not used');
      }
    },
    mediaUrlSigner,
    transactionRunner: transactionRunner(assets, eventPublisher),
    uploadUrlExpirationSeconds: 900
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
    key: 'uploads/user-1/avatar.png',
    putUrl: 'put:uploads/user-1/avatar.png:image/png',
    getUrl: 'get:uploads/user-1/avatar.png',
    expiresInSeconds: 900
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
    uploadedObjectInspector: {
      async inspectUploadedObject() {
        return null;
      }
    },
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

test('requestUpload rejects unsupported content types', async () => {
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
    uploadedObjectInspector: {
      async inspectUploadedObject() {
        return null;
      }
    },
    mediaUrlSigner: { signMediaUrl: () => 'unused' },
    transactionRunner: transactionRunner(assets, eventPublisher)
  });

  await assert.rejects(
    () =>
      media.commands.requestUpload.execute(
        { filename: 'avatar.gif', contentType: 'image/gif' },
        media.helpers.toExecutionContext('user-1')
      ),
    UnsupportedMediaContentTypeError
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
    uploadedObjectInspector: {
      async inspectUploadedObject() {
        return {
          contentType: 'image/png',
          contentLength: 1024
        };
      }
    } satisfies UploadedObjectInspectorPort,
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
    key: 'uploads/user-1/avatar.png',
    ownerId: 'user-1',
    kind: 'image',
    status: 'ready',
    variants: [{ name: 'thumb' }],
    url: 'signed:uploads/user-1/avatar.png',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(readyEventCalls.length, 1);

  const found = await media.queries.getAssetById.execute({ assetId: 'asset-2' });
  assert.deepEqual(found, {
    assetId: 'asset-2',
    key: 'uploads/user-1/avatar.png',
    ownerId: 'user-1',
    kind: 'image',
    status: 'ready',
    variants: [{ name: 'thumb' }],
    url: 'signed:uploads/user-1/avatar.png',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  const missing = await media.queries.getAssetById.execute({ assetId: 'missing' });
  assert.equal(missing, null);
});

test('completeUpload rejects assets owned by another user', async () => {
  const assets: MediaAssetRepositoryPort = {
    async createPendingAsset() {
      throw new Error('not used');
    },
    async markAssetReady() {
      throw new Error('not used');
    },
    async findAssetById() {
      return mediaAsset({ ownerId: 'user-2' });
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
    uploadedObjectInspector: {
      async inspectUploadedObject() {
        return {
          contentType: 'image/png',
          contentLength: 100
        };
      }
    },
    mediaUrlSigner: { signMediaUrl: () => 'unused' },
    transactionRunner: transactionRunner(assets, eventPublisher)
  });

  await assert.rejects(
    () => media.commands.completeUpload.execute(
      { assetId: 'asset-1' },
      media.helpers.toExecutionContext('user-1')
    ),
    MediaAssetOwnershipError
  );
});

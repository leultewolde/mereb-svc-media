import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createResolvers } from '../src/adapters/inbound/graphql/resolvers.js';
import type { MediaApplicationModule } from '../src/application/media/use-cases.js';
import {
  AuthenticationRequiredError,
  MediaAssetOwnershipError,
  MediaAssetNotFoundError,
  MediaObjectTooLargeError,
  UnsupportedMediaContentTypeError
} from '../src/domain/media/errors.js';

function createMediaStub(): MediaApplicationModule {
  return {
    commands: {
      requestUpload: {
        async execute() {
          return {
            assetId: 'asset-1',
            key: 'users/user-1/avatar.png',
            putUrl: 'put-url',
            getUrl: 'get-url',
            expiresInSeconds: 900
          };
        }
      },
      completeUpload: {
        async execute() {
          return {
            assetId: 'asset-1',
            key: 'users/user-1/avatar.png',
            ownerId: 'user-1',
            kind: 'avatar',
            status: 'ready',
            variants: [],
            url: 'get-url',
            createdAt: '2026-03-01T00:00:00.000Z',
            updatedAt: '2026-03-01T00:00:00.000Z'
          };
        }
      }
    },
    queries: {
      getAssetById: {
        async execute() {
          return null;
        }
      }
    },
    helpers: {
      toExecutionContext(userId?: string) {
        return userId ? { principal: { userId } } : {};
      }
    }
  };
}

test('requestMediaUpload maps authentication errors to UNAUTHENTICATED', async () => {
  const media = createMediaStub();
  media.commands.requestUpload = {
    async execute() {
      throw new AuthenticationRequiredError();
    }
  };

  const resolvers = createResolvers(media);
  const requestMediaUpload = (
    resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>
  ).requestMediaUpload;

  await assert.rejects(
    () =>
      requestMediaUpload(
        {},
        { filename: 'avatar.png', contentType: 'image/png', kind: 'AVATAR' },
        {}
      ),
    (error) => error instanceof Error && error.message === 'UNAUTHENTICATED'
  );
});

test('requestMediaUpload maps unsupported content type errors', async () => {
  const media = createMediaStub();
  media.commands.requestUpload = {
    async execute() {
      throw new UnsupportedMediaContentTypeError('application/pdf');
    }
  };

  const resolvers = createResolvers(media);
  const requestMediaUpload = (
    resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>
  ).requestMediaUpload;

  await assert.rejects(
    () =>
      requestMediaUpload(
        {},
        { filename: 'avatar.png', contentType: 'application/pdf', kind: 'AVATAR' },
        { userId: 'user-1' }
      ),
    (error) => error instanceof Error && error.message === 'UNSUPPORTED_MEDIA_TYPE'
  );
});

test('completeMediaUpload maps ownership, not found, and too large errors', async () => {
  const media = createMediaStub();
  const resolvers = createResolvers(media);
  const completeMediaUpload = (
    resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>
  ).completeMediaUpload;

  media.commands.completeUpload = {
    async execute() {
      throw new MediaAssetOwnershipError();
    }
  };
  await assert.rejects(
    () => completeMediaUpload({}, { assetId: 'asset-1' }, { userId: 'user-1' }),
    (error) => error instanceof Error && error.message === 'MEDIA_ASSET_FORBIDDEN'
  );

  media.commands.completeUpload = {
    async execute() {
      throw new MediaAssetNotFoundError();
    }
  };
  await assert.rejects(
    () => completeMediaUpload({}, { assetId: 'asset-1' }, { userId: 'user-1' }),
    (error) => error instanceof Error && error.message === 'MEDIA_ASSET_NOT_FOUND'
  );

  media.commands.completeUpload = {
    async execute() {
      throw new MediaObjectTooLargeError();
    }
  };
  await assert.rejects(
    () => completeMediaUpload({}, { assetId: 'asset-1' }, { userId: 'user-1' }),
    (error) => error instanceof Error && error.message === 'MEDIA_TOO_LARGE'
  );
});

test('mediaAsset query enforces ownership and entities resolve media asset references', async () => {
  const media = createMediaStub();
  media.queries.getAssetById = {
    async execute() {
      return {
        assetId: 'asset-1',
        key: 'users/user-1/avatar.png',
        ownerId: 'user-1',
        kind: 'avatar',
        status: 'ready',
        variants: [],
        url: 'get-url',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      };
    }
  };

  const resolvers = createResolvers(media);
  const query = (
    resolvers.Query as Record<string, (...args: unknown[]) => Promise<unknown>>
  );
  const entity = (
    resolvers._Entity as { __resolveType: (value: unknown) => string | null }
  );

  assert.equal(
    await query.mediaAsset({}, { assetId: 'asset-1' }, {}),
    null
  );
  assert.equal(
    await query.mediaAsset({}, { assetId: 'asset-1' }, { userId: 'other-user' }),
    null
  );
  const owned = await query.mediaAsset({}, { assetId: 'asset-1' }, { userId: 'user-1' });
  assert.equal((owned as { ownerId: string }).ownerId, 'user-1');

  const entities = await query._entities(
    {},
    { representations: [{ __typename: 'MediaAsset', id: 'asset-1' }, { __typename: 'Unknown', id: 'x' }] },
    { userId: 'user-1' }
  );
  assert.equal(Array.isArray(entities), true);
  assert.equal((entities as Array<unknown>)[0] !== null, true);
  assert.equal((entities as Array<unknown>)[1], null);
  assert.equal(entity.__resolveType({ assetId: 'asset-1' }), 'MediaAsset');
  assert.equal(entity.__resolveType({}), null);
});

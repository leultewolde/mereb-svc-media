import { test } from 'vitest';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerUploadRoutes } from '../src/adapters/inbound/http/upload-routes.js';
import {
  AuthenticationRequiredError,
  MediaAssetNotFoundError,
  MediaAssetOwnershipError,
  MediaObjectNotFoundError,
  MediaObjectTooLargeError,
  UnsupportedMediaContentTypeError
} from '../src/domain/media/errors.js';

test('POST /uploads returns 400 when filename/contentType missing', async () => {
  const app = Fastify();

  await registerUploadRoutes(app, {
    requestUpload: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    completeUpload: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    getAssetById: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    toExecutionContext: () => ({})
  });

  const response = await app.inject({
    method: 'POST',
    url: '/uploads',
    payload: {}
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'filename and contentType required' });
  await app.close();
});

test('POST /uploads returns 401 when unauthenticated', async () => {
  const app = Fastify();

  await registerUploadRoutes(app, {
    requestUpload: {
      async execute() {
        throw new AuthenticationRequiredError();
      }
    },
    completeUpload: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    getAssetById: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    toExecutionContext: () => ({})
  });

  const response = await app.inject({
    method: 'POST',
    url: '/uploads',
    payload: {
      filename: 'avatar.png',
      contentType: 'image/png'
    }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'Authentication required' });
  await app.close();
});

test('POST /uploads returns upload payload', async () => {
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.userId = 'user-1';
    done();
  });

  await registerUploadRoutes(app, {
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
        throw new Error('should not be called');
      }
    },
    getAssetById: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    toExecutionContext(userId) {
      return userId ? { principal: { userId } } : {};
    }
  });

  const response = await app.inject({
    method: 'POST',
    url: '/uploads',
    payload: {
      filename: 'avatar.png',
      contentType: 'image/png'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    assetId: 'asset-1',
    key: 'users/user-1/avatar.png',
    putUrl: 'put-url',
    getUrl: 'get-url',
    expiresInSeconds: 900
  });
  await app.close();
});

test('POST /uploads/:id/complete returns 401 when unauthenticated', async () => {
  const app = Fastify();

  await registerUploadRoutes(app, {
    requestUpload: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    completeUpload: {
      async execute() {
        throw new AuthenticationRequiredError();
      }
    },
    getAssetById: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    toExecutionContext: () => ({})
  });

  const response = await app.inject({
    method: 'POST',
    url: '/uploads/asset-1/complete'
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'Authentication required' });
  await app.close();
});

test('POST /uploads returns 415 when content type is unsupported', async () => {
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.userId = 'user-1';
    done();
  });

  await registerUploadRoutes(app, {
    requestUpload: {
      async execute() {
        throw new UnsupportedMediaContentTypeError('application/pdf');
      }
    },
    completeUpload: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    getAssetById: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    toExecutionContext(userId) {
      return userId ? { principal: { userId } } : {};
    }
  });

  const response = await app.inject({
    method: 'POST',
    url: '/uploads',
    payload: {
      filename: 'report.pdf',
      contentType: 'application/pdf'
    }
  });

  assert.equal(response.statusCode, 415);
  assert.match(String(response.json().error), /Unsupported media content type/);
  await app.close();
});

test('POST /uploads/:id/complete maps media domain errors', async () => {
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.userId = 'user-1';
    done();
  });

  await registerUploadRoutes(app, {
    requestUpload: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    completeUpload: {
      async execute(input) {
        if (input.assetId === 'missing') {
          throw new MediaAssetNotFoundError();
        }
        if (input.assetId === 'forbidden') {
          throw new MediaAssetOwnershipError();
        }
        if (input.assetId === 'not-ready') {
          throw new MediaObjectNotFoundError();
        }
        throw new MediaObjectTooLargeError();
      }
    },
    getAssetById: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    toExecutionContext(userId) {
      return userId ? { principal: { userId } } : {};
    }
  });

  const missing = await app.inject({ method: 'POST', url: '/uploads/missing/complete' });
  assert.equal(missing.statusCode, 404);

  const forbidden = await app.inject({ method: 'POST', url: '/uploads/forbidden/complete' });
  assert.equal(forbidden.statusCode, 403);

  const notReady = await app.inject({ method: 'POST', url: '/uploads/not-ready/complete' });
  assert.equal(notReady.statusCode, 409);

  const tooLarge = await app.inject({ method: 'POST', url: '/uploads/too-large/complete' });
  assert.equal(tooLarge.statusCode, 422);

  await app.close();
});

test('GET /assets/:id returns 404 or asset payload', async () => {
  const app = Fastify();

  await registerUploadRoutes(app, {
    requestUpload: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    completeUpload: {
      async execute() {
        throw new Error('should not be called');
      }
    },
    getAssetById: {
      async execute(input) {
        if (input.assetId === 'missing') {
          return null;
        }
        return {
          assetId: input.assetId,
          key: 'users/user-1/avatar.png',
          ownerId: 'user-1',
          kind: 'avatar',
          status: 'ready',
          variants: [],
          url: 'https://example.com/a',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:01:00.000Z'
        };
      }
    },
    toExecutionContext: () => ({})
  });

  const missing = await app.inject({ method: 'GET', url: '/assets/missing' });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: 'Not found' });

  const found = await app.inject({ method: 'GET', url: '/assets/asset-1' });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), {
    assetId: 'asset-1',
    key: 'users/user-1/avatar.png',
    ownerId: 'user-1',
    kind: 'avatar',
    status: 'ready',
    variants: [],
    url: 'https://example.com/a',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:01:00.000Z'
  });

  await app.close();
});

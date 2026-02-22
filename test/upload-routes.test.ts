import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerUploadRoutes } from '../src/adapters/inbound/http/upload-routes.js';
import { AuthenticationRequiredError } from '../src/domain/media/errors.js';

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
          putUrl: 'put-url',
          getUrl: 'get-url'
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
    putUrl: 'put-url',
    getUrl: 'get-url'
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
          ownerId: 'user-1',
          status: 'ready',
          variants: [],
          url: 'https://example.com/a'
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
    ownerId: 'user-1',
    status: 'ready',
    variants: [],
    url: 'https://example.com/a'
  });

  await app.close();
});

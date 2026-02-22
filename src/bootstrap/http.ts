import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import {
  createFastifyLoggerOptions,
  loadEnv,
  parseAuthHeader,
  verifyJwt
} from '@mereb/shared-packages';
import { registerUploadRoutes } from '../adapters/inbound/http/upload-routes.js';
import { createContainer } from './container.js';

loadEnv();

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createFastifyLoggerOptions('svc-media')
  });

  await app.register(helmet);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);
  await app.register(multipart);

  const issuer = process.env.OIDC_ISSUER;
  const audience = process.env.OIDC_AUDIENCE;
  if (!issuer) {
    throw new Error('OIDC_ISSUER env var required');
  }

  app.addHook('onRequest', async (request) => {
    const token = parseAuthHeader(request.headers);
    if (!token) {
      request.userId = undefined;
      return;
    }
    try {
      const payload = await verifyJwt(token, { issuer, audience });
      request.userId = payload.sub as string | undefined;
    } catch (error) {
      request.log.debug({ err: error }, 'JWT verification failed');
      request.userId = undefined;
    }
  });

  const container = createContainer();

  await registerUploadRoutes(app, {
    requestUpload: container.media.commands.requestUpload,
    completeUpload: container.media.commands.completeUpload,
    getAssetById: container.media.queries.getAssetById,
    toExecutionContext: container.media.helpers.toExecutionContext
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import {
  createLogger,
  loadEnv,
  parseAuthHeader,
  verifyJwt
} from '@mereb/shared-packages';
import { registerUploadRoutes } from './routes/uploads.js';

loadEnv();

const logger = createLogger('svc-media');

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger as FastifyBaseLogger });

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

  await registerUploadRoutes(app);

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}

import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import mercurius, { type MercuriusOptions } from 'mercurius';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFastifyLoggerOptions,
  loadEnv,
  parseAuthHeader,
  verifyJwt
} from '@mereb/shared-packages';
import type { GraphQLContext } from '../context.js';
import { createResolvers } from '../adapters/inbound/graphql/resolvers.js';
import { registerUploadRoutes } from '../adapters/inbound/http/upload-routes.js';
import { createContainer } from './container.js';

loadEnv();

const typeDefsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'schema.graphql'
);
const typeDefs = readFileSync(typeDefsPath, 'utf8');

function assertStorageConfig() {
  const missing: string[] = [];
  if (!process.env.S3_BUCKET) {
    missing.push('S3_BUCKET');
  }
  if (!process.env.S3_ENDPOINT) {
    missing.push('S3_ENDPOINT');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required media storage env vars: ${missing.join(', ')}`);
  }
}

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
  assertStorageConfig();

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

  const schema = makeExecutableSchema<GraphQLContext>({
    typeDefs,
    resolvers: createResolvers(container.media)
  });

  const mercuriusOptions: MercuriusOptions & { federationMetadata?: boolean } = {
    schema,
    graphiql: process.env.NODE_ENV !== 'production',
    federationMetadata: true,
    context: (request): GraphQLContext => ({ userId: request.userId })
  };

  await app.register(mercurius, mercuriusOptions);

  await registerUploadRoutes(app, {
    requestUpload: container.media.commands.requestUpload,
    completeUpload: container.media.commands.completeUpload,
    getAssetById: container.media.queries.getAssetById,
    toExecutionContext: container.media.helpers.toExecutionContext
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}

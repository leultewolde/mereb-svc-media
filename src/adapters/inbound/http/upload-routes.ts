import type { FastifyInstance } from 'fastify';
import type { MediaExecutionContext } from '../../../application/media/context.js';
import {
  AuthenticationRequiredError,
  MediaAssetNotFoundError,
  MediaAssetOwnershipError,
  MediaObjectNotFoundError,
  MediaObjectTooLargeError,
  UnsupportedMediaContentTypeError
} from '../../../domain/media/errors.js';

export interface UploadRoutesDeps {
  requestUpload: {
    execute(input: {
      kind?: string;
      filename: string;
      contentType: string;
    }, ctx: MediaExecutionContext): Promise<{
      assetId: string;
      key: string;
      putUrl: string;
      getUrl: string;
      expiresInSeconds: number;
    }>;
  };
  completeUpload: {
    execute(input: { assetId: string }, ctx: MediaExecutionContext): Promise<{
      assetId: string;
      key: string;
      ownerId: string;
      kind: string;
      status: string;
      variants: unknown;
      url: string;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  getAssetById: {
    execute(input: { assetId: string }): Promise<{
      assetId: string;
      key: string;
      ownerId: string;
      kind: string;
      status: string;
      variants: unknown;
      url: string;
      createdAt: string;
      updatedAt: string;
    } | null>;
  };
  toExecutionContext: (userId?: string) => MediaExecutionContext;
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  deps: UploadRoutesDeps
) {
  app.post('/uploads', async (request, reply) => {
    const body = request.body as {
      kind?: string;
      filename?: string;
      contentType?: string;
    };

    if (!body?.filename || !body.contentType) {
      return reply.status(400).send({ error: 'filename and contentType required' });
    }

    try {
      return await deps.requestUpload.execute(
        {
          kind: body.kind,
          filename: body.filename,
          contentType: body.contentType
        },
        deps.toExecutionContext(request.userId)
      );
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return reply.status(401).send({ error: error.message });
      }
      if (error instanceof UnsupportedMediaContentTypeError) {
        return reply.status(415).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/uploads/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      return await deps.completeUpload.execute(
        { assetId: id },
        deps.toExecutionContext(request.userId)
      );
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return reply.status(401).send({ error: error.message });
      }
      if (error instanceof MediaAssetNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      if (error instanceof MediaAssetOwnershipError) {
        return reply.status(403).send({ error: error.message });
      }
      if (error instanceof MediaObjectNotFoundError) {
        return reply.status(409).send({ error: error.message });
      }
      if (
        error instanceof MediaObjectTooLargeError ||
        error instanceof UnsupportedMediaContentTypeError
      ) {
        return reply.status(422).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await deps.getAssetById.execute({ assetId: id });
    if (!asset) {
      return reply.status(404).send({ error: 'Not found' });
    }

    return asset;
  });
}

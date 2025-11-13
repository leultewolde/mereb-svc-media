import type { FastifyInstance } from 'fastify';
import { signMediaUrl, signUploadKey } from '@mereb/shared-packages';
import { prisma } from '../prisma.js';
import { createPutUrl } from '../signing.js';

export async function registerUploadRoutes(app: FastifyInstance) {
  app.post('/uploads', async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const body = request.body as {
      kind?: 'image' | 'video';
      filename: string;
      contentType: string;
    };

    if (!body?.filename || !body.contentType) {
      return reply.status(400).send({ error: 'filename and contentType required' });
    }

    const ownerId = request.userId;
    const key = signUploadKey(ownerId, body.filename);
    const putUrl = await createPutUrl(key, body.contentType);

    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId,
        kind: body.kind ?? 'image',
        s3Key: key,
        status: 'pending'
      }
    });

    return {
      assetId: asset.id,
      putUrl,
      getUrl: signMediaUrl(key)
    };
  });

  app.post('/uploads/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!request.userId) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const asset = await prisma.mediaAsset.update({
      where: { id },
      data: { status: 'ready' }
    });

    return {
      assetId: asset.id,
      status: asset.status,
      getUrl: signMediaUrl(asset.s3Key)
    };
  });

  app.get('/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) {
      return reply.status(404).send({ error: 'Not found' });
    }

    return {
      assetId: asset.id,
      ownerId: asset.ownerId,
      status: asset.status,
      variants: asset.variants ?? [],
      url: signMediaUrl(asset.s3Key)
    };
  });
}

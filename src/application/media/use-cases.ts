import { AuthenticationRequiredError } from '../../domain/media/errors.js';
import {
  mediaAssetMarkedReadyEvent,
  mediaUploadRequestedEvent
} from '../../domain/media/events.js';
import {
  defaultMediaKind,
  type MediaAssetRecord
} from '../../domain/media/asset.js';
import type { MediaExecutionContext } from './context.js';
import type {
  MediaAssetRepositoryPort,
  MediaTransactionPort,
  MediaUrlSignerPort,
  UploadKeyGeneratorPort,
  UploadUrlSignerPort
} from './ports.js';

function requireAuthenticatedUser(ctx: MediaExecutionContext): string {
  const userId = ctx.principal?.userId;
  if (!userId) {
    throw new AuthenticationRequiredError();
  }
  return userId;
}

function toExecutionContext(userId?: string): MediaExecutionContext {
  return userId ? { principal: { userId } } : {};
}

export interface MediaAssetResponse {
  assetId: string;
  ownerId: string;
  status: string;
  variants: unknown;
  url: string;
}

export interface MediaApplicationModule {
  commands: {
    requestUpload: RequestUploadUseCase;
    completeUpload: CompleteUploadUseCase;
  };
  queries: {
    getAssetById: GetAssetByIdQuery;
  };
  helpers: {
    toExecutionContext: (userId?: string) => MediaExecutionContext;
  };
}

interface MediaUseCaseDeps {
  assets: MediaAssetRepositoryPort;
  uploadKeyGenerator: UploadKeyGeneratorPort;
  uploadUrlSigner: UploadUrlSignerPort;
  mediaUrlSigner: MediaUrlSignerPort;
  transactionRunner: MediaTransactionPort;
}

function toAssetResponse(
  asset: MediaAssetRecord,
  mediaUrlSigner: MediaUrlSignerPort
): MediaAssetResponse {
  return {
    assetId: asset.id,
    ownerId: asset.ownerId,
    status: asset.status,
    variants: asset.variants ?? [],
    url: mediaUrlSigner.signMediaUrl(asset.s3Key)
  };
}

export class RequestUploadUseCase {
  constructor(private readonly deps: MediaUseCaseDeps) {}

  async execute(
    input: {
      filename: string;
      contentType: string;
      kind?: string;
    },
    ctx: MediaExecutionContext
  ): Promise<{ assetId: string; putUrl: string; getUrl: string }> {
    const ownerId = requireAuthenticatedUser(ctx);
    const key = this.deps.uploadKeyGenerator.createUploadKey(ownerId, input.filename);
    const putUrl = await this.deps.uploadUrlSigner.createPutUrl(key, input.contentType);
    const asset = await this.deps.transactionRunner.run(async ({ assets, eventPublisher }) => {
      const created = await assets.createPendingAsset({
        ownerId,
        kind: defaultMediaKind(input.kind),
        s3Key: key
      });

      const domainEvent = mediaUploadRequestedEvent(
        created.id,
        ownerId,
        created.kind,
        created.s3Key
      );
      await eventPublisher.publishUploadRequested({
        assetId: domainEvent.payload.assetId,
        ownerId: domainEvent.payload.ownerId,
        kind: domainEvent.payload.kind,
        s3Key: domainEvent.payload.s3Key,
        occurredAt: domainEvent.occurredAt
      });

      return created;
    });

    return {
      assetId: asset.id,
      putUrl,
      getUrl: this.deps.mediaUrlSigner.signMediaUrl(key)
    };
  }
}

export class CompleteUploadUseCase {
  constructor(private readonly deps: MediaUseCaseDeps) {}

  async execute(
    input: { assetId: string },
    ctx: MediaExecutionContext
  ): Promise<{ assetId: string; status: string; getUrl: string }> {
    requireAuthenticatedUser(ctx);
    const asset = await this.deps.transactionRunner.run(async ({ assets, eventPublisher }) => {
      const updated = await assets.markAssetReady(input.assetId);
      const domainEvent = mediaAssetMarkedReadyEvent(
        updated.id,
        updated.ownerId,
        updated.status,
        updated.s3Key
      );
      await eventPublisher.publishAssetReady({
        assetId: domainEvent.payload.assetId,
        ownerId: domainEvent.payload.ownerId,
        status: domainEvent.payload.status,
        s3Key: domainEvent.payload.s3Key,
        occurredAt: domainEvent.occurredAt
      });
      return updated;
    });

    return {
      assetId: asset.id,
      status: asset.status,
      getUrl: this.deps.mediaUrlSigner.signMediaUrl(asset.s3Key)
    };
  }
}

export class GetAssetByIdQuery {
  constructor(
    private readonly assets: MediaAssetRepositoryPort,
    private readonly mediaUrlSigner: MediaUrlSignerPort
  ) {}

  async execute(input: { assetId: string }): Promise<MediaAssetResponse | null> {
    const asset = await this.assets.findAssetById(input.assetId);
    if (!asset) {
      return null;
    }

    return toAssetResponse(asset, this.mediaUrlSigner);
  }
}

export function createMediaApplicationModule(deps: MediaUseCaseDeps): MediaApplicationModule {
  return {
    commands: {
      requestUpload: new RequestUploadUseCase(deps),
      completeUpload: new CompleteUploadUseCase(deps)
    },
    queries: {
      getAssetById: new GetAssetByIdQuery(deps.assets, deps.mediaUrlSigner)
    },
    helpers: {
      toExecutionContext
    }
  };
}

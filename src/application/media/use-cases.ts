import {
  AuthenticationRequiredError,
  MediaAssetNotFoundError,
  MediaAssetOwnershipError,
  MediaObjectNotFoundError,
  MediaStorageUnavailableError,
  UnsupportedMediaContentTypeError
} from '../../domain/media/errors.js';
import {
  mediaAssetMarkedReadyEvent,
  mediaUploadRequestedEvent
} from '../../domain/media/events.js';
import {
  defaultMediaKind,
  type MediaAssetRecord
} from '../../domain/media/asset.js';
import {
  assertAllowedContentType,
  assertAllowedObjectSize
} from '../../domain/media/upload-policy.js';
import type { MediaExecutionContext } from './context.js';
import type {
  MediaAssetRepositoryPort,
  MediaTransactionPort,
  MediaUrlSignerPort,
  UploadedObjectInspectorPort,
  UploadKeyGeneratorPort,
  UploadUrlSignerPort
} from './ports.js';

export const DEFAULT_UPLOAD_URL_EXPIRATION_SECONDS = 900;
const DEFAULT_UPLOAD_INSPECTION_RETRIES = 3;
const DEFAULT_UPLOAD_INSPECTION_RETRY_DELAY_MS = 150;

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
  key: string;
  ownerId: string;
  kind: string;
  status: string;
  variants: unknown;
  url: string;
  createdAt: string;
  updatedAt: string;
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
  uploadedObjectInspector: UploadedObjectInspectorPort;
  mediaUrlSigner: MediaUrlSignerPort;
  transactionRunner: MediaTransactionPort;
  uploadUrlExpirationSeconds?: number;
}

function toAssetResponse(
  asset: MediaAssetRecord,
  mediaUrlSigner: MediaUrlSignerPort
): MediaAssetResponse {
  return {
    assetId: asset.id,
    key: asset.s3Key,
    ownerId: asset.ownerId,
    kind: asset.kind,
    status: asset.status,
    variants: asset.variants ?? [],
    url: mediaUrlSigner.signMediaUrl(asset.s3Key),
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString()
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  ): Promise<{ assetId: string; key: string; putUrl: string; getUrl: string; expiresInSeconds: number }> {
    const ownerId = requireAuthenticatedUser(ctx);
    const normalizedContentType = assertAllowedContentType(input.contentType);
    const key = this.deps.uploadKeyGenerator.createUploadKey(ownerId, input.filename);
    let putUrl: string;
    try {
      putUrl = await this.deps.uploadUrlSigner.createPutUrl(key, normalizedContentType);
    } catch (error) {
      throw new MediaStorageUnavailableError(
        `Failed to create upload URL: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
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
      key,
      putUrl,
      getUrl: this.deps.mediaUrlSigner.signMediaUrl(key),
      expiresInSeconds:
        this.deps.uploadUrlExpirationSeconds ?? DEFAULT_UPLOAD_URL_EXPIRATION_SECONDS
    };
  }
}

export class CompleteUploadUseCase {
  constructor(private readonly deps: MediaUseCaseDeps) {}

  private async inspectUploadedObjectWithRetry(s3Key: string) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= DEFAULT_UPLOAD_INSPECTION_RETRIES; attempt += 1) {
      try {
        const uploadedObject = await this.deps.uploadedObjectInspector.inspectUploadedObject(s3Key);
        if (uploadedObject) {
          return uploadedObject;
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt < DEFAULT_UPLOAD_INSPECTION_RETRIES) {
        await wait(DEFAULT_UPLOAD_INSPECTION_RETRY_DELAY_MS);
      }
    }

    if (lastError) {
      throw new MediaStorageUnavailableError(
        `Failed to inspect uploaded object: ${lastError instanceof Error ? lastError.message : 'unknown error'}`
      );
    }

    return null;
  }

  async execute(
    input: { assetId: string },
    ctx: MediaExecutionContext
  ): Promise<MediaAssetResponse> {
    const userId = requireAuthenticatedUser(ctx);
    const existing = await this.deps.assets.findAssetById(input.assetId);
    if (!existing) {
      throw new MediaAssetNotFoundError();
    }
    if (existing.ownerId !== userId) {
      throw new MediaAssetOwnershipError();
    }

    const uploadedObject = await this.inspectUploadedObjectWithRetry(existing.s3Key);
    if (!uploadedObject) {
      throw new MediaObjectNotFoundError();
    }

    const uploadedContentType = uploadedObject.contentType?.trim();
    if (!uploadedContentType) {
      throw new UnsupportedMediaContentTypeError('missing');
    }
    assertAllowedContentType(uploadedContentType);
    assertAllowedObjectSize(uploadedObject.contentLength);

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

    return toAssetResponse(asset, this.deps.mediaUrlSigner);
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

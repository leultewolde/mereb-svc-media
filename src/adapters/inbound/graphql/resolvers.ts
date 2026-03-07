import type { IResolvers } from '@graphql-tools/utils';
import { GraphQLScalarType, Kind, type ValueNode } from 'graphql';
import type { MediaApplicationModule } from '../../../application/media/use-cases.js';
import type { GraphQLContext } from '../../../context.js';
import {
  AuthenticationRequiredError,
  MediaAssetNotFoundError,
  MediaAssetOwnershipError,
  MediaObjectNotFoundError,
  MediaStorageUnavailableError,
  MediaObjectTooLargeError,
  UnsupportedMediaContentTypeError
} from '../../../domain/media/errors.js';

function parseAnyLiteral(ast: ValueNode): unknown {
  switch (ast.kind) {
    case Kind.NULL:
      return null;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.STRING:
    case Kind.ENUM:
      return ast.value;
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.LIST:
      return ast.values.map((valueNode) => parseAnyLiteral(valueNode));
    case Kind.OBJECT: {
      const value: Record<string, unknown> = {};
      for (const field of ast.fields) {
        value[field.name.value] = parseAnyLiteral(field.value);
      }
      return value;
    }
    default:
      return null;
  }
}

const AnyScalar = new GraphQLScalarType({
  name: '_Any',
  description: 'Federation scalar that can represent any JSON value.',
  serialize: (value: unknown) => value,
  parseValue: (value: unknown) => value,
  parseLiteral: (ast) => parseAnyLiteral(ast)
});

function toKind(kind: string): string {
  switch (kind) {
    case 'AVATAR':
      return 'avatar';
    case 'POST_IMAGE':
      return 'post_image';
    default:
      return kind.toLowerCase();
  }
}

function toGraphQLError(error: unknown): never {
  if (error instanceof AuthenticationRequiredError) {
    throw new Error('UNAUTHENTICATED');
  }
  if (error instanceof MediaAssetOwnershipError) {
    throw new Error('MEDIA_ASSET_FORBIDDEN');
  }
  if (error instanceof MediaAssetNotFoundError) {
    throw new Error('MEDIA_ASSET_NOT_FOUND');
  }
  if (error instanceof UnsupportedMediaContentTypeError) {
    throw new Error('UNSUPPORTED_MEDIA_TYPE');
  }
  if (error instanceof MediaObjectTooLargeError) {
    throw new Error('MEDIA_TOO_LARGE');
  }
  if (error instanceof MediaObjectNotFoundError) {
    throw new Error('MEDIA_OBJECT_NOT_FOUND');
  }
  if (error instanceof MediaStorageUnavailableError) {
    throw new Error('MEDIA_STORAGE_UNAVAILABLE');
  }
  throw error;
}

export function createResolvers(
  media: MediaApplicationModule
): IResolvers<Record<string, unknown>, GraphQLContext> {
  return {
    _Any: AnyScalar,
    _Entity: {
      __resolveType: (entity: unknown) => {
        if (entity && typeof entity === 'object' && 'assetId' in entity) {
          return 'MediaAsset';
        }
        return null;
      }
    },
    MediaAsset: {
      id: (asset: { assetId: string }) => asset.assetId
    },
    Query: {
      mediaAsset: async (_source: unknown, args: { assetId: string }, ctx: GraphQLContext) => {
        if (!ctx.userId) {
          return null;
        }
        const asset = await media.queries.getAssetById.execute({ assetId: args.assetId });
        if (!asset || asset.ownerId !== ctx.userId) {
          return null;
        }
        return asset;
      },
      _entities: async (
        _source: unknown,
        args: { representations: Array<{ __typename?: string; id?: string }> },
        ctx: GraphQLContext
      ) => Promise.all(
        args.representations.map(async (representation) => {
          if (representation.__typename !== 'MediaAsset' || !representation.id) {
            return null;
          }
          const asset = await media.queries.getAssetById.execute({ assetId: representation.id });
          if (!asset || asset.ownerId !== ctx.userId) {
            return null;
          }
          return asset;
        })
      ),
      _service: () => ({ sdl: null })
    },
    Mutation: {
      requestMediaUpload: async (
        _source: unknown,
        args: { filename: string; contentType: string; kind: string },
        ctx: GraphQLContext
      ) => {
        try {
          return await media.commands.requestUpload.execute(
            {
              filename: args.filename,
              contentType: args.contentType,
              kind: toKind(args.kind)
            },
            media.helpers.toExecutionContext(ctx.userId)
          );
        } catch (error) {
          console.warn('[svc-media] requestMediaUpload failed', {
            userId: ctx.userId,
            filename: args.filename,
            contentType: args.contentType,
            kind: args.kind,
            error: error instanceof Error ? error.message : String(error)
          });
          toGraphQLError(error);
        }
      },
      completeMediaUpload: async (
        _source: unknown,
        args: { assetId: string },
        ctx: GraphQLContext
      ) => {
        try {
          return await media.commands.completeUpload.execute(
            { assetId: args.assetId },
            media.helpers.toExecutionContext(ctx.userId)
          );
        } catch (error) {
          console.warn('[svc-media] completeMediaUpload failed', {
            userId: ctx.userId,
            assetId: args.assetId,
            error: error instanceof Error ? error.message : String(error)
          });
          toGraphQLError(error);
        }
      }
    }
  } as IResolvers<Record<string, unknown>, GraphQLContext>;
}

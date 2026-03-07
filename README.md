# svc-media

`svc-media` is the media upload and asset lifecycle service. It exposes both federated GraphQL operations and REST endpoints for upload orchestration.

## API surface

- GraphQL endpoint: `POST /graphql`
- REST endpoints:
  - `POST /uploads` (request upload URL)
  - `POST /uploads/:id/complete` (complete/validate upload)
  - `GET /assets/:id` (read asset metadata)
- Health check: `GET /healthz`

Core GraphQL operations:

- `requestMediaUpload(filename, contentType, kind)`
- `completeMediaUpload(assetId)`
- `mediaAsset(assetId)`

Typical upload flow:

1. call `requestMediaUpload`
2. upload file directly to `putUrl`
3. call `completeMediaUpload` to mark asset ready
4. pass returned `assetId` into profile/feed mutations

## Upload policy

- allowed content types: `image/jpeg`, `image/png`, `image/webp`
- max size: `10 MB` (`10 * 1024 * 1024` bytes)
- policy is enforced:
  - before issuing presigned URL
  - again at completion by inspecting uploaded object metadata
- completion performs a short bounded retry for object visibility to handle eventual consistency.
- storage connectivity/config errors are surfaced as `MEDIA_STORAGE_UNAVAILABLE`.

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | - | Postgres connection string. |
| `OIDC_ISSUER` | yes | - | JWT issuer for authenticated media operations. |
| `OIDC_AUDIENCE` | no | - | JWT audience/client ID. |
| `S3_BUCKET` | yes | - | Bucket used for upload objects. |
| `S3_ENDPOINT` | yes | - | Internal S3/MinIO endpoint for object inspection. |
| `S3_PRESIGN_ENDPOINT` | no | `S3_ENDPOINT` | Browser-reachable endpoint used when creating presigned URLs. |
| `S3_REGION` | no | `us-east-1` | S3 region. |
| `S3_ACCESS_KEY` | conditional | - | Access key for S3-compatible stores. |
| `S3_SECRET_KEY` | conditional | - | Secret key for S3-compatible stores. |
| `MEDIA_CDN_ORIGIN` | no | `https://cdn.example.com` | Base URL used for asset `url` fields. |
| `UPLOAD_URL_EXPIRATION_SECONDS` | no | `900` | Presigned URL expiry. |
| `PORT` | no | `4003` | HTTP listen port. |
| `HOST` | no | `0.0.0.0` | HTTP listen host. |

Startup validates required storage env vars and fails fast if `S3_BUCKET` or `S3_ENDPOINT` are missing.

## Local development

```bash
pnpm --filter @services/svc-media prisma:migrate
pnpm --filter @services/svc-media dev
pnpm --filter @services/svc-media dev:outbox
pnpm --filter @services/svc-media build
pnpm --filter @services/svc-media start
```

## Tests

```bash
pnpm --filter @services/svc-media test
pnpm --filter @services/svc-media test:integration
pnpm --filter @services/svc-media test:ci
```

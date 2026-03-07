import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const getSignedUrlMock = vi.fn();

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock
}));

beforeEach(() => {
  vi.resetModules();
  getSignedUrlMock.mockReset();
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY = 'minio';
  process.env.S3_SECRET_KEY = 'minio123';
});

test('getS3Client caches clients per mode and uses presign endpoint override', async () => {
  process.env.S3_ENDPOINT = 'http://internal-s3:9000';
  process.env.S3_PRESIGN_ENDPOINT = 'http://public-s3:9000';

  const { getS3Client } = await import('../src/s3.js');

  const internalA = getS3Client('internal');
  const internalB = getS3Client('internal');
  const presignA = getS3Client('presign');
  const presignB = getS3Client('presign');

  assert.equal(internalA, internalB);
  assert.equal(presignA, presignB);
  assert.notEqual(internalA, presignA);

  const internalEndpoint = await internalA.config.endpoint();
  const presignEndpoint = await presignA.config.endpoint();
  assert.equal(internalEndpoint.hostname, 'internal-s3');
  assert.equal(presignEndpoint.hostname, 'public-s3');
});

test('getS3Client presign mode falls back to S3_ENDPOINT when presign endpoint is missing', async () => {
  process.env.S3_ENDPOINT = 'http://fallback-s3:9000';
  delete process.env.S3_PRESIGN_ENDPOINT;

  const { getS3Client } = await import('../src/s3.js');
  const presign = getS3Client('presign');
  const endpoint = await presign.config.endpoint();
  assert.equal(endpoint.hostname, 'fallback-s3');
});

test('createPutUrl signs uploads with configured expiration and required bucket', async () => {
  process.env.S3_ENDPOINT = 'http://internal-s3:9000';
  process.env.S3_PRESIGN_ENDPOINT = 'http://public-s3:9000';
  process.env.S3_BUCKET = 'media';
  process.env.UPLOAD_URL_EXPIRATION_SECONDS = '1200';
  getSignedUrlMock.mockResolvedValueOnce('signed-put-url');

  const { createPutUrl } = await import('../src/signing.js');

  const url = await createPutUrl('users/user-1/avatar.png', 'image/png');
  assert.equal(url, 'signed-put-url');
  assert.equal(getSignedUrlMock.mock.calls.length, 1);
  const options = getSignedUrlMock.mock.calls[0]?.[2] as { expiresIn?: number };
  assert.equal(options.expiresIn, 1200);
});

test('createPutUrl rejects when S3_BUCKET is missing', async () => {
  delete process.env.S3_BUCKET;

  const { createPutUrl } = await import('../src/signing.js');
  await assert.rejects(() => createPutUrl('users/user-1/avatar.png', 'image/png'));
});

test('uploads route entry re-exports upload route registration', async () => {
  const module = await import('../src/routes/uploads.js');
  assert.equal(typeof module.registerUploadRoutes, 'function');
});

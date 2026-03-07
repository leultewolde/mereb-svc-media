import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client } from './s3.js';

export const UPLOAD_URL_EXPIRATION_SECONDS = 900;

function getUploadUrlExpirationSeconds(): number {
  const parsed = Number(process.env.UPLOAD_URL_EXPIRATION_SECONDS ?? UPLOAD_URL_EXPIRATION_SECONDS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return UPLOAD_URL_EXPIRATION_SECONDS;
  }
  return Math.floor(parsed);
}

export async function createPutUrl(key: string, contentType: string) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET not set');
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType
  });

  return getSignedUrl(getS3Client('presign'), command, {
    expiresIn: getUploadUrlExpirationSeconds()
  });
}

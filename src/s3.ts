import { S3Client } from '@aws-sdk/client-s3';

let s3: S3Client | undefined;

export function getS3Client() {
  if (!s3) {
    s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: process.env.S3_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY!,
            secretAccessKey: process.env.S3_SECRET_KEY!
          }
        : undefined
    });
  }
  return s3;
}

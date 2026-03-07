import { S3Client } from '@aws-sdk/client-s3';

let internalS3: S3Client | undefined;
let presignS3: S3Client | undefined;

function createClient(endpoint: string | undefined): S3Client {
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: process.env.S3_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY,
          secretAccessKey: process.env.S3_SECRET_KEY ?? ''
        }
      : undefined
  });
}

export function getS3Client(mode: 'internal' | 'presign' = 'internal') {
  if (mode === 'presign') {
    if (!presignS3) {
      presignS3 = createClient(process.env.S3_PRESIGN_ENDPOINT ?? process.env.S3_ENDPOINT);
    }
    return presignS3;
  }

  if (!internalS3) {
    internalS3 = createClient(process.env.S3_ENDPOINT);
  }
  return internalS3;
}

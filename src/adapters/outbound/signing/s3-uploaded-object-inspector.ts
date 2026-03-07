import { HeadObjectCommand } from '@aws-sdk/client-s3';
import type { UploadedObjectInspectorPort } from '../../../application/media/ports.js';
import { getS3Client } from '../../../s3.js';

export class S3UploadedObjectInspectorAdapter implements UploadedObjectInspectorPort {
  async inspectUploadedObject(key: string): Promise<{ contentType?: string; contentLength?: number } | null> {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error('S3_BUCKET not set');
    }

    try {
      const response = await getS3Client('internal').send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );

      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybeCode = (error as { name?: string; Code?: string }).name
    ?? (error as { Code?: string }).Code;
  return maybeCode === 'NotFound';
}

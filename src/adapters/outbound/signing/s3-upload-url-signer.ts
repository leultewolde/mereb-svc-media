import type { UploadUrlSignerPort } from '../../../application/media/ports.js';
import { createPutUrl } from '../../../signing.js';

export class S3UploadUrlSignerAdapter implements UploadUrlSignerPort {
  async createPutUrl(key: string, contentType: string): Promise<string> {
    return createPutUrl(key, contentType);
  }
}

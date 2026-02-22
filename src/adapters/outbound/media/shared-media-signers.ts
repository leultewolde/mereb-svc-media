import { signMediaUrl, signUploadKey } from '@mereb/shared-packages';
import type {
  MediaUrlSignerPort,
  UploadKeyGeneratorPort
} from '../../../application/media/ports.js';

export class SharedUploadKeyGeneratorAdapter implements UploadKeyGeneratorPort {
  createUploadKey(ownerId: string, filename: string): string {
    return signUploadKey(ownerId, filename);
  }
}

export class SharedMediaUrlSignerAdapter implements MediaUrlSignerPort {
  signMediaUrl(key: string): string {
    return signMediaUrl(key);
  }
}

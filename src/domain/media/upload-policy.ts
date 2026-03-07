import {
  MediaObjectTooLargeError,
  UnsupportedMediaContentTypeError
} from './errors.js';

export const ALLOWED_MEDIA_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export const MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024;

export function normalizeContentType(input: string): string {
  return input.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function assertAllowedContentType(contentType: string): string {
  const normalized = normalizeContentType(contentType);
  if (!ALLOWED_MEDIA_CONTENT_TYPES.has(normalized)) {
    throw new UnsupportedMediaContentTypeError(contentType);
  }
  return normalized;
}

export function assertAllowedObjectSize(size?: number | null): void {
  if (typeof size !== 'number') {
    return;
  }
  if (size > MAX_MEDIA_UPLOAD_BYTES) {
    throw new MediaObjectTooLargeError(
      `Uploaded object size ${size} exceeds ${MAX_MEDIA_UPLOAD_BYTES} bytes`
    );
  }
}

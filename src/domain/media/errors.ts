export class AuthenticationRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationRequiredError';
  }
}

export class MediaAssetNotFoundError extends Error {
  constructor(message = 'Media asset not found') {
    super(message);
    this.name = 'MediaAssetNotFoundError';
  }
}

export class MediaAssetOwnershipError extends Error {
  constructor(message = 'Media asset does not belong to the authenticated user') {
    super(message);
    this.name = 'MediaAssetOwnershipError';
  }
}

export class UnsupportedMediaContentTypeError extends Error {
  constructor(contentType: string) {
    super(`Unsupported media content type: ${contentType}`);
    this.name = 'UnsupportedMediaContentTypeError';
  }
}

export class MediaObjectNotFoundError extends Error {
  constructor(message = 'Uploaded object not found') {
    super(message);
    this.name = 'MediaObjectNotFoundError';
  }
}

export class MediaObjectTooLargeError extends Error {
  constructor(message = 'Uploaded object exceeds maximum allowed size') {
    super(message);
    this.name = 'MediaObjectTooLargeError';
  }
}

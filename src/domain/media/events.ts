export interface MediaUploadRequestedDomainEvent {
  type: 'MediaUploadRequested';
  occurredAt: Date;
  payload: {
    assetId: string;
    ownerId: string;
    kind: string;
    s3Key: string;
  };
}

export interface MediaAssetMarkedReadyDomainEvent {
  type: 'MediaAssetMarkedReady';
  occurredAt: Date;
  payload: {
    assetId: string;
    ownerId: string;
    status: string;
    s3Key: string;
  };
}

export function mediaUploadRequestedEvent(
  assetId: string,
  ownerId: string,
  kind: string,
  s3Key: string
): MediaUploadRequestedDomainEvent {
  return {
    type: 'MediaUploadRequested',
    occurredAt: new Date(),
    payload: {
      assetId,
      ownerId,
      kind,
      s3Key
    }
  };
}

export function mediaAssetMarkedReadyEvent(
  assetId: string,
  ownerId: string,
  status: string,
  s3Key: string
): MediaAssetMarkedReadyDomainEvent {
  return {
    type: 'MediaAssetMarkedReady',
    occurredAt: new Date(),
    payload: {
      assetId,
      ownerId,
      status,
      s3Key
    }
  };
}

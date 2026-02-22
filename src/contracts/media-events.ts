export const MEDIA_EVENT_TOPICS = {
  uploadRequested: 'media.upload.requested.v1',
  assetReady: 'media.asset.ready.v1'
} as const;

export interface MediaUploadRequestedEventData {
  asset_id: string;
  owner_id: string;
  kind: string;
  s3_key: string;
}

export interface MediaAssetReadyEventData {
  asset_id: string;
  owner_id: string;
  status: string;
  s3_key: string;
}

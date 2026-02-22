export interface MediaAssetRecord {
  id: string;
  ownerId: string;
  kind: string;
  s3Key: string;
  status: string;
  variants: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePendingMediaAssetDraft {
  ownerId: string;
  kind: string;
  s3Key: string;
}

export function defaultMediaKind(kind?: string): string {
  return kind ?? 'image';
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMediaKind } from '../src/domain/media/asset.js';
import {
  mediaAssetMarkedReadyEvent,
  mediaUploadRequestedEvent
} from '../src/domain/media/events.js';
import { AuthenticationRequiredError } from '../src/domain/media/errors.js';

test('defaultMediaKind defaults to image', () => {
  assert.equal(defaultMediaKind(undefined), 'image');
  assert.equal(defaultMediaKind('video'), 'video');
});

test('media domain events capture payloads', () => {
  const requested = mediaUploadRequestedEvent('asset-1', 'user-1', 'image', 'key-1');
  assert.equal(requested.type, 'MediaUploadRequested');
  assert.deepEqual(requested.payload, {
    assetId: 'asset-1',
    ownerId: 'user-1',
    kind: 'image',
    s3Key: 'key-1'
  });

  const ready = mediaAssetMarkedReadyEvent('asset-1', 'user-1', 'ready', 'key-1');
  assert.equal(ready.type, 'MediaAssetMarkedReady');
  assert.equal(ready.payload.status, 'ready');
});

test('AuthenticationRequiredError uses expected defaults', () => {
  const error = new AuthenticationRequiredError();
  assert.equal(error.name, 'AuthenticationRequiredError');
  assert.equal(error.message, 'Authentication required');
});

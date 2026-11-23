import test from 'node:test';
import assert from 'node:assert/strict';
import { Station, User, Studio } from '../src/index.js';
import { STATION_STATUS, STREAM_STATUS } from '@mcr/shared';

test('Domain Entity: Station state checks', () => {
  const station = new Station({
    id: 'test-station-1',
    organizationId: 'test-org-1',
    name: 'Main Studio OBS',
    slug: 'main-studio-obs',
    status: STATION_STATUS.ONLINE,
    streamStatus: STREAM_STATUS.STREAMING
  });

  assert.equal(station.name, 'Main Studio OBS');
  assert.equal(station.isOnline(), true);
  assert.equal(station.isStreaming(), true);
  assert.equal(station.isRecording(), false);
});

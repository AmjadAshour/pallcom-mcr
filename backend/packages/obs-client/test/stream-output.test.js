import assert from 'node:assert/strict';
import test from 'node:test';
import { ObsClientAdapter } from '../src/index.js';

test('OBS bitrate uses real byte deltas and resets after reconnect or a new output', async () => {
  const adapter = new ObsClientAdapter();
  let stream;
  adapter.getStreamStatus = async () => stream;
  async function sample(duration, bytes, extra = {}) {
    stream = { outputActive: true, outputDuration: duration, outputBytes: bytes, ...extra };
    return (await adapter.sampleStreamOutput()).bitrateKbps;
  }
  assert.equal(await sample(1000, 250_000), null);
  assert.equal(await sample(3000, 1_250_000), 4000);
  assert.equal(await sample(3300, 1_400_000), 4000);
  assert.equal(await sample(4000, 1_650_000, { outputReconnecting: true }), null);
  assert.equal(await sample(5000, 1_800_000), null);
  assert.equal(await sample(100, 10_000), null);
  assert.equal(await sample(1100, 10_000), 0);
  assert.equal(await sample(1200, 0, { outputActive: false }), null);
});

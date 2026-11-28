import assert from 'node:assert/strict';
import test from 'node:test';
import { programInputConfig } from '../src/infrastructure/program/input-config.js';

test('network-bound HTTPS input requires an explicit port on a loopback proxy', () => {
  const input = 'https://source.example.test/feed';
  for (const proxy of [undefined, 'http://192.0.2.1:3000', 'https://127.0.0.1:3000',
    'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536',
    'http://127.0.0.1:3000/path', 'http://test:fixture@127.0.0.1:3000']) {
    assert.throws(() => programInputConfig(input, proxy, true), { statusCode: 503 });
  }
  const result = programInputConfig(input, 'http://127.0.0.1:3128', true);
  assert.equal(result.inputUrl.href, input);
  assert.equal(result.proxy.origin, 'http://127.0.0.1:3128');
});

test('Program source preserves local HTTP development and rejects ambiguous or non-public destinations', () => {
  const local = 'http://127.0.0.1:24000/feed';
  assert.equal(programInputConfig(local, undefined, false).inputUrl.href, local);
  assert.equal(programInputConfig('https://93.184.216.34/feed', 'http://127.0.0.1:3128', true).inputUrl.hostname, '93.184.216.34');
  assert.deepEqual(programInputConfig(undefined, undefined, true), {});
  assert.throws(() => programInputConfig(local, undefined, true), { statusCode: 503 });
  for (const input of [
    'file:///fixture.mp4', 'http://source.example.test/feed',
    'rtmp://source.example.test/live/stream', 'rtsp://source.example.test/stream',
    'srt://source.example.test:9000', 'udp://239.0.0.1:5000', 'ftp://source.example.test/file.ts',
    'ws://source.example.test/ws', 'wss://source.example.test/ws',
    'https://test:fixture@source.example.test/feed', 'https://source.example.test/feed#fragment',
    'https://127.0.0.1/feed', 'https://0.0.0.0/feed', 'https://10.0.0.1/feed',
    'https://100.64.0.1/feed', 'https://169.254.169.254/latest/meta-data/',
    'https://172.16.0.1/feed', 'https://192.168.1.1/feed', 'https://224.0.0.1/feed',
    'https://localhost/feed', 'https://sub.localhost/feed', 'https://camera.local/feed',
    'https://metadata.internal/feed', 'https://[::1]/feed', 'https://source.example.test./feed'
  ]) {
    assert.throws(() => programInputConfig(input, undefined, false), { statusCode: 503 }, input);
    assert.throws(() => programInputConfig(input, 'http://127.0.0.1:3128', true), { statusCode: 503 }, input);
  }
});

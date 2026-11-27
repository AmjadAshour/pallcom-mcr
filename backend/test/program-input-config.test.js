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

test('Program source preserves local HTTP development and rejects ambiguous input', () => {
  const local = 'http://127.0.0.1:24000/feed';
  assert.equal(programInputConfig(local, undefined, false).inputUrl.href, local);
  assert.deepEqual(programInputConfig(undefined, undefined, true), {});
  assert.throws(() => programInputConfig(local, undefined, true), { statusCode: 503 });
  for (const input of ['file:///fixture.mp4', 'http://source.example.test/feed',
    'https://test:fixture@source.example.test/feed', 'https://source.example.test/feed#fragment']) {
    assert.throws(() => programInputConfig(input, undefined, false), { statusCode: 503 });
  }
});

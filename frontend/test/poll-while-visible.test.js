import assert from 'node:assert/strict';
import test from 'node:test';
import { pollWhileVisible } from '../src/context/pollWhileVisible.js';

test('monitoring pauses in hidden tabs and honors the rate limiter when a tab returns', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const page = Object.assign(new EventTarget(), { hidden: true });
  globalThis.document = page;

  let calls = 0;
  const stop = pollWhileVisible(async () => {
    if (++calls === 1) throw Object.assign(new Error('Rate limited'), { status: 429, retryAfterMs: 5000 });
  }, 2000);
  t.after(() => {
    stop();
    delete globalThis.document;
  });

  const show = (visible) => {
    page.hidden = !visible;
    page.dispatchEvent(new Event('visibilitychange'));
  };

  assert.equal(calls, 0);
  show(true);
  await Promise.resolve();
  assert.equal(calls, 1);
  show(false);
  t.mock.timers.tick(2000);
  show(true);
  t.mock.timers.tick(2999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal(calls, 2);
  await Promise.resolve();
  show(false);
  t.mock.timers.tick(10000);
  assert.equal(calls, 2);
  show(true);
  assert.equal(calls, 3);
});

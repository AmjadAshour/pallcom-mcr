import test from 'node:test';
import assert from 'node:assert/strict';
import { LoginSchema, CreateStationSchema, SceneSwitchSchema } from '../src/index.js';

test('Validation: LoginSchema validates correctly', () => {
  const valid = LoginSchema.safeParse({ email: 'admin@mcrpro.local', password: 'Password123!' });
  assert.equal(valid.success, true);

  const invalid = LoginSchema.safeParse({ email: 'bad-email', password: '123' });
  assert.equal(invalid.success, false);
});

test('Validation: SceneSwitchSchema validates correctly', () => {
  const valid = SceneSwitchSchema.safeParse({ sceneName: 'Cam 1 - Close Up', preview: true });
  assert.equal(valid.success, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { LoginSchema, CreateStationSchema, SceneSwitchSchema, AudioVolumeSchema, AudioMuteSchema } from '../src/index.js';

test('Validation: LoginSchema validates correctly', () => {
  const valid = LoginSchema.safeParse({ email: 'admin@mcrpro.local', password: 'Password123!' });
  assert.equal(valid.success, true);

  const invalid = LoginSchema.safeParse({ email: 'bad-email', password: '123' });
  assert.equal(invalid.success, false);
});

test('Validation: SceneSwitchSchema and audio schemas enforce strict bounds', () => {
  const valid = SceneSwitchSchema.safeParse({ sceneName: 'Cam 1 - Close Up', preview: true });
  assert.equal(valid.success, true);
  assert.equal(SceneSwitchSchema.safeParse({ sceneName: 'Cam 1', extra: true }).success, false);

  assert.equal(AudioVolumeSchema.safeParse({ inputName: 'Host Mic', inputVolumeMul: 0.75 }).success, true);
  assert.equal(AudioVolumeSchema.safeParse({ inputName: 'Host Mic' }).success, false);
  assert.equal(AudioVolumeSchema.safeParse({ inputName: 'Host Mic', inputVolumeMul: 0.5, extra: 1 }).success, false);

  assert.equal(AudioMuteSchema.safeParse({ inputName: 'Host Mic', inputMuted: true }).success, true);
  assert.equal(AudioMuteSchema.safeParse({ inputName: 'Host Mic', inputMuted: true, extra: 1 }).success, false);
});

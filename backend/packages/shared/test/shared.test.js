import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, ROLE_PERMISSIONS, STATION_STATUS, STREAM_STATUS, OBS_COMMANDS } from '../src/index.js';

test('Shared Constants: Roles and Permissions integrity', () => {
  assert.equal(ROLES.SUPER_ADMIN, 'SUPER_ADMIN');
  assert.ok(ROLE_PERMISSIONS[ROLES.SUPER_ADMIN].includes('*'));
  assert.ok(ROLE_PERMISSIONS[ROLES.OPERATOR].includes('station:control'));
});

test('Shared Constants: Station and Stream statuses', () => {
  assert.equal(STATION_STATUS.ONLINE, 'ONLINE');
  assert.equal(STREAM_STATUS.STREAMING, 'STREAMING');
  assert.equal(OBS_COMMANDS.SET_CURRENT_PROGRAM_SCENE, 'SetCurrentProgramScene');
});

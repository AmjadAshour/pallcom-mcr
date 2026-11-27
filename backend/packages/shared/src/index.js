export {
  categories as playoutCategories, emptyPlan as emptyPlayoutPlan, emptyState as emptyPlayoutState,
  projectTimeline, estimateNext, fixedEvents, pendingMain
} from './playout-timeline.js';
export { csvTextCell } from './csv.js';

/**
 * PALLCOM MCR Shared Constants, Enums and Event Definitions
 */

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ORG_ADMIN: 'ORG_ADMIN',
  STUDIO_MANAGER: 'STUDIO_MANAGER',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER'
});

const broadcastOperatorPermissions = [
  'broadcast:emergency', 'audio:manage', 'video:manage', 'media:upload', 'media:delete',
  'advertising:manage', 'graphics:manage', 'iptv:manage', 'schedule:publish'
];

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: ['*'],
  [ROLES.ORG_ADMIN]: [
    'org:manage', 'user:invite', 'user:manage', 'studio:manage',
    'station:read', 'station:manage', 'station:control', 'macro:manage', 'schedule:manage',
    'audit:read', 'settings:manage', ...broadcastOperatorPermissions
  ],
  [ROLES.STUDIO_MANAGER]: [
    'studio:manage', 'station:read', 'station:manage', 'station:control', 'macro:manage',
    'schedule:manage', 'audit:read', ...broadcastOperatorPermissions
  ],
  [ROLES.OPERATOR]: [
    'station:control', 'macro:execute', 'station:read', 'audit:read', ...broadcastOperatorPermissions
  ],
  [ROLES.VIEWER]: [
    'station:read', 'multiview:read'
  ]
});

export const STATION_STATUS = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  DEGRADED: 'DEGRADED',
  CONNECTING: 'CONNECTING'
});

export const STREAM_STATUS = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  STREAMING: 'STREAMING',
  STOPPING: 'STOPPING'
});

export const RECORD_STATUS = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RECORDING: 'RECORDING',
  PAUSED: 'PAUSED',
  STOPPING: 'STOPPING'
});

export const SOCKET_EVENTS = Object.freeze({
  // Station & Agent Telemetry
  STATION_STATUS_CHANGED: 'station:status_changed',
  STATION_TELEMETRY: 'station:telemetry',
  AGENT_HEARTBEAT: 'agent:heartbeat',
  AGENT_CONNECTED: 'agent:connected',
  AGENT_DISCONNECTED: 'agent:disconnected',

  // OBS State Real-time Sync
  OBS_SCENE_CHANGED: 'obs:scene_changed',
  OBS_PREVIEW_SCENE_CHANGED: 'obs:preview_scene_changed',
  OBS_STREAM_STATE_CHANGED: 'obs:stream_state_changed',
  OBS_RECORD_STATE_CHANGED: 'obs:record_state_changed',
  OBS_AUDIO_CHANGED: 'obs:audio_changed',
  OBS_SOURCE_CHANGED: 'obs:source_changed',
  OBS_STUDIO_MODE_CHANGED: 'obs:studio_mode_changed',

  // System & Audit
  AUDIT_LOG_ENTRY: 'system:audit_log',
  COMMAND_ACK: 'command:ack',
  COMMAND_ERROR: 'command:error'
});

export const OBS_COMMANDS = Object.freeze({
  GET_VERSION: 'GetVersion',
  GET_STATS: 'GetStats',
  GET_SCENE_LIST: 'GetSceneList',
  GET_CURRENT_PROGRAM_SCENE: 'GetCurrentProgramScene',
  GET_CURRENT_PREVIEW_SCENE: 'GetCurrentPreviewScene',
  SET_CURRENT_PROGRAM_SCENE: 'SetCurrentProgramScene',
  SET_CURRENT_PREVIEW_SCENE: 'SetCurrentPreviewScene',
  GET_INPUT_LIST: 'GetInputList',
  GET_SCENE_ITEM_LIST: 'GetSceneItemList',
  SET_SCENE_ITEM_ENABLED: 'SetSceneItemEnabled',
  GET_INPUT_VOLUME: 'GetInputVolume',
  SET_INPUT_VOLUME: 'SetInputVolume',
  GET_INPUT_MUTE: 'GetInputMute',
  SET_INPUT_MUTE: 'SetInputMute',
  GET_STREAM_STATUS: 'GetStreamStatus',
  START_STREAM: 'StartStream',
  STOP_STREAM: 'StopStream',
  GET_RECORD_STATUS: 'GetRecordStatus',
  START_RECORD: 'StartRecord',
  STOP_RECORD: 'StopRecord',
  ENABLE_STUDIO_MODE: 'EnableStudioMode',
  DISABLE_STUDIO_MODE: 'DisableStudioMode',
  TRIGGER_STUDIO_MODE_TRANSITION: 'TriggerStudioModeTransition',
  GET_SCENE_TRANSITION_LIST: 'GetSceneTransitionList',
  SET_CURRENT_SCENE_TRANSITION: 'SetCurrentSceneTransition',
  SET_CURRENT_SCENE_TRANSITION_DURATION: 'SetCurrentSceneTransitionDuration'
});

export const PROGRAM_CANVAS = Object.freeze({ width: 1280, height: 720 });
export const PROGRAM_SCENE_UPLOAD = Object.freeze({ maxMib: 128, maxSeconds: 60 });

export function watermarkBounds({ anchor, x, y, size }, { width, height } = PROGRAM_CANVAS) {
  const dx = Math.round(width * x / 100);
  const dy = Math.round(height * y / 100);
  const boxWidth = Math.min(width - dx, Math.max(1, Math.round(width * size / 100)));
  const right = anchor.endsWith('right');
  const bottom = anchor.startsWith('bottom');
  return { left: right ? width - dx - boxWidth : dx, top: bottom ? 0 : dy,
    width: boxWidth, height: height - dy, right, bottom };
}
export * from './ads.js';

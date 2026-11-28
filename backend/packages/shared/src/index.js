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

export const MEDIA_CATEGORIES = Object.freeze([
  'MOVIES',
  'TV_PROGRAMS',
  'VIDEO_CLIPS',
  'MUSIC',
  'AUDIO_RECORDINGS',
  'ADVERTISEMENTS',
  'PROMOTIONS',
  'INTROS_OUTROS',
  'FALLBACK',
  'IMAGES',
  'CHANNEL_LOGOS',
  'GRAPHICS'
]);

export const MEDIA_KINDS = Object.freeze(['VIDEO', 'AUDIO', 'IMAGE']);

export const MEDIA_UPLOAD_STATUS = Object.freeze({
  UPLOADING: 'UPLOADING',
  UPLOADED: 'UPLOADED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED'
});

export const MEDIA_PROCESSING_STATUS = Object.freeze({
  UPLOADING: 'UPLOADING',
  UPLOADED: 'UPLOADED',
  VALIDATING: 'VALIDATING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
  QUARANTINED: 'QUARANTINED'
});

export const MEDIA_BROADCAST_COMPATIBILITY = Object.freeze({
  PENDING: 'PENDING',
  DIRECT_PLAYBACK: 'DIRECT_PLAYBACK',
  REMUX_REQUIRED: 'REMUX_REQUIRED',
  TRANSCODE_REQUIRED: 'TRANSCODE_REQUIRED',
  UNSUPPORTED: 'UNSUPPORTED'
});

export const VIDEO_SOURCE_TYPES = Object.freeze([
  'UPLOADED_FILE',
  'MOVIE',
  'PLAYLIST',
  'OBS_LIVE',
  'HLS_STREAM',
  'RTMP_STREAM',
  'SRT_STREAM',
  'RTSP_STREAM',
  'REMOTE_VIDEO_URL',
  'SERVER_FILE'
]);

export const VIDEO_SOURCE_CONNECTION_STATUS = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  RECONNECTING: 'RECONNECTING',
  DEGRADED: 'DEGRADED',
  ERROR: 'ERROR'
});

export const VIDEO_SOURCE_AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  PROBING: 'PROBING',
  FALLBACK_ACTIVE: 'FALLBACK_ACTIVE'
});

export const AUDIO_SOURCE_TYPES = Object.freeze([
  'UPLOADED_AUDIO',
  'MUSIC_PLAYLIST',
  'INTERNET_RADIO',
  'ICECAST_STREAM',
  'SHOUTCAST_STREAM',
  'MICROPHONE_INPUT',
  'VIDEO_EXTRACTED_AUDIO',
  'OBS_AUDIO_INPUT',
  'ADVERTISEMENT_AUDIO',
  'FALLBACK_AUDIO',
  'GENERATED_SILENCE'
]);

export const AUDIO_SOURCE_STATES = Object.freeze({
  DISABLED: 'DISABLED',
  CONNECTING: 'CONNECTING',
  ONLINE: 'ONLINE',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  RECONNECTING: 'RECONNECTING',
  UNAVAILABLE: 'UNAVAILABLE',
  FALLBACK_ACTIVE: 'FALLBACK_ACTIVE',
  ERROR: 'ERROR'
});

export const AUDIO_ROUTING_MODES = Object.freeze([
  'ORIGINAL_VIDEO_AUDIO_ONLY',
  'EXTERNAL_REPLACES_VIDEO_AUDIO',
  'MIX_VIDEO_AND_EXTERNAL_AUDIO',
  'MIX_MULTIPLE_EXTERNAL_SOURCES',
  'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO',
  'MICROPHONE_COMMENTARY_OVER_PROGRAM'
]);

export const AUDIO_AD_POLICIES = Object.freeze([
  'REPLACE_MUSIC_PAUSE_PLAYLIST',
  'REPLACE_MUSIC_CONTINUE_PLAYLIST',
  'DUCK_MUSIC_DURING_ADS',
  'IGNORE_AD_AUDIO'
]);

export const AUDIO_REPEAT_MODES = Object.freeze(['NONE', 'REPEAT_PLAYLIST', 'REPEAT_TRACK']);

export const CHANNEL_PLAYOUT_MODES = Object.freeze([
  'CAMERA_ROTATION',
  'MOVIE_PLAYOUT',
  'HYBRID_PLAYOUT'
]);

export const CHANNEL_DESIRED_STATES = Object.freeze({
  STOPPED: 'STOPPED',
  RUNNING: 'RUNNING'
});

export const CHANNEL_RUNTIME_STATES = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  DEGRADED: 'DEGRADED',
  RECOVERING: 'RECOVERING',
  FALLBACK_ACTIVE: 'FALLBACK_ACTIVE',
  STOPPING: 'STOPPING',
  FAILED: 'FAILED'
});

export const CHANNEL_FALLBACK_MODES = Object.freeze([
  'ALTERNATIVE_CAMERA',
  'ALTERNATIVE_VIDEO_SOURCE',
  'FALLBACK_VIDEO',
  'FALLBACK_IMAGE',
  'FALLBACK_PLAYLIST',
  'BLACK_SLATE'
]);

export const FULL_HD_CANVAS = Object.freeze({ width: 1920, height: 1080 });

export const SCHEDULE_TRACK_TYPES = Object.freeze([
  'MAIN_VIDEO',
  'LIVE_CAMERA_ROTATION',
  'INDEPENDENT_AUDIO',
  'ADVERTISEMENTS',
  'GRAPHICS_OVERLAYS',
  'NEWS_TICKER',
  'AUTOMATION_CONTROL'
]);

export const SCHEDULE_EXECUTION_MODES = Object.freeze([
  'HARD_START',
  'SOFT_START',
  'FOLLOW_PREVIOUS',
  'FIXED_DURATION',
  'MANUAL_TRIGGER',
  'EMERGENCY_OVERRIDE'
]);

export const SCHEDULE_LIFECYCLE_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  PUBLISHED: 'PUBLISHED',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED'
});

export const SCHEDULE_ACTIVATION_POLICIES = Object.freeze([
  'APPLY_IMMEDIATELY_SAFE',
  'APPLY_NEXT_BOUNDARY',
  'APPLY_FUTURE_TIME',
  'PRESERVE_CURRENT_ITEM',
  'REPLACE_CURRENT_AUTHORIZED'
]);

export const SCHEDULE_GAP_POLICIES = Object.freeze([
  'CONTINUE_CURRENT',
  'FALLBACK_PLAYLIST',
  'FALLBACK_MOVIE',
  'FALLBACK_CAMERA',
  'CHANNEL_IDENT_CLIP',
  'FALLBACK_IMAGE',
  'BLACK_SILENCE'
]);

export const SCHEDULE_RECURRENCE_FREQUENCIES = Object.freeze([
  'ONCE',
  'DAILY',
  'WEEKLY',
  'SELECTED_WEEKDAYS'
]);

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

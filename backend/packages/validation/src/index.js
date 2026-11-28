import { z } from 'zod';
import { OBS_COMMANDS, STATION_STATUS, STREAM_STATUS } from '@mcr/shared';

export const SecondFactorSchema = z.string().regex(/^(?:\d{6}|[a-zA-Z0-9_-]{16})$/);

export const LoginSchema = z.strictObject({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(4096),
  secondFactor: SecondFactorSchema.optional()
});

export const RefreshTokenSchema = z.strictObject({
  refreshToken: z.string().min(1).max(4096).optional()
});

export const StationListFiltersSchema = z.object({
  status: z.enum(STATION_STATUS).optional(),
  streamStatus: z.enum(STREAM_STATUS).optional()
});

export const CreateStationSchema = z.strictObject({
  name: z.string().min(2).max(100),
  studioId: z.string().uuid().nullable().optional(),
  description: z.string().max(500).optional().default(''),
  ipAddress: z.union([z.ipv4(), z.ipv6(), z.literal('localhost')]).default('127.0.0.1'),
  obsPort: z.number().int().min(1).max(65535).default(4455),
  obsPassword: z.string().max(255).optional()
});

export const UpdateStationSchema = z.strictObject({
  name: z.string().min(2).max(100).optional(),
  studioId: z.string().uuid().nullable().optional(),
  description: z.string().max(500).optional(),
  ipAddress: z.union([z.ipv4(), z.ipv6(), z.literal('localhost')]).optional(),
  obsPort: z.number().int().min(1).max(65535).optional(),
  obsPassword: z.string().max(255).optional()
});

export const ObsCommandSchema = z.object({
  command: z.string().min(1),
  params: z.record(z.string(), z.any()).default({})
});

export const SceneSwitchSchema = z.strictObject({
  sceneName: z.string().min(1, 'Scene name is required').max(250),
  preview: z.boolean().default(false)
});

export const AudioVolumeSchema = z.strictObject({
  inputName: z.string().min(1).max(250),
  inputVolumeMul: z.number().min(0).max(1).optional(),
  inputVolumeDb: z.number().min(-100).max(20).optional()
}).refine(
  (data) => data.inputVolumeMul !== undefined || data.inputVolumeDb !== undefined,
  { message: 'Provide inputVolumeMul or inputVolumeDb' }
);

export const AudioMuteSchema = z.strictObject({
  inputName: z.string().min(1).max(250),
  inputMuted: z.boolean()
});

export const PairDeviceSchema = z.object({
  pairingToken: z.string().min(6),
  machineHostname: z.string().min(1),
  osPlatform: z.string().min(1),
  agentVersion: z.string().min(1)
});

export const MacroCreateSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  shortcutKey: z.string().max(20).optional(),
  actions: z.array(z.object({
    stationId: z.string().uuid().nullable().optional(),
    actionType: z.string().min(1),
    parameters: z.record(z.string(), z.any()),
    sequenceOrder: z.number().int().nonnegative().default(0),
    delayMs: z.number().int().nonnegative().default(0)
  })).min(1, 'At least one action is required')
});

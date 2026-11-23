import { z } from 'zod';
import { OBS_COMMANDS } from '@mcr/shared';

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().optional()
});

export const CreateStationSchema = z.object({
  name: z.string().min(2).max(100),
  studioId: z.string().uuid().nullable().optional(),
  description: z.string().max(500).optional().default(''),
  ipAddress: z.union([z.ipv4(), z.ipv6(), z.literal('localhost')]).default('127.0.0.1'),
  obsPort: z.number().int().min(1).max(65535).default(4455),
  obsPassword: z.string().max(255).optional()
});

export const UpdateStationSchema = z.object({
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

export const SceneSwitchSchema = z.object({
  sceneName: z.string().min(1, 'Scene name is required'),
  preview: z.boolean().default(false)
});

export const AudioVolumeSchema = z.object({
  inputName: z.string().min(1),
  inputVolumeMul: z.number().min(0).max(1).optional(),
  inputVolumeDb: z.number().min(-100).max(20).optional()
});

export const AudioMuteSchema = z.object({
  inputName: z.string().min(1),
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

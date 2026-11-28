import { env } from '../../config/env.js';
import { PrismaStationRepository } from './prisma-station-repository.js';
import {
  PrismaAuditRepository,
  PrismaAudioRepository,
  PrismaBroadcastSchedulerRepository,
  PrismaChannelPlayoutRepository,
  PrismaMediaRepository,
  PrismaPairingRepository,
  PrismaUserRepository,
  PrismaVideoSourceRepository
} from './prisma-repositories.js';
import { SqliteStationRepository } from './sqlite-station-repository.js';
import { SqliteUserRepository } from './sqlite-user-repository.js';
import { SqliteAuditRepository } from './sqlite-audit-repository.js';
import { SqlitePairingRepository } from './sqlite-pairing-repository.js';
import { SqliteMediaRepository } from './sqlite-media-repository.js';
import { SqliteVideoSourceRepository } from './sqlite-video-source-repository.js';
import { SqliteAudioRepository } from './sqlite-audio-repository.js';
import { SqliteChannelPlayoutRepository } from './sqlite-channel-playout-repository.js';
import { SqliteBroadcastSchedulerRepository } from './sqlite-broadcast-scheduler-repository.js';

let stationRepoInstance = null;
let userRepoInstance = null;
let auditRepoInstance = null;
let pairingRepoInstance = null;
let mediaRepoInstance = null;
let videoSourceRepoInstance = null;
let audioRepoInstance = null;
let channelPlayoutRepoInstance = null;
let broadcastSchedulerRepoInstance = null;
let activeMode = null;

function ensureMode() {
  const mode = process.env.MCR_REPOSITORY_DRIVER || env.STORAGE_MODE || 'sqlite';
  if (activeMode !== mode) {
    stationRepoInstance = null;
    userRepoInstance = null;
    auditRepoInstance = null;
    pairingRepoInstance = null;
    mediaRepoInstance = null;
    videoSourceRepoInstance = null;
    audioRepoInstance = null;
    channelPlayoutRepoInstance = null;
    broadcastSchedulerRepoInstance = null;
    activeMode = mode;
  }
  return mode;
}

export class RepositoryFactory {
  static getStationRepository() {
    const mode = ensureMode();
    if (!stationRepoInstance) {
      stationRepoInstance = mode === 'mysql' ? new PrismaStationRepository() : new SqliteStationRepository();
    }
    return stationRepoInstance;
  }

  static getUserRepository() {
    const mode = ensureMode();
    if (!userRepoInstance) {
      userRepoInstance = mode === 'mysql' ? new PrismaUserRepository() : new SqliteUserRepository();
    }
    return userRepoInstance;
  }

  static getAuditRepository() {
    const mode = ensureMode();
    if (!auditRepoInstance) {
      auditRepoInstance = mode === 'mysql' ? new PrismaAuditRepository() : new SqliteAuditRepository();
    }
    return auditRepoInstance;
  }

  static getPairingRepository() {
    const mode = ensureMode();
    if (!pairingRepoInstance) {
      pairingRepoInstance = mode === 'mysql' ? new PrismaPairingRepository() : new SqlitePairingRepository();
    }
    return pairingRepoInstance;
  }

  static getMediaRepository() {
    const mode = ensureMode();
    if (!mediaRepoInstance) {
      mediaRepoInstance = mode === 'mysql' ? new PrismaMediaRepository() : new SqliteMediaRepository();
    }
    return mediaRepoInstance;
  }

  static getVideoSourceRepository() {
    const mode = ensureMode();
    if (!videoSourceRepoInstance) {
      videoSourceRepoInstance = mode === 'mysql' ? new PrismaVideoSourceRepository() : new SqliteVideoSourceRepository();
    }
    return videoSourceRepoInstance;
  }

  static getAudioRepository() {
    const mode = ensureMode();
    if (!audioRepoInstance) {
      audioRepoInstance = mode === 'mysql' ? new PrismaAudioRepository() : new SqliteAudioRepository();
    }
    return audioRepoInstance;
  }

  static getChannelPlayoutRepository() {
    const mode = ensureMode();
    if (!channelPlayoutRepoInstance) {
      channelPlayoutRepoInstance = mode === 'mysql'
        ? new PrismaChannelPlayoutRepository()
        : new SqliteChannelPlayoutRepository();
    }
    return channelPlayoutRepoInstance;
  }

  static getBroadcastSchedulerRepository() {
    const mode = ensureMode();
    if (!broadcastSchedulerRepoInstance) {
      broadcastSchedulerRepoInstance = mode === 'mysql'
        ? new PrismaBroadcastSchedulerRepository()
        : new SqliteBroadcastSchedulerRepository();
    }
    return broadcastSchedulerRepoInstance;
  }
}

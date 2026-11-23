import { env } from '../../config/env.js';
import { SqliteStationRepository } from './sqlite-station-repository.js';
import { SqliteUserRepository } from './sqlite-user-repository.js';
import { SqliteAuditRepository } from './sqlite-audit-repository.js';
import { SqlitePairingRepository } from './sqlite-pairing-repository.js';

let stationRepoInstance = null;
let userRepoInstance = null;
let auditRepoInstance = null;
let pairingRepoInstance = null;

export class RepositoryFactory {
  static getStationRepository() {
    if (!stationRepoInstance) {
      stationRepoInstance = new SqliteStationRepository();
    }
    return stationRepoInstance;
  }

  static getUserRepository() {
    if (!userRepoInstance) {
      userRepoInstance = new SqliteUserRepository();
    }
    return userRepoInstance;
  }

  static getAuditRepository() {
    if (!auditRepoInstance) {
      auditRepoInstance = new SqliteAuditRepository();
    }
    return auditRepoInstance;
  }

  static getPairingRepository() {
    if (!pairingRepoInstance) {
      pairingRepoInstance = new SqlitePairingRepository();
    }
    return pairingRepoInstance;
  }
}

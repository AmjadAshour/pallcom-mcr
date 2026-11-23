import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const CONFIG_DIR = process.env.MCR_AGENT_CONFIG_DIR || path.join(os.homedir(), '.mcr-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'credentials.json');

export class Keystore {
  static getDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    return CONFIG_DIR;
  }

  static saveConfig(config) {
    this.getDir();
    const temporaryFile = path.join(CONFIG_DIR, `credentials-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify(config, null, 2), {
        encoding: 'utf-8', mode: 0o600, flag: 'wx'
      });
      fs.renameSync(temporaryFile, CONFIG_FILE);
    } finally {
      fs.rmSync(temporaryFile, { force: true });
    }
  }

  static loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
      return null;
    }
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  static clear() {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  }
}

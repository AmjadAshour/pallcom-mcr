import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';

const SUBDIRECTORIES = Object.freeze(['media', 'uploads', 'thumbnails', 'processing', 'quarantine', 'imports']);
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]{1,80}$/;
const SAFE_KEY = /^(media|uploads|thumbnails|processing|quarantine)\/[a-zA-Z0-9_-]{1,80}\/[a-f0-9-]{36}\.(bin|part|jpg|png|mp4|m4a)$/;

export function sanitizeDisplayFilename(filename) {
  const base = path.basename(String(filename || 'media')).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').trim();
  return (base || 'media').slice(0, 200);
}

export class MediaStorageManager {
  constructor(rootDir = env.MEDIA_STORAGE_ROOT, importDir = env.MEDIA_IMPORT_DIR) {
    this.rootDir = path.resolve(rootDir);
    this.importDir = path.resolve(importDir);
    this.initialized = false;
  }

  async ensureInitialized() {
    if (this.initialized && fs.existsSync(path.join(this.rootDir, 'media'))) return;
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    for (const dir of SUBDIRECTORIES) {
      const target = dir === 'imports' ? this.importDir : path.join(this.rootDir, dir);
      await mkdir(target, { recursive: true, mode: 0o700 });
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw Object.assign(new Error('Storage directory failed integrity check'), { statusCode: 500 });
      }
    }
    this.initialized = true;
  }

  createStorageKey(zone, organizationId, id = randomUUID(), ext = 'bin') {
    if (!['media', 'uploads', 'thumbnails', 'processing', 'quarantine'].includes(zone)) {
      throw Object.assign(new Error('Invalid storage zone'), { statusCode: 400 });
    }
    const safeOrg = String(organizationId || 'default-org').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    if (!SAFE_SEGMENT.test(safeOrg) || !/^[a-f0-9-]{36}$/i.test(id)) {
      throw Object.assign(new Error('Invalid storage identity'), { statusCode: 400 });
    }
    const key = `${zone}/${safeOrg}/${id}.${ext}`;
    if (!SAFE_KEY.test(key)) {
      throw Object.assign(new Error('Invalid storage key'), { statusCode: 400 });
    }
    return key;
  }

  resolveKeyPath(storageKey) {
    if (typeof storageKey !== 'string' || !SAFE_KEY.test(storageKey)) {
      throw Object.assign(new Error('Invalid storage reference'), { statusCode: 400 });
    }
    const resolved = path.resolve(this.rootDir, ...storageKey.split('/'));
    const prefix = this.rootDir.endsWith(path.sep) ? this.rootDir : this.rootDir + path.sep;
    if (!resolved.startsWith(prefix)) {
      throw Object.assign(new Error('Storage path traversal blocked'), { statusCode: 400 });
    }
    return resolved;
  }

  async ensureKeyParent(storageKey) {
    await this.ensureInitialized();
    const targetPath = this.resolveKeyPath(storageKey);
    const dir = path.dirname(targetPath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const dirStat = await lstat(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw Object.assign(new Error('Storage parent directory is invalid'), { statusCode: 500 });
    }
    return targetPath;
  }

  async verifyNoSymlink(filePath) {
    const info = await lstat(filePath).catch(() => null);
    if (info?.isSymbolicLink()) {
      throw Object.assign(new Error('Symbolic links are prohibited in media storage'), { statusCode: 400 });
    }
    return info;
  }

  async getDiskSpace() {
    await this.ensureInitialized();
    if (process.env.MCR_TEST_SIMULATED_FREE_DISK_BYTES !== undefined) {
      const freeBytes = Number(process.env.MCR_TEST_SIMULATED_FREE_DISK_BYTES);
      const totalBytes = Math.max(freeBytes, 500 * 1024 ** 3);
      return {
        freeBytes,
        totalBytes,
        lowDiskAlert: freeBytes < env.MEDIA_LOW_DISK_ALERT_BYTES,
        exhausted: freeBytes < env.MEDIA_MIN_FREE_DISK_BYTES
      };
    }
    try {
      const stats = await statfs(this.rootDir);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      return {
        freeBytes,
        totalBytes,
        lowDiskAlert: freeBytes < env.MEDIA_LOW_DISK_ALERT_BYTES,
        exhausted: freeBytes < env.MEDIA_MIN_FREE_DISK_BYTES
      };
    } catch {
      return {
        freeBytes: env.MEDIA_ORG_QUOTA_BYTES,
        totalBytes: env.MEDIA_ORG_QUOTA_BYTES,
        lowDiskAlert: false,
        exhausted: false
      };
    }
  }

  async assertDiskHeadroom(requiredBytes = 0) {
    const disk = await this.getDiskSpace();
    if (disk.exhausted || disk.freeBytes - requiredBytes < env.MEDIA_MIN_FREE_DISK_BYTES) {
      throw Object.assign(new Error('Insufficient free disk space on media storage volume'), { statusCode: 507 });
    }
    return disk;
  }

  async computeFileSha256(storageKey) {
    const targetPath = this.resolveKeyPath(storageKey);
    const info = await this.verifyNoSymlink(targetPath);
    if (!info || !info.isFile()) {
      throw Object.assign(new Error('Media file not found'), { statusCode: 404 });
    }
    const hash = createHash('sha256');
    const handle = await open(targetPath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let offset = 0;
      while (offset < info.size) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      return { checksumSha256: hash.digest('hex'), sizeBytes: info.size };
    } finally {
      await handle.close();
    }
  }

  async storeBuffer(organizationId, id = randomUUID(), ext = 'bin', buffer = Buffer.alloc(0)) {
    const safeId = /^[a-f0-9-]{36}$/i.test(String(id)) ? String(id) : randomUUID();
    const cleanExt = String(ext || 'bin').replace(/^\./, '');
    const validExt = ['bin', 'part', 'jpg', 'png', 'mp4', 'm4a'].includes(cleanExt) ? cleanExt : 'bin';
    const storageKey = this.createStorageKey('media', organizationId, safeId, validExt);
    const targetPath = await this.ensureKeyParent(storageKey);
    await writeFile(targetPath, buffer);
    return { storageKey, targetPath, sizeBytes: buffer.length };
  }

  async promoteKey(sourceKey, destinationKey) {
    const sourcePath = this.resolveKeyPath(sourceKey);
    const destPath = await this.ensureKeyParent(destinationKey);
    await this.verifyNoSymlink(sourcePath);
    await this.verifyNoSymlink(destPath);
    await rename(sourcePath, destPath);
    return destPath;
  }

  async removeKey(storageKey) {
    if (!storageKey) return;
    const targetPath = this.resolveKeyPath(storageKey);
    await rm(targetPath, { force: true, maxRetries: 3, retryDelay: 50 });
  }

  async resolveImportSource(relativeFilePath) {
    await this.ensureInitialized();
    if (typeof relativeFilePath !== 'string' || !relativeFilePath.trim() ||
        relativeFilePath.includes('\0') || path.isAbsolute(relativeFilePath)) {
      throw Object.assign(new Error('Choose a valid relative filename inside the authorized import directory'), { statusCode: 400 });
    }
    const normalized = path.normalize(relativeFilePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const resolved = path.resolve(this.importDir, normalized);
    const prefix = this.importDir.endsWith(path.sep) ? this.importDir : this.importDir + path.sep;
    if (!resolved.startsWith(prefix) || resolved !== path.resolve(this.importDir, relativeFilePath)) {
      throw Object.assign(new Error('Import path traversal is not permitted'), { statusCode: 400 });
    }
    const currentDir = path.dirname(resolved);
    const dirInfo = await lstat(currentDir).catch(() => null);
    if (!dirInfo || dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
      throw Object.assign(new Error('Import directory is unavailable or invalid'), { statusCode: 400 });
    }
    const info = await lstat(resolved).catch(() => null);
    if (!info || info.isSymbolicLink() || !info.isFile()) {
      throw Object.assign(new Error('Import file not found or symbolic link rejected'), { statusCode: 404 });
    }
    return { resolvedPath: resolved, sizeBytes: info.size, filename: path.basename(resolved) };
  }

  async listImportableFiles() {
    await this.ensureInitialized();
    const entries = await readdir(this.importDir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries.slice(0, 200)) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const fullPath = path.join(this.importDir, entry.name);
      const info = await lstat(fullPath).catch(() => null);
      if (!info || info.isSymbolicLink() || !info.isFile()) continue;
      files.push({ filename: entry.name, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() });
    }
    return files.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  async detectOrphanedFiles(organizationId, knownKeys) {
    await this.ensureInitialized();
    const safeOrg = String(organizationId || 'default-org').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const activeSet = new Set(knownKeys);
    const orphans = [];
    for (const zone of ['media', 'uploads', 'thumbnails', 'processing', 'quarantine']) {
      const orgDir = path.join(this.rootDir, zone, safeOrg);
      const entries = await readdir(orgDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const key = `${zone}/${safeOrg}/${entry.name}`;
        if (!activeSet.has(key)) {
          const info = await stat(path.join(orgDir, entry.name)).catch(() => null);
          orphans.push({ storageKey: key, zone, sizeBytes: info?.size ?? 0 });
        }
      }
    }
    return orphans;
  }
}

export const mediaStorage = new MediaStorageManager();

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const extensions = new Set(['.mp4', '.mov', '.mxf', '.mkv', '.webm', '.avi', '.mpg', '.mpeg', '.ts', '.m4v']);
const limit = 500;

function inside(root, file) {
  const relative = path.relative(root, file);
  return Boolean(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function rootKey(root) {
  return createHash('sha256').update(root).digest('hex').slice(0, 16);
}

export class MediaLibrary {
  constructor({
    directories = (process.env.MCR_MEDIA_ROOTS || '').split(path.delimiter).filter(Boolean),
    executable = process.env.FFPROBE_PATH
  } = {}) {
    this.directories = directories.map((directory) => path.resolve(directory));
    this.executable = executable;
    this.cache = new Map();
  }

  async binary() {
    this.ffprobe ??= this.executable
      ? Promise.resolve(this.executable)
      : import('@ffprobe-installer/ffprobe').then(({ default: installer }) => installer.path).catch(() => 'ffprobe');
    return this.ffprobe;
  }

  async inspect(root, relative) {
    const assetId = rootKey(root) + ':' + Buffer.from(relative).toString('base64url');
    const title = path.basename(relative);
    let file, details;
    try {
      file = await realpath(path.resolve(root, relative));
      details = await stat(file);
      if (!inside(root, file) || !details.isFile() || !extensions.has(path.extname(file).toLowerCase())) throw new Error();
    } catch {
      return { assetId, title, health: 'missing' };
    }

    const cached = this.cache.get(assetId);
    if (cached?.size === details.size && cached?.mtimeMs === details.mtimeMs && cached?.file === file) return cached;
    let asset;
    try {
      const { stdout } = await execute(await this.binary(), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
        { timeout: 7000, maxBuffer: 1024 * 1024, windowsHide: true });
      const probe = JSON.parse(stdout);
      const video = probe.streams?.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
      const [numerator, denominator] = String(video?.time_base ?? '').split('/').map(Number);
      const duration = [probe.format?.duration, Number(video?.duration_ts) * numerator / denominator, video?.duration]
        .map(Number).find((value) => Number.isFinite(value) && value > 0);
      if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error();
      asset = { assetId, title, file, size: details.size, mtimeMs: details.mtimeMs,
        durationMs: Math.max(1, Math.round(duration * 1000)), width: video.width, height: video.height, health: 'ready' };
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('ffprobe is unavailable on the OBS Agent');
      asset = { assetId, title, file, size: details.size, mtimeMs: details.mtimeMs, health: 'unreadable' };
    }
    if (this.cache.size >= 2000) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(assetId, asset);
    return asset;
  }

  async scan() {
    this.scanInProgress ??= this.scanFolders().finally(() => { this.scanInProgress = null; });
    return this.scanInProgress;
  }

  async scanFolders() {
    if (!this.directories.length) throw new Error('Configure MCR_MEDIA_ROOTS on the OBS Agent');
    const work = [];
    const warnings = [];
    const roots = new Set();
    let truncated = false;
    for (const directory of this.directories) {
      try {
        const root = await realpath(directory);
        if (roots.has(root)) continue;
        roots.add(root);
        const folders = [root];
        let visited = 0;
        while (folders.length) {
          if (++visited > 2000 || work.length >= limit) { truncated = true; break; }
          const folder = folders.pop();
          let entries;
          try { entries = await readdir(folder, { withFileTypes: true }); }
          catch { warnings.push('An unreadable media directory was skipped'); continue; }
          for (const entry of entries) {
            const file = path.join(folder, entry.name);
            if (entry.isDirectory()) folders.push(file);
            if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
              work.push([root, path.relative(root, file)]);
              if (work.length >= limit) { truncated = true; break; }
            }
          }
        }
      } catch {
        warnings.push('A configured media directory was unavailable');
      }
    }
    const assets = [];
    await Promise.all(Array.from({ length: Math.min(8, work.length) }, async () => {
      while (work.length) {
        const entry = work.pop();
        if (!entry) return;
        const asset = await this.inspect(...entry);
        assets.push(this.publicAsset(asset));
      }
    }));
    return { assets: assets.sort((a, b) => a.title.localeCompare(b.title)), warnings: [...new Set(warnings)], truncated };
  }

  publicAsset({ assetId, title, durationMs, width, height, health }) {
    return { assetId, title, durationMs, width, height, health };
  }

  async get(assetId) {
    const [key, encoded, extra] = String(assetId).split(':');
    if (!/^[a-f0-9]{16}$/.test(key) || !/^[\w-]+$/.test(encoded ?? '') || extra !== undefined) {
      return { assetId, health: 'missing' };
    }
    const relative = Buffer.from(encoded, 'base64url').toString();
    if (path.isAbsolute(relative) || !relative || relative.includes('\0') ||
      Buffer.from(relative).toString('base64url') !== encoded) return { assetId, health: 'missing' };
    for (const directory of this.directories) {
      const root = await realpath(directory).catch(() => null);
      if (root && rootKey(root) === key && inside(root, path.resolve(root, relative))) return this.inspect(root, relative);
    }
    return { assetId, health: 'missing' };
  }

  async health(assetIds) {
    const results = [];
    for (let index = 0; index < assetIds.length; index += 8) {
      results.push(...await Promise.all(assetIds.slice(index, index + 8).map(async (id) => this.publicAsset(await this.get(id)))));
    }
    return results;
  }
}

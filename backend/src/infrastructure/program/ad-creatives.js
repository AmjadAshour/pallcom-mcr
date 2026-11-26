import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { PROGRAM_CANVAS, PROGRAM_SCENE_UPLOAD } from '@mcr/shared';

const run = promisify(execFile);
export async function prepareCreative(bytes, mime) {
  if (mime !== 'video/mp4') {
    const decoder = sharp(bytes, { limitInputPixels: 4096 * 2160, failOn: 'warning' });
    const meta = await decoder.metadata();
    if ('image/' + meta.format !== mime || (meta.pages ?? 1) !== 1) throw Error('Unsupported image');
    const media = await decoder
      .rotate()
      .resize(1280, 720, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return { kind: 'image', media, frames: [media] };
  }
  return withVideoDirectory(async directory => {
    await writeFile(join(directory, 'input.mp4'), bytes);
    return prepareVideo(directory, { maxFrames: 375, width: 640, height: 360 });
  });
}

export async function prepareSceneVideo(request) {
  return withVideoDirectory(async directory => {
    const file = await open(join(directory, 'input.mp4'), 'wx');
    try {
      let size = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > PROGRAM_SCENE_UPLOAD.maxMib * 1024 ** 2) {
          throw Object.assign(new Error('Video exceeds the upload limit'), { statusCode: 413 });
        }
        await file.writeFile(chunk);
      }
      if (!size) throw new Error('The video file is empty');
    } finally {
      await file.close();
    }
    return prepareVideo(directory, {
      maxFrames: PROGRAM_SCENE_UPLOAD.maxSeconds * 12.5, ...PROGRAM_CANVAS, maxPreparedBytes: 64 * 1024 ** 2,
      pad: true, timeout: 150000
    });
  });
}

async function withVideoDirectory(work) {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-creative-'));
  try { return await work(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function prepareVideo(directory, { maxFrames, width, height, maxPreparedBytes = Infinity, pad = false, timeout = Infinity }) {
  const deadline = Date.now() + timeout;
  const scale = 'scale=' + width + ':' + height + ':force_original_aspect_ratio=decrease:force_divisible_by=2';
  const canvas = pad ? ',pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2' : '';
  const ffmpeg = (args) =>
    run(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-v', 'error', '-threads', '2', ...args], {
      cwd: directory,
      windowsHide: true,
      timeout: Math.max(1, Math.min(90000, deadline - Date.now())),
      maxBuffer: 65536
    });
  await ffmpeg([
    '-protocol_whitelist',
    'file',
    '-f',
    'mov',
    '-max_pixels',
    '8847360',
    '-i',
    'input.mp4',
    '-map',
    '0:v:0',
    '-an',
    '-vf',
    'fps=25/2,' + scale + canvas + ',setsar=1',
    '-frames:v',
    String(maxFrames + 1),
    '-threads',
    '2',
    '-q:v',
    '4',
    '%04d.jpg'
  ]);
  const names = (await readdir(directory)).filter((n) => /^\d{4}\.jpg$/.test(n)).sort();
  if (!names.length || names.length > maxFrames) throw Error('Video exceeds the duration limit or contains no frames');
  await ffmpeg([
    '-framerate',
    '25/2',
    '-i',
    '%04d.jpg',
    '-protocol_whitelist',
    'file',
    '-f',
    'mov',
    '-i',
    'input.mp4',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0?',
    '-t',
    String(names.length * 0.08),
    '-af',
    'apad',
    '-c:a',
    'aac',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '2',
    '-movflags',
    '+faststart',
    'preview.mp4'
  ]);
  try {
    await ffmpeg(['-i', 'preview.mp4', '-vn', '-ac', '2', '-ar', '48000', '-f', 's16le', 'scene.pcm']);
  } catch (error) {
    if (!/Output file does not contain any stream/i.test(error.stderr ?? '')) throw error;
  }
  let preparedBytes = (await stat(join(directory, 'preview.mp4'))).size;
  const audioSize = await stat(join(directory, 'scene.pcm')).then(file => file.size, error => {
    if (error.code !== 'ENOENT') throw error;
    return 0;
  });
  preparedBytes += audioSize;
  const frames = [];
  for (const name of names) {
    const path = join(directory, name);
    preparedBytes += (await stat(path)).size;
    if (preparedBytes > maxPreparedBytes) {
      throw Object.assign(new Error('Prepared video is too large; use a shorter clip'), { statusCode: 413 });
    }
    frames.push(await readFile(path));
  }
  const pcm = await readFile(join(directory, 'scene.pcm')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  return { kind: 'video', media: await readFile(join(directory, 'preview.mp4')), frames, pcm };
}

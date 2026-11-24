import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

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
  const directory = await mkdtemp(join(tmpdir(), 'mcr-creative-'));
  const ffmpeg = (args) =>
    run(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-v', 'error', '-threads', '2', ...args], {
      cwd: directory,
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 65536
    });
  try {
    await writeFile(join(directory, 'input.mp4'), bytes);
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
      'fps=25/2,scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1',
      '-frames:v',
      '376',
      '-threads',
      '2',
      '-q:v',
      '4',
      '%04d.jpg'
    ]);
    const names = (await readdir(directory)).filter((n) => /^\d{4}\.jpg$/.test(n)).sort();
    if (!names.length || names.length > 375) throw Error('Video must contain 1–375 frames at 12.5 fps');
    await ffmpeg([
      '-framerate',
      '25/2',
      '-i',
      '%04d.jpg',
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
    const frames = [];
    for (const name of names) frames.push(await readFile(join(directory, name)));
    return { kind: 'video', media: await readFile(join(directory, 'preview.mp4')), frames };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

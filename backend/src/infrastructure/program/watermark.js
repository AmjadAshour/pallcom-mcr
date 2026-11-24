import sharp from 'sharp';
import { PROGRAM_CANVAS, watermarkBounds } from '@mcr/shared';
import { getSqliteDatabase } from '../database/sqlite.js';

export const defaultWatermark = { enabled: false, anchor: 'top-right', x: 3, y: 3, size: 12, opacity: 100, image: '' };

export function storedWatermark(stationId) {
  return getSqliteDatabase().prepare('SELECT revision, bitmap FROM program_watermarks WHERE stationId = ?').get(stationId)
    ?? { revision: 0, bitmap: '' };
}

export async function renderWatermark(settings, image) {
  if (!image) return '';
  const decoder = sharp(image.bytes, { limitInputPixels: 4096 * 2160, failOn: 'warning' });
  const meta = await decoder.metadata();
  if (meta.format !== image.type || meta.width > 4096 || meta.height > 4096 || (meta.pages ?? 1) !== 1) {
    throw new Error('Unsupported logo');
  }
  const box = watermarkBounds(settings);
  const { data: rgba, info } = await decoder.rotate().resize(box.width, box.height, { fit: 'inside' })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!settings.enabled) return '';
  const data = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .linear([1, 1, 1, settings.opacity / 100], [0, 0, 0, 0]).png().toBuffer();
  const left = box.left + (box.right ? box.width - info.width : 0);
  const top = box.top + (box.bottom ? box.height - info.height : 0);
  return (await sharp({ create: { ...PROGRAM_CANVAS, channels: 4, background: '#00000000' } })
    .composite([{ input: data, left, top }]).png().toBuffer()).toString('base64');
}

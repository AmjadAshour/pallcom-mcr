import sharp from 'sharp';
import { getSqliteDatabase } from '../database/sqlite.js';

const defaults = { enabled: false, text: '', speed: 140, direction: 'left' };

export function storedTicker(stationId) {
  const row = getSqliteDatabase().prepare('SELECT revision, settings, bitmap FROM program_tickers WHERE stationId=?').get(stationId);
  return row ? { ...row, settings: JSON.parse(row.settings) }
    : { revision: 0, settings: defaults, bitmap: '' };
}

export async function renderTicker({ enabled, text }) {
  if (!enabled) return '';
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const bitmap = await sharp({ text: { text: '<span foreground="white">' + escaped + '</span>', font: 'Sans Bold 24', rgba: true } })
    .resize({ height: 30, withoutEnlargement: true }).flatten({ background: '#111827' }).png().toBuffer();
  const { width, height } = await sharp(bitmap).metadata();
  return (await sharp({ create: { width, height: 44, channels: 3, background: '#111827' } })
    .composite([{ input: bitmap, left: 0, top: Math.floor((44 - height) / 2) }]).png().toBuffer()).toString('base64');
}

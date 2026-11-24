import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { defaultWatermark, renderWatermark } from '../src/infrastructure/program/watermark.js';

test('Program watermark opacity handles opaque images and preserves source alpha', async () => {
  const settings = { ...defaultWatermark, enabled: true, anchor: 'top-left', x: 0, y: 0, opacity: 50 };
  for (const [format, channels, alpha] of [
    ['png', 3, 1],
    ['jpeg', 3, 1],
    ['png', 4, 0.5]
  ]) {
    const bytes = await sharp({
      create: { width: 24, height: 12, channels, background: { r: 0, g: 255, b: 0, alpha } }
    })
      .toFormat(format)
      .toBuffer();
    const encoded = await renderWatermark(settings, { type: format, bytes });
    const pixel = await sharp(Buffer.from(encoded, 'base64'))
      .extract({ left: 3, top: 3, width: 1, height: 1 })
      .raw()
      .toBuffer();
    assert(Math.abs(pixel[3] - Math.round(255 * alpha * 0.5)) <= 1, format + ' alpha ' + pixel[3]);
  }
});

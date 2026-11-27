import { createHmac, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes) {
  let result = '';
  let remainder = 0;
  let bits = 0;
  for (const byte of bytes) {
    remainder = (remainder << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(remainder >>> bits) & 31];
    }
  }
  return bits ? result + alphabet[(remainder << (5 - bits)) & 31] : result;
}

export function totpCode(secret, step, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

export function matchingTotpStep(secret, code, lastStep, now = Date.now()) {
  if (!/^\d{6}$/.test(code ?? '')) return null;
  const step = Math.floor(now / 30000);
  const offered = Buffer.from(code, 'ascii');
  for (const candidate of [step, step - 1]) {
    if (candidate > lastStep && candidate >= 0 &&
        timingSafeEqual(Buffer.from(totpCode(secret, candidate), 'ascii'), offered)) return candidate;
  }
  return null;
}

import { timingSafeEqual } from 'node:crypto';

const tokenPattern = /^[a-f0-9]{64}$/;
const reports = new Map();

function receiverToken(destination) {
  const value = {
    primary: process.env.MCR_PROGRAM_SRT_RECEIVER_TOKEN,
    secondary: process.env.MCR_PROGRAM_SECOND_SRT_RECEIVER_TOKEN,
  }[destination];
  return typeof value === 'string' && tokenPattern.test(value) ? value : null;
}

export function authorizeReceiver(destination, authorization) {
  const expected = receiverToken(destination);
  const supplied = authorization?.slice(7);
  return Boolean(expected && authorization.startsWith('Bearer ') && tokenPattern.test(supplied) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)));
}

export function recordReceiver(destination, session, { video, audio }) {
  reports.set(destination, { session, video, audio, at: performance.now() });
}

export function receiverHealth(destination, session) {
  if (!receiverToken(destination)) return undefined;
  const report = reports.get(destination);
  if (!report || report.session !== session) return 'waiting';
  if (performance.now() - report.at >= 8000) return 'offline';
  if (report.video && report.audio) return 'decoding';
  if (report.video) return 'video-only';
  if (report.audio) return 'audio-only';
  return 'no-media';
}

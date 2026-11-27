import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';

function credentialLimiter(error) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error },
    standardHeaders: true,
    legacyHeaders: false
  });
}

export const authLimiter = credentialLimiter('Too many login attempts. Please try again in 15 minutes.');
export const pairingClaimLimiter = credentialLimiter('Too many pairing attempts. Please try again in 15 minutes.');

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300,               // 300 requests per minute
  message: {
    success: false,
    error: 'Rate limit exceeded. Too many broadcast requests.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

export const accountLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => createHash('sha256').update(req.body.email.trim().toLowerCase()).digest('hex'),
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const mediaUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  keyGenerator: (req) => req.user.id,
  message: { success: false, error: 'Too many media upload attempts. Retry in a minute.' },
  standardHeaders: true,
  legacyHeaders: false
});

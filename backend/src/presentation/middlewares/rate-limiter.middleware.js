import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 requests per window per IP
  message: {
    success: false,
    error: 'Too many login attempts. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

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

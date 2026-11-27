import { env } from '../../config/env.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const sessionCookie = /(?:^|;)\s*mcr_(?:access|refresh)_token\s*=/;

export function requireMutationOrigin(req, res, next) {
  if (safeMethods.has(req.method)) return next();
  const origin = req.get('Origin');
  const site = req.get('Sec-Fetch-Site');
  const allowedOrigin = origin === env.CORS_ORIGIN ||
    (!env.REQUIRE_PRIVATE_SECRETS && origin === req.protocol + '://' + req.get('Host'));
  const usesSessionCookie = sessionCookie.test(req.get('Cookie') ?? '');
  if (site !== 'cross-site' && (origin ? allowedOrigin : (!usesSessionCookie || site === 'same-origin'))) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Request origin is not allowed' });
}

import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { hasPermission } from './rbac.middleware.js';
import { activeSessionUser, sessionUser } from '../../infrastructure/security/session-service.js';

export function hasCurrentPermission(user, permission) {
  const current = activeSessionUser(user.sessionId, user.id);
  return current?.organizationId === user.organizationId && hasPermission(current.role, permission);
}

export function authenticate(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.mcr_access_token) {
    token = req.cookies.mcr_access_token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. No token provided.'
    });
  }

  try {
    const decoded = CryptoService.verifyAccessToken(token);
    const user = sessionUser(decoded);
    if (!user) return res.status(401).json({ success: false, error: 'Invalid session or inactive user.' });
    req.user = { ...user, sessionId: decoded.sid };
    res.locals.accessTokenExpiresAt = decoded.exp * 1000;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authentication token.'
    });
  }
}

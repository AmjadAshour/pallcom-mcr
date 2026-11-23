import { CryptoService } from '../../infrastructure/security/crypto-service.js';

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
    req.user = {
      id: decoded.sub || decoded.id,
      email: decoded.email,
      organizationId: decoded.organizationId || 'default-org',
      role: decoded.role || 'VIEWER'
    };
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authentication token.'
    });
  }
}

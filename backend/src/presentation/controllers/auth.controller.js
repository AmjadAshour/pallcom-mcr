import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { env, isExposedBootstrapPassword } from '../../config/env.js';
import { ROLE_PERMISSIONS } from '@mcr/shared';
import { RefreshTokenSchema } from '@mcr/validation';
import { createSession, revokeSession, rotateSession } from '../../infrastructure/security/session-service.js';

const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict' };

function exposeClientToken(req) {
  return !req.get('Origin') && !req.get('Sec-Fetch-Site') &&
    !req.cookies?.mcr_access_token && !req.cookies?.mcr_refresh_token;
}

function setSessionCookies(res, userId, sessionId, tokens) {
  const accessToken = CryptoService.signAccessToken({ sub: userId, sid: sessionId });
  res.cookie('mcr_access_token', accessToken, {
    ...cookieOptions, expires: new Date(CryptoService.verifyAccessToken(accessToken).exp * 1000)
  });
  res.cookie('mcr_refresh_token', tokens.refresh, { ...cookieOptions, expires: new Date(tokens.expiresAt) });
  return accessToken;
}

export class AuthController {
  static async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const userRepo = RepositoryFactory.getUserRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();

      const user = await userRepo.findByEmail(email);
      if (!user?.isActive) {
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      const usingExposedBootstrapPassword = env.REQUIRE_PRIVATE_SECRETS &&
        user.email === 'admin@mcrpro.local' && isExposedBootstrapPassword(password);
      const isValidPassword = await CryptoService.verifyPassword(user.passwordHash, password) &&
        !usingExposedBootstrapPassword;
      if (!isValidPassword) {
        await auditRepo.create({
          organizationId: user.organizationId || 'default-org',
          userId: user.id,
          action: 'LOGIN_FAILED',
          resourceType: 'User',
          resourceId: user.id,
          details: { reason: 'Invalid password' },
          ipAddress: req.ip
        });
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      await auditRepo.create({
        organizationId: user.organizationId || 'default-org',
        userId: user.id,
        action: 'LOGIN_SUCCESS',
        resourceType: 'User',
        resourceId: user.id,
        ipAddress: req.ip
      });

      const session = createSession(user.id);
      const accessToken = setSessionCookies(res, user.id, session.id, session);
      return res.json({
        success: true,
        ...(exposeClientToken(req) && { accessToken }),
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          organizationId: user.organizationId || 'default-org',
          permissions: ROLE_PERMISSIONS[user.role] || []
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async refresh(req, res, next) {
    try {
      const cookieToken = req.cookies?.mcr_refresh_token;
      const payload = RefreshTokenSchema.safeParse(cookieToken ? { refreshToken: cookieToken } : (req.body ?? {}));
      if (!payload.success) {
        return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
      }
      const { refreshToken } = payload.data;
      if (!refreshToken) {
        return res.status(401).json({ success: false, error: 'No refresh token provided' });
      }

      const decoded = CryptoService.verifyRefreshToken(refreshToken);
      const userRepo = RepositoryFactory.getUserRepository();
      const user = await userRepo.findById(decoded.sub);

      if (!user || !user.isActive) {
        return res.status(401).json({ success: false, error: 'Invalid session or inactive user' });
      }

      const tokens = rotateSession(decoded, refreshToken);
      if (!tokens) return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
      const newAccessToken = setSessionCookies(res, user.id, decoded.sid, tokens);

      return res.json({
        success: true,
        ...(exposeClientToken(req) && { accessToken: newAccessToken })
      });
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }
  }

  static async logout(req, res, next) {
    try {
      const access = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7) : req.cookies?.mcr_access_token;
      let identity;
      try { if (access) identity = CryptoService.verifyAccessToken(access); } catch { /* Try refresh below. */ }
      try {
        if (!identity?.sid && req.cookies?.mcr_refresh_token) {
          identity = CryptoService.verifyRefreshToken(req.cookies.mcr_refresh_token);
        }
      } catch { /* An expired session only needs cookie cleanup. */ }
      if (identity?.sid) revokeSession(identity.sid, identity.sub);
      res.clearCookie('mcr_access_token', cookieOptions);
      res.clearCookie('mcr_refresh_token', cookieOptions);
      const user = identity?.sub && await RepositoryFactory.getUserRepository().findById(identity.sub);

      if (user) {
        const auditRepo = RepositoryFactory.getAuditRepository();
        await auditRepo.create({
          organizationId: user.organizationId || 'default-org',
          userId: user.id,
          action: 'LOGOUT',
          resourceType: 'User',
          resourceId: user.id,
          ipAddress: req.ip
        });
      }

      return res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  }

  static async me(req, res, next) {
    try {
      const userRepo = RepositoryFactory.getUserRepository();
      const user = await userRepo.findById(req.user.id);

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      return res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: req.user.role,
          organizationId: req.user.organizationId,
          permissions: ROLE_PERMISSIONS[req.user.role] || []
        }
      });
    } catch (err) {
      next(err);
    }
  }
}

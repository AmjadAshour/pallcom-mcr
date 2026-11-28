import { randomBytes } from 'node:crypto';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { env, isExposedBootstrapPassword } from '../../config/env.js';
import { ROLE_PERMISSIONS } from '@mcr/shared';
import { RefreshTokenSchema } from '@mcr/validation';
import { revokeSession, rotateSession } from '../../infrastructure/security/session-service.js';
import { accountError, changeAccountPassword, changeAccountRole, changeAccountStatus, listOwnSessions, revokeOwnSession, updateProfile } from '../../infrastructure/security/account-management.js';
import { findResetGrant, finishPasswordReset, recoveryEnabled, requestPasswordReset } from '../../infrastructure/security/password-recovery.js';
import { confirmMfa, disableMfa, mfaEnabled, startMfa, startVerifiedLogin } from '../../infrastructure/security/account-mfa.js';

const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict' };
let dummyPasswordHash;

function clearSessionCookies(res) {
  res.clearCookie('mcr_access_token', cookieOptions);
  res.clearCookie('mcr_refresh_token', cookieOptions);
}

async function verifyCurrentPassword(req) {
  const user = await RepositoryFactory.getUserRepository().findByEmail(req.user.email);
  if (user?.id !== req.user.id || !user.isActive ||
      !await CryptoService.verifyPassword(user.passwordHash, req.body.currentPassword)) {
    throw accountError(403, 'Current password is incorrect.');
  }
  return user.passwordHash;
}

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
      const { email, password, secondFactor } = req.body;
      const userRepo = RepositoryFactory.getUserRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();

      const user = await userRepo.findByEmail(email);
      dummyPasswordHash ??= CryptoService.hashPassword(randomBytes(32).toString('hex'));
      const dummy = await dummyPasswordHash;
      const isValidPassword = await CryptoService.verifyPassword(user?.isActive ? user.passwordHash : dummy, password);
      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }
      if (!user.isActive) {
        await auditRepo.create({
          organizationId: user.organizationId || 'default-org',
          userId: user.id,
          action: 'LOGIN_FAILED',
          resourceType: 'User',
          resourceId: user.id,
          details: { reason: 'Account inactive' },
          ipAddress: req.ip
        });
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      const usingExposedBootstrapPassword = env.REQUIRE_PRIVATE_SECRETS &&
        user.email === 'admin@mcrpro.local' && isExposedBootstrapPassword(password);
      if (!isValidPassword || usingExposedBootstrapPassword) {
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

      const { current, session, secondFactorRequired } = startVerifiedLogin(user, req.ip, secondFactor);
      if (secondFactorRequired) return res.status(401).json({
        success: false, error: 'Enter a verification or recovery code.', details: 'second-factor-required'
      });
      if (!session) return res.status(401).json({ success: false, error: 'Invalid email or password' });
      const accessToken = setSessionCookies(res, current.id, session.id, session);
      return res.json({
        success: true,
        ...(exposeClientToken(req) && { accessToken }),
        user: {
          ...current,
          permissions: ROLE_PERMISSIONS[current.role] || []
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
      clearSessionCookies(res);
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

  static profile(req, res, next) {
    try {
      updateProfile(req.user, req.ip, req.body.fullName);
      return AuthController.me(req, res, next);
    } catch (error) {
      next(error);
    }
  }

  static async password(req, res, next) {
    try {
      const currentHash = await verifyCurrentPassword(req);
      const { currentPassword, newPassword } = req.body;
      if (newPassword === currentPassword || isExposedBootstrapPassword(newPassword)) {
        throw accountError(400, 'Choose a different password.');
      }
      const newHash = await CryptoService.hashPassword(newPassword);
      changeAccountPassword(req.user, req.ip, currentHash, newHash);
      clearSessionCookies(res);
      return res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static sessions(req, res, next) {
    try {
      return res.json({ success: true, data: listOwnSessions(req.user) });
    } catch (error) {
      next(error);
    }
  }

  static revoke(req, res, next) {
    try {
      revokeOwnSession(req.user, req.ip, req.params.id);
      if (req.params.id === req.user.sessionId) clearSessionCookies(res);
      return res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static async accountStatus(req, res, next) {
    try {
      const currentHash = await verifyCurrentPassword(req);
      changeAccountStatus(req.user, req.ip, currentHash, req.params.id, req.body.active);
      return res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static async accountRole(req, res, next) {
    try {
      const currentHash = await verifyCurrentPassword(req);
      changeAccountRole(req.user, req.ip, currentHash, req.params.id, req.body.role);
      return res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static recovery(_req, res) {
    return res.json({ success: true, enabled: recoveryEnabled });
  }

  static forgotPassword(req, res) {
    requestPasswordReset(req.body.email, req.ip);
    return res.status(202).json({ success: true });
  }

  static async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;
      const hash = CryptoService.hashToken(token);
      if (!recoveryEnabled || !findResetGrant(hash)) throw accountError(400, 'Invalid or expired password reset link.');
      if (isExposedBootstrapPassword(newPassword)) throw accountError(400, 'Choose a different password.');
      finishPasswordReset(hash, await CryptoService.hashPassword(newPassword), req.ip);
      clearSessionCookies(res);
      return res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static twoFactor(req, res, next) {
    try {
      return res.json({ success: true, enabled: mfaEnabled(req.user.id) });
    } catch (error) {
      next(error);
    }
  }

  static async beginTwoFactor(req, res, next) {
    try {
      const secret = startMfa(req.user, req.ip, await verifyCurrentPassword(req));
      return res.json({ success: true, secret });
    } catch (error) {
      next(error);
    }
  }

  static async confirmTwoFactor(req, res, next) {
    try {
      const recoveryCodes = confirmMfa(req.user, req.ip, await verifyCurrentPassword(req), req.body.secondFactor);
      clearSessionCookies(res);
      return res.json({ success: true, recoveryCodes });
    } catch (error) {
      next(error);
    }
  }

  static async disableTwoFactor(req, res, next) {
    try {
      disableMfa(req.user, req.ip, await verifyCurrentPassword(req), req.body.secondFactor);
      clearSessionCookies(res);
      return res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}

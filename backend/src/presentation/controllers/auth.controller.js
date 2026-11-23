import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { env } from '../../config/env.js';
import { ROLE_PERMISSIONS } from '@mcr/shared';

export class AuthController {
  static async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const userRepo = RepositoryFactory.getUserRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();

      const user = await userRepo.findByEmail(email);
      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      if (!user.isActive) {
        return res.status(403).json({ success: false, error: 'Account has been deactivated' });
      }

      const isValidPassword = await CryptoService.verifyPassword(user.passwordHash, password);
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

      const tokenPayload = {
        sub: user.id,
        email: user.email,
        organizationId: user.organizationId || 'default-org',
        role: user.role
      };

      const accessToken = CryptoService.signAccessToken(tokenPayload);
      const refreshToken = CryptoService.signRefreshToken({ sub: user.id });

      // Set HttpOnly, Secure, SameSite Cookie
      res.cookie('mcr_access_token', accessToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000 // 15 mins
      });

      res.cookie('mcr_refresh_token', refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      await auditRepo.create({
        organizationId: user.organizationId || 'default-org',
        userId: user.id,
        action: 'LOGIN_SUCCESS',
        resourceType: 'User',
        resourceId: user.id,
        ipAddress: req.ip
      });

      return res.json({
        success: true,
        accessToken,
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
      const refreshToken = req.cookies?.mcr_refresh_token || req.body?.refreshToken;
      if (!refreshToken) {
        return res.status(401).json({ success: false, error: 'No refresh token provided' });
      }

      const decoded = CryptoService.verifyRefreshToken(refreshToken);
      const userRepo = RepositoryFactory.getUserRepository();
      const user = await userRepo.findById(decoded.sub);

      if (!user || !user.isActive) {
        return res.status(401).json({ success: false, error: 'Invalid session or inactive user' });
      }

      const tokenPayload = {
        sub: user.id,
        email: user.email,
        organizationId: user.organizationId || 'default-org',
        role: user.role
      };

      const newAccessToken = CryptoService.signAccessToken(tokenPayload);
      const newRefreshToken = CryptoService.signRefreshToken({ sub: user.id });

      res.cookie('mcr_access_token', newAccessToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000
      });

      res.cookie('mcr_refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      return res.json({
        success: true,
        accessToken: newAccessToken
      });
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }
  }

  static async logout(req, res, next) {
    try {
      res.clearCookie('mcr_access_token');
      res.clearCookie('mcr_refresh_token');

      if (req.user) {
        const auditRepo = RepositoryFactory.getAuditRepository();
        await auditRepo.create({
          organizationId: req.user.organizationId,
          userId: req.user.id,
          action: 'LOGOUT',
          resourceType: 'User',
          resourceId: req.user.id,
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

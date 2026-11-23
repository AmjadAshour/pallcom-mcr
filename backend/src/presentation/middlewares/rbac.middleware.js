import { ROLES, ROLE_PERMISSIONS } from '@mcr/shared';

export function authorize(requiredPermission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const userRole = req.user.role;

    // Super Admin has unrestricted access to everything
    if (userRole === ROLES.SUPER_ADMIN) {
      return next();
    }

    const userPermissions = ROLE_PERMISSIONS[userRole] || [];

    if (userPermissions.includes('*') || userPermissions.includes(requiredPermission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: `Access Denied: Role [${userRole}] lacks permission [${requiredPermission}].`
    });
  };
}

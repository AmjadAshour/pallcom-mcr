import { ROLES, ROLE_PERMISSIONS } from '@mcr/shared';

export function hasPermission(role, permission) {
  if (!Object.hasOwn(ROLE_PERMISSIONS, role)) return false;
  const permissions = ROLE_PERMISSIONS[role];
  return role === ROLES.SUPER_ADMIN || permissions.includes('*') || permissions.includes(permission);
}

export function authorize(requiredPermission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const userRole = req.user.role;

    if (hasPermission(userRole, requiredPermission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: `Access Denied: Role [${userRole}] lacks permission [${requiredPermission}].`
    });
  };
}

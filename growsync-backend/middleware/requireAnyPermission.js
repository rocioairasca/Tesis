const { getEffectivePermissions } = require('../constants/permissions');

const requireAnyPermission = (...allowedPermissions) => {
  return (req, res, next) => {
    const permissions = getEffectivePermissions(req.user);
    const allowed = permissions.includes('all')
      || allowedPermissions.some(permission => permissions.includes(permission));

    if (!allowed) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'No tienes permiso para realizar esta accion',
      });
    }

    next();
  };
};

module.exports = requireAnyPermission;

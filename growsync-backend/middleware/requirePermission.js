const { getEffectivePermissions } = require("../constants/permissions");

const requirePermission = (permission) => {
  return (req, res, next) => {
    const permissions = getEffectivePermissions(req.user);

    const hasPermission =
      permissions.includes("all") || permissions.includes(permission);

    if (!hasPermission) {
      return res.status(403).json({
        error: "Forbidden",
        message: "No tienes permiso para realizar esta accion",
      });
    }

    next();
  };
};

module.exports = requirePermission;
const requirePermission = require('./requirePermission');

// Match each existing controller's interpretation without changing query parsing (Q08).
module.exports = (permission, includesDisabled) => (req, res, next) => {
  if (includesDisabled(req.query)) return requirePermission(permission)(req, res, next);
  return next();
};

const crypto = require('crypto');

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

module.exports = function requireAdminSecret(req, res, next) {
  const configuredSecret = process.env.ADMIN_COMPANY_INVITATION_SECRET;

  if (!configuredSecret) {
    return res.status(500).json({
      error: 'ServerConfig',
      message: 'Falta configurar ADMIN_COMPANY_INVITATION_SECRET',
    });
  }

  const authHeader = req.get('authorization') || '';
  const bearerSecret = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;
  const headerSecret = req.get('x-admin-secret');
  const receivedSecret = headerSecret || bearerSecret;

  if (!receivedSecret || !safeCompare(receivedSecret, configuredSecret)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No autorizado',
    });
  }

  return next();
};

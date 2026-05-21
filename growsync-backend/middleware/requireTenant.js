const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = function requireTenant(req, res, next) {
  const companyId = req.user?.company_id;

  if (!companyId) {
    return res.status(403).json({
      error: 'TenantRequired',
      message: 'Usuario sin empresa asignada',
    });
  }

  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    return res.status(403).json({
      error: 'InvalidTenant',
      message: 'Empresa invalida para el usuario autenticado',
    });
  }

  req.tenant = {
    company_id: companyId,
  };

  return next();
};

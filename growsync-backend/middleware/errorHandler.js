// error handler centralizado
// - devuelve json
// - maneja unauthorazederorr (jwt), syntaxerror (json), validationerror (zod)
// - mapea codigos comunes de postgres, supabase

module.exports = (err, req, res, _next) => {
  // Si ya se enviaron headers, delegar a Express
  if (res.headersSent) return _next(err);

  // Log interno siempre
  console.error('❌ Error:', {
    name: err.name,
    type: err.type,
    message: err.message,
    code: err.code,
    status: err.status
  });

  // 1) Token invalido / ausente (express-jwt)
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: err.message || 'Token inválido o ausente',
    });
  }

  // 2) JSON malformado (body-parser / express.json)
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'JSON malformado en el cuerpo de la petición',
    });
  }

  // 3) Validaciones (middleware validate + Zod)
  if (err.type === 'validation') {
    return res.status(err.status || 400).json({
      error: 'ValidationError',
      details: err.details || [{ message: err.message || 'Datos inválidos' }],
    });
  }

  // 4) Zod no atrapado por validate (por si algun controlador usa Zod directo)
  if (err.name === 'ZodError' && err.errors) {
    const details = err.errors.map(({ path, message, code }) => ({
      path: Array.isArray(path) ? path.join('.') : String(path),
      code,
      message,
    }));
    return res.status(400).json({ error: 'ValidationError', details });
  }

  // 5) Errores Postgres / Supabase comunes
  const pgCode = err.code;
  if (pgCode) {
    // Unique violation
    if (pgCode === '23505') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Registro duplicado (violación de unicidad).',
        hint: err.detail || err.hint,
      });
    }
    // Foreign key violation
    if (pgCode === '23503') {
      return res.status(409).json({
        error: 'ForeignKeyViolation',
        message: 'Violación de clave foránea.',
        hint: err.detail || err.hint,
      });
    }
    // Check violation
    if (pgCode === '23514') {
      return res.status(400).json({
        error: 'CheckViolation',
        message: 'Violación de restricción CHECK.',
        hint: err.detail || err.hint,
      });
    }
    // Not-null
    if (pgCode === '23502') {
      return res.status(400).json({
        error: 'NotNullViolation',
        message: 'Campo requerido ausente (NOT NULL).',
        hint: err.column ? `Columna: ${err.column}` : undefined,
      });
    }
    // Invalid text representation (UUID invalido, etc.)
    if (pgCode === '22P02') {
      return res.status(400).json({
        error: 'InvalidTextRepresentation',
        message: 'Formato inválido en algún campo (ej: UUID).',
      });
    }
  }

  // 6) Supabase error generico
  if (err.message && err.hint && err.details) {
    return res.status(400).json({
      error: 'DatabaseError',
      message: err.message,
      hint: err.hint,
      details: err.details,
    });
  }
};

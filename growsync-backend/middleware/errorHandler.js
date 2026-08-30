// error handler centralizado
// - devuelve json con mensajes aptos para el usuario
// - conserva los detalles técnicos únicamente en logs del servidor
// - maneja errores de auth, JSON, validación, Postgres y Supabase

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

  const statusMessage = (status) => {
    if (status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
    if (status === 403) return 'No tenés permiso para realizar esta acción.';
    if (status === 404) return 'No encontramos el registro solicitado.';
    if (status === 409) return 'No se pudo guardar porque hay un conflicto con datos existentes.';
    if (status >= 500) return 'No se pudo completar la operación. Intentá nuevamente en unos minutos.';
    return 'Revisá los datos ingresados e intentá nuevamente.';
  };

  const looksTechnical = (value) => {
    if (!value || typeof value !== 'string') return false;
    return [
      /\/api\//i,
      /\b(endpoint|request|response|backend|frontend|controller|route|stack|trace)\b/i,
      /\b(jwt|token|bearer|unauthorized|badrequest|internalservererror)\b/i,
      /\b(status\s*)?(400|401|403|404|409|500|502)\b/i,
      /\b(uuid|sql|postgres|postg|supabase|constraint|violates|duplicate key|null value|foreign key|not null)\b/i,
      /\b(company_id|crop_id|lot_id|sub_lot_id|planning_id|layout_id|product_id|vehicle_id|user_id)\b/i,
      /\b(PGRST|ECONN|ENOTFOUND|ETIMEDOUT|CORS)\b/i,
    ].some((pattern) => pattern.test(value));
  };

  const safeMessage = (value, fallback) => (
    value && !looksTechnical(value) ? value : fallback
  );

  const safeDetailMessages = (details) => (
    Array.isArray(details)
      ? details
        .map((detail) => detail?.message)
        .filter(Boolean)
        .slice(0, 5)
      : []
  );

  // 1) Sesión inválida o vencida
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      message: statusMessage(401),
    });
  }

  // 2) Datos enviados con formato inválido
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({
      message: 'No pudimos procesar la información enviada. Revisá los datos e intentá nuevamente.',
    });
  }

  // 3) Validaciones (middleware validate + Zod)
  if (err.type === 'validation') {
    const details = safeDetailMessages(err.details);
    return res.status(err.status || 400).json({
      message: details[0] || err.message || statusMessage(400),
      details,
    });
  }

  // 4) Zod no atrapado por validate (por si algun controlador usa Zod directo)
  if (err.name === 'ZodError' && err.errors) {
    const details = err.errors.map(({ message }) => message).filter(Boolean).slice(0, 5);
    return res.status(400).json({
      message: details[0] || statusMessage(400),
      details,
    });
  }

  // 5) Errores Postgres / Supabase comunes
  const pgCode = err.code;
  if (pgCode) {
    if (pgCode === '23505') {
      return res.status(409).json({
        message: 'Ya existe un registro con esos datos.',
      });
    }
    if (pgCode === '23503') {
      return res.status(409).json({
        message: 'Alguno de los datos seleccionados ya no está disponible.',
      });
    }
    if (pgCode === '23514') {
      return res.status(400).json({
        message: statusMessage(400),
      });
    }
    if (pgCode === '23502') {
      return res.status(400).json({
        message: 'Falta completar un dato obligatorio.',
      });
    }
    if (pgCode === '22P02') {
      return res.status(400).json({
        message: statusMessage(400),
      });
    }
  }

  // 6) Supabase error generico
  if (err.message && err.hint && err.details) {
    return res.status(400).json({
      message: statusMessage(400),
    });
  }

  const status = err.status || 500;
  return res.status(status).json({
    message: safeMessage(err.message, statusMessage(status)),
  });
};

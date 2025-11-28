// Adaptador simple para zod u otro validador de esquemas
// - Valida {body, query, params} en un solo schema
// - si hay errores, pasa un obj estandar al error handler (400)
// - si parsea ok, devuelve los valores parseados al request

module.exports = (schema) => async (req, _res, next) => {
  try {
    // Normalizador pequeño: convierte "" a undefined (útil para queries vacías)
    const clean = (obj) =>
      Object.fromEntries(
        Object.entries(obj || {}).map(([k, v]) => [k, v === '' ? undefined : v])
      );

    const payload = {
      body: clean(req.body),
      query: clean(req.query),
      params: clean(req.params),
    };
    // Usamos safeParseAsync si existe; si no, safeParse
    const safeParse = typeof schema.safeParseAsync === 'function'
      ? schema.safeParseAsync.bind(schema)
      : (data) => schema.safeParse ? schema.safeParse(data) : { success: true, data };

    const result = await safeParse(payload);

    if (!result.success) {
      // Formato de errores claro para el handler / cliente
      // Soporte para Zod v3 y v4
      let zodErrors = [];

      if (Array.isArray(result.error)) {
        zodErrors = result.error;
      } else if (result.error?.errors && Array.isArray(result.error.errors)) {
        zodErrors = result.error.errors;
      } else if (result.error?.issues && Array.isArray(result.error.issues)) {
        zodErrors = result.error.issues;
      } else if (result.error && typeof result.error[Symbol.iterator] === 'function') {
        try { zodErrors = Array.from(result.error); } catch (e) { }
      }

      // Si aun asi no hay errores, pero el objeto error tiene info util
      if ((!zodErrors || zodErrors.length === 0) && result.error) {
        // Fallback final: envolver el error crudo
        zodErrors = [{
          path: [],
          code: 'custom',
          message: result.error.message || 'Error de validación desconocido'
        }];
      }

      if (!zodErrors || zodErrors.length === 0) {
        console.error('❌ Error de validación inesperado (estructura desconocida):', result.error);
        return next({
          type: 'validation',
          status: 400,
          error: 'ValidationError',
          message: 'Error de validación inesperado',
        });
      }

      const details = zodErrors.map((err) => ({
        path: Array.isArray(err.path) ? err.path.join('.') : String(err.path || ''),
        code: err.code,
        message: err.message,
      }));

      return next({
        type: 'validation',
        status: 400,
        error: 'ValidationError',
        details,
      });
    }

    // Reinyectar valores parseados/coercionados (útil para numbers/bools en query)
    const { body, query, params } = result.data || {};
    if (body) req.body = body;
    if (query) req.query = query;
    if (params) req.params = params;

    return next();

  } catch (e) {
    return next(e)
  }
};

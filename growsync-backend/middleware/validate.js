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
      const details = result.error.errors.map(({ path, message, code }) => ({
        path: Array.isArray(path) ? path.join('.') : String(path),
        code,
        message,
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
    if (body)   req.body = body;
    if (query)  req.query = query;
    if (params) req.params = params;

    return next();

  } catch (e) {
    return next(e)
  }
};

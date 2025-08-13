// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

/**
 * GET /api/users
 * Soporta:
 *  - ?page=&pageSize=                 → paginado
 *  - ?q=                              → busqueda por email / full_name / username (min. 2 chars)
 *  - ?role=0|1|2|3                    → filtrar por rol
 *  - ?includeDisabled=0|1             → incluir enabled=false
 *
 * Devuelve: { data, page, pageSize, total }
 */
module.exports = async function getAllUsers(req, res) {
  try {
    // Coerciones suaves (por si el validate no corrio)
    const page            = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSizeParam   = parseInt(req.query.pageSize, 10);
    const pageSize        = Math.min(Math.max(pageSizeParam || 50, 1), 1000);
    const includeDisabled = (String(req.query.includeDisabled).toLowerCase() === 'true') ||
                            (req.query.includeDisabled === '1');
    const q               = (req.query.q || '').trim();
    const roleFilter      = req.query.role != null ? Number(req.query.role) : undefined;

    const offset = (page - 1) * pageSize;
    const rangeFrom = offset;
    const rangeTo   = offset + pageSize - 1;

    // Columnas explicitas (evita exponer campos sensibles)
    const columns = 'id,email,full_name,username,role,enabled,created_at,auth0_id';

    let query = supabase
      .from('users')
      .select(columns, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo);

    if (!includeDisabled) query = query.eq('enabled', true);
    if (Number.isInteger(roleFilter)) query = query.eq('role', roleFilter);

    if (q.length >= 2) {
      // Busqueda simple en varios campos
      query = query.or(
        `email.ilike.%${q}%,full_name.ilike.%${q}%,username.ilike.%${q}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Error al obtener usuarios desde Supabase:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al obtener usuarios' });
    }

    return res.status(200).json({
      data: data || [],
      page,
      pageSize,
      total: count ?? (data?.length || 0),
    });
  } catch (err) {
    console.error('Error inesperado al obtener usuarios:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al obtener usuarios' });
  }
};


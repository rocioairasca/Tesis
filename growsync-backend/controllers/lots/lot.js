/**
 * Controlador: Lotes (Principal)
 * Ubicación: controllers/lots/lot.js
 * Descripción:
 *  Maneja el CRUD principal de lotes (Listar, Crear, Editar, Soft Delete).
 * 
 * Mejoras de Código (Refactorización):
 *  - Implementación de manejo de errores centralizado.
 *  - Se reemplazaron los bloques try/catch manuales con respuestas 500 por `next(err)`.
 *  - Esto delega el manejo de excepciones al middleware `errorHandler.js`, asegurando
 *    respuestas de error consistentes y reduciendo la duplicación de código.
 */
// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');
const { pool } = require('../../db/supabaseClient');

/**
 * LISTAR LOTES (habilitados por defecto)
 * Soporta: ?q=&page=&pageSize=&includeDisabled=
 * Devuelve: { data, page, pageSize, total }
 */
const listLots = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

    const {
      q,
      page = 1,
      pageSize = 50,
      includeDisabled = false,
      includeActiveLayout = false,
    } = req.query;

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    if (includeActiveLayout === true || includeActiveLayout === 'true') {
      const where = ['l.company_id = $1'];
      const values = [company_id];

      if (!(includeDisabled === true || includeDisabled === 'true')) {
        where.push('l.enabled = TRUE');
      }

      if (q && q.trim().length >= 2) {
        values.push(`%${q.trim()}%`);
        where.push(`l.name ILIKE $${values.length}`);
      }

      values.push(limit);
      const limitIndex = values.length;
      values.push(offset);
      const offsetIndex = values.length;

      const { rows } = await pool.query(
        `
        WITH filtered_lots AS (
          SELECT
            l.id,
            l.name,
            l.area,
            l.area_ha,
            l.location,
            l.enabled,
            l.created_at,
            COUNT(*) OVER() AS total_count
          FROM lots l
          WHERE ${where.join(' AND ')}
          ORDER BY l.created_at DESC
          LIMIT $${limitIndex}
          OFFSET $${offsetIndex}
        )
        SELECT
          fl.id,
          fl.name,
          fl.area,
          fl.area_ha,
          fl.location,
          fl.enabled,
          fl.created_at,
          fl.total_count,
          CASE
            WHEN ll.id IS NULL THEN NULL
            ELSE json_build_object(
              'id', ll.id,
              'version', ll.version,
              'name', ll.name,
              'status', ll.status,
              'parent_area_ha_snapshot', ll.parent_area_ha_snapshot,
              'sub_lots', COALESCE((
                SELECT json_agg(
                  json_build_object(
                    'id', sl.id,
                    'code', sl.code,
                    'name', sl.name,
                    'area_ha', sl.area_ha,
                    'geom', ST_AsGeoJSON(sl.geom)::json,
                    'sort_order', sl.sort_order
                  )
                  ORDER BY sl.sort_order, sl.code
                )
                FROM sub_lots sl
                WHERE sl.layout_id = ll.id
                  AND sl.company_id = ll.company_id
                  AND sl.enabled = TRUE
              ), '[]'::json)
            )
          END AS active_layout
        FROM filtered_lots fl
        LEFT JOIN lot_layouts ll
          ON ll.lot_id = fl.id
         AND ll.company_id = $1
         AND ll.status = 'active'
        ORDER BY fl.created_at DESC
        `,
        values
      );

      const data = rows.map(({ total_count, ...row }) => row);
      return res.json({
        data,
        page: Number(page),
        pageSize: limit,
        total: Number(rows[0]?.total_count || 0),
      });
    }

    const columns = 'id,name,area,location,enabled,created_at';

    let query = supabase
      .from('lots')
      .select(columns, { count: 'exact' })
      .eq('company_id', company_id) // Multi-tenancy filter
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!includeDisabled) query = query.eq('enabled', true);
    if (q && q.trim().length >= 2) query = query.ilike('name', `%${q.trim()}%`);

    const { data, error, count } = await query;

    if (error) throw error;

    return res.json({
      data: data || [],
      page: Number(page),
      pageSize: limit,
      total: count ?? (data?.length || 0),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * CREAR LOTE
 */
const addLot = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

    const { name, area, location } = req.body;

    const { data, error } = await supabase
      .from('lots')
      .insert([{ name, area, location, company_id }])
      .select('id,name,area,location,enabled,created_at')
      .single();

    if (error) throw error;

    return res.status(201).json({ lot: data });
  } catch (err) {
    next(err);
  }
};

/**
 * EDITAR LOTE
 * Si no existe el ID → 404
 */
const editLot = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

    const { id } = req.params;
    const { name, area, location } = req.body;

    const { data, error } = await supabase
      .from('lots')
      .update({ name, area, location })
      .eq('id', id)
      .eq('company_id', company_id) // Security check
      .select('id,name,area,location,enabled,created_at')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'NotFound', message: 'Lote no encontrado' });
    }

    return res.json({ lot: data });
  } catch (err) {
    next(err);
  }
};

/**
 * DESHABILITAR LOTE (soft delete)
 * Solo cambia enabled=false si esta true. Si no existe o ya esta deshabilitado → 404.
 */
const softDeleteLot = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

    const { id } = req.params;

    const { data, error } = await supabase
      .from('lots')
      .update({ enabled: false })
      .eq('id', id)
      .eq('company_id', company_id) // Security check
      .eq('enabled', true)
      .select('id,enabled')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'NotFound', message: 'Lote no encontrado o ya deshabilitado' });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    next(err);
  }
};

/**
 * CONTAR LOTES HABILITADOS
 */
const countEnabledLots = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

    const { count, error } = await supabase
      .from('lots')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id) // Multi-tenancy filter
      .eq('enabled', true);

    if (error) throw error;

    return res.json({ total: count || 0 });
  } catch (err) {
    next(err);
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = {
  listLots,
  addLot,
  editLot,
  softDeleteLot,
  countEnabledLots
};


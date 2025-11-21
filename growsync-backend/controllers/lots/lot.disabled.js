/**
 * Controlador: Lotes Deshabilitados
 * Ubicación: controllers/lots/lot.disabled.js
 * Descripción:
 *  Maneja la lógica específica para lotes deshabilitados (Listar eliminados, Restaurar).
 * 
 * Mejoras de Código (Refactorización):
 *  - Estandarización del manejo de errores usando `next(err)`.
 *  - Alineación con el patrón de diseño del controlador principal.
 */
// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

/**
 * LISTAR LOTES DESHABILITADOS
 * - Soporta paginado y busqueda por nombre (?q=)
 * - Devuelve { data, page, pageSize, total }
 */
const listDisabledLots = async (req, res, next) => {
  try {
    const {
      q,
      page = 1,
      pageSize = 50,
    } = req.query;

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    // Seleccionamos columnas explícitas
    const columns = 'id,name,area,location,enabled,created_at';

    let query = supabase
      .from('lots')
      .select(columns, { count: 'exact' })
      .eq('enabled', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (q && q.trim().length >= 2) {
      query = query.ilike('name', `%${q.trim()}%`);
    }

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
 * HABILITAR LOTE (soft-restore)
 * - Cambia enabled=false -> true
 * - Si el lote no existe o ya esta habilitado, responde 404
 */
const enableLot = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Actualizamos solo si actualmente esta deshabilitado
    const { data, error } = await supabase
      .from('lots')
      .update({ enabled: true })
      .eq('id', id)
      .eq('enabled', false)
      .select('id, name, enabled')
      .maybeSingle(); // no lanza error si no hay fila

    if (error) throw error;

    if (!data) {
      // No hay fila que cumpla: o no existe, o ya estaba habilitado
      return res.status(404).json({ error: 'NotFound', message: 'Lote no encontrado o ya habilitado' });
    }

    return res.status(200).json({
      message: 'Lote habilitado exitosamente',
      lot: data,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listDisabledLots,
  enableLot
};

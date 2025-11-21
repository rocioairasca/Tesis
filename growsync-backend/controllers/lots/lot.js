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

/**
 * LISTAR LOTES (habilitados por defecto)
 * Soporta: ?q=&page=&pageSize=&includeDisabled=
 * Devuelve: { data, page, pageSize, total }
 */
const listLots = async (req, res, next) => {
  try {
    const {
      q,
      page = 1,
      pageSize = 50,
      includeDisabled = false,
    } = req.query;

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const columns = 'id,name,area,location,enabled,created_at';

    let query = supabase
      .from('lots')
      .select(columns, { count: 'exact' })
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
    const { name, area, location } = req.body;

    const { data, error } = await supabase
      .from('lots')
      .insert([{ name, area, location }])
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
    const { id } = req.params;
    const { name, area, location } = req.body;

    const { data, error } = await supabase
      .from('lots')
      .update({ name, area, location })
      .eq('id', id)
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
    const { id } = req.params;

    const { data, error } = await supabase
      .from('lots')
      .update({ enabled: false })
      .eq('id', id)
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
    const { count, error } = await supabase
      .from('lots')
      .select('id', { count: 'exact', head: true })
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


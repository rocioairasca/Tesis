// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require("../../db/supabaseClient");

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const asIdArray = (v) => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Lee available_quantity y la actualiza sumando delta (puede ser negativo).
 * Devuelve la cantidad nueva. Lanza error si no alcanza stock para bajar.
 */
async function adjustStock(productId, delta) {
  // Fallback: leer-modificar-escribir
  const { data: prod, error: e1 } = await supabase
    .from('products')
    .select('available_quantity, enabled')
    .eq('id', productId)
    .maybeSingle();

  if (e1) throw e1;
  if (!prod) {
    const err = new Error('Producto no encontrado');
    err.status = 404;
    throw err;
  }
  if (prod.enabled === false) {
    const err = new Error('Producto deshabilitado');
    err.status = 409;
    throw err;
  }

  const current = toNum(prod.available_quantity, 0);
  const next = current + delta;
  if (next < 0) {
    const err = new Error('Stock insuficiente');
    err.status = 409;
    throw err;
  }

  const { data: upd, error: e2 } = await supabase
    .from('products')
    .update({ available_quantity: next })
    .eq('id', productId)
    .select('id, available_quantity')
    .maybeSingle();

  if (e2) throw e2;
  if (!upd) {
    const err = new Error('No se pudo actualizar stock');
    err.status = 500;
    throw err;
  }
  return upd.available_quantity;
}

async function upsertUsageLots(usageId, lotIds) {
  // Reemplazo total: borro y vuelvo a insertar
  const { error: delErr } = await supabase.from('usage_lots').delete().eq('usage_id', usageId);
  if (delErr) throw delErr;

  const clean = [...new Set(asIdArray(lotIds))];
  if (!clean.length) return;

  const rows = clean.map((lot_id) => ({ usage_id: usageId, lot_id }));
  const { error: insErr } = await supabase.from('usage_lots').insert(rows);
  if (insErr) throw insErr;
}

// ───────────────────────────────────────────────────────────────────────────────
// LISTAR RDUs HABILITADOS (con filtros/paginado y joins basicos)
// GET /api/usages?from=&to=&product_id=&lotId=&user_id=&q=&page=&pageSize=&includeDisabled=0/1
// ───────────────────────────────────────────────────────────────────────────────
const listUsages = async (req, res) => {
  try {
    const {
      from,
      to,
      product_id,
      lotId,
      user_id,
      q,
      page = 1,
      pageSize = 50,
      includeDisabled = false,
    } = req.query;

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const selectCols = `
      id, date, product_id, amount_used, unit, total_area,
      previous_crop, current_crop, user_id, enabled, created_at,
      products:product_id ( id, name, unit ),
      user:users!usage_records_user_id_fkey ( id, full_name, email ),
      usage_lots (
        lot_id,
        lot:lots ( id, name )
      )
    `;

    let query = supabase
      .from('usage_records')
      .select(selectCols, { count: 'exact' })
      .order('date', { ascending: false });

    if (!includeDisabled) query = query.eq('enabled', true);
    if (from && to)       query = query.gte('date', from).lte('date', to);
    if (product_id)       query = query.eq('product_id', product_id);
    if (user_id)          query = query.eq('user_id', user_id);
    if (q && q.trim().length >= 2) {
      // busqueda simple por cultivo actual/anterior o unidad
      query = query.or(`previous_crop.ilike.%${q}%,current_crop.ilike.%${q}%,unit.ilike.%${q}%`);
    }
    if (lotId) {
      // filtro por existencia en usage_lots
      query = query.contains('usage_lots', [{ lot_id: lotId }]);
    }

    // paginado
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error('Error al listar registros de uso:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al listar registros de uso' });
    }

    return res.json({
      data: data || [],
      page: Number(page),
      pageSize: limit,
      total: count ?? (data?.length || 0),
    });
  } catch (err) {
    console.error('Error inesperado al listar registros de uso:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al listar registros de uso' });
  }
};

// ───────────────────────────────────────────────────────────────────────────────
// CREAR UN RDU (descuenta stock)
// ───────────────────────────────────────────────────────────────────────────────
const createUsage = async (req, res) => {
  try {
    const {
      product_id,
      amount_used,
      unit,
      lot_ids,
      total_area,
      previous_crop,
      current_crop,
      user_id,
      date,
    } = req.body;

    const qty = toNum(amount_used, NaN);
    if (!product_id || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'ValidationError', message: 'product_id y amount_used (>0) son requeridos' });
    }

    // 1) Crear registro
    const { data: usage, error: insertError } = await supabase
      .from('usage_records')
      .insert([{
        product_id,
        amount_used: qty,
        unit,
        total_area,
        previous_crop,
        current_crop,
        user_id,
        date,
      }])
      .select('id, product_id, amount_used')
      .single();

    if (insertError) throw insertError;
    const usageId = usage.id;

    try {
      // 2) Relacionar lotes
      await upsertUsageLots(usageId, lot_ids);

      // 3) Descontar stock
      await adjustStock(product_id, -qty);
    } catch (inner) {
      // Rollback simple: borrar el usage y sus lots
      await supabase.from('usage_lots').delete().eq('usage_id', usageId);
      await supabase.from('usage_records').delete().eq('id', usageId);
      throw inner;
    }

    return res.status(201).json({ ok: true, id: usageId });
  } catch (err) {
    console.error('Error al crear registro de uso:', err);
    const status = err.status || 500;
    return res.status(status).json({ error: 'CreateUsageError', message: err.message || 'Error al crear registro de uso' });
  }
};

// ───────────────────────────────────────────────────────────────────────────────
/**
 * EDITAR UN RDU
 * - Si cambia product_id o amount_used, ajusta stock por diferencia:
 *   - Si cambia de producto: +oldQty al producto viejo, -newQty al nuevo.
 *   - Si cambia cantidad: aplica delta en el mismo producto.
 * - Reemplaza usage_lots si llega lot_ids.
 */
// ───────────────────────────────────────────────────────────────────────────────
const editUsage = async (req, res) => {
  try {
    const { id } = req.params;

    // 0) Cargar registro actual
    const { data: current, error: curErr } = await supabase
      .from('usage_records')
      .select('id, product_id, amount_used')
      .eq('id', id)
      .maybeSingle();

    if (curErr) throw curErr;
    if (!current) return res.status(404).json({ error: 'NotFound', message: 'Registro de uso no encontrado' });

    const {
      product_id,
      amount_used,
      unit,
      lot_ids,
      total_area,
      previous_crop,
      current_crop,
      user_id,
      date,
    } = req.body;

    const prevProd = current.product_id;
    const prevQty  = toNum(current.amount_used, 0);
    const newProd  = product_id ?? prevProd;
    const newQty   = amount_used != null ? toNum(amount_used, NaN) : prevQty;

    if (amount_used != null && (!Number.isFinite(newQty) || newQty <= 0)) {
      return res.status(400).json({ error: 'ValidationError', message: 'amount_used debe ser > 0' });
    }

    // 1) Actualizar registro (solo campos presentes)
    const updateData = {};
    for (const [k, v] of Object.entries({ product_id, amount_used, unit, total_area, previous_crop, current_crop, user_id, date })) {
      if (v !== undefined) updateData[k] = v;
    }
    const { error: upErr } = await supabase.from('usage_records').update(updateData).eq('id', id);
    if (upErr) throw upErr;

    // 2) Actualizar lots si viene lot_ids
    if (lot_ids !== undefined) {
      await upsertUsageLots(id, lot_ids);
    }

    // 3) Ajuste de stock
    try {
      if (newProd !== prevProd) {
        // Reintegrar todo al anterior y descontar todo del nuevo
        if (prevQty > 0) await adjustStock(prevProd, +prevQty);
        if (newQty > 0)  await adjustStock(newProd, -newQty);
      } else if (newQty !== prevQty) {
        const delta = newQty - prevQty;
        if (delta !== 0) await adjustStock(newProd, -delta); // delta>0 descuenta; delta<0 reintegra
      }
    } catch (stockErr) {
      // Intento dejar el registro coherente si fallo stock 
      console.error('Error ajustando stock en editUsage, revisar consistencia:', stockErr);
      return res.status(stockErr.status || 409).json({ error: 'StockError', message: stockErr.message || 'Error de stock' });
    }

    return res.json({ ok: true, id });
  } catch (err) {
    console.error('Error al actualizar registro de uso:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al actualizar registro de uso' });
  }
};

// ───────────────────────────────────────────────────────────────────────────────
/**
 * DESHABILITAR UN RDU (soft delete)
 * - Reintegra stock (amount_used) al producto
 * - Marca enabled=false solo si estaba true
 */
// ───────────────────────────────────────────────────────────────────────────────
const disableUsage = async (req, res) => {
  try {
    const { id } = req.params;

    // 1) Leer registro (solo si esta habilitado)
    const { data: usage, error: fErr } = await supabase
      .from('usage_records')
      .select('id, product_id, amount_used, enabled')
      .eq('id', id)
      .eq('enabled', true)
      .maybeSingle();

    if (fErr) throw fErr;
    if (!usage) return res.status(404).json({ error: 'NotFound', message: 'Registro no encontrado o ya deshabilitado' });

    const qty = toNum(usage.amount_used, 0);

    // 2) Reintegrar stock
    await adjustStock(usage.product_id, +qty);

    // 3) Marcar disabled
    const { data, error: dErr } = await supabase
      .from('usage_records')
      .update({ enabled: false })
      .eq('id', id)
      .select('id, enabled')
      .maybeSingle();

    if (dErr) throw dErr;
    if (!data) return res.status(404).json({ error: 'NotFound', message: 'No se pudo deshabilitar (no encontrado)' });

    return res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Error al deshabilitar registro de uso:', err);
    const status = err.status || 500;
    return res.status(status).json({ error: 'DisableUsageError', message: err.message || 'Error al deshabilitar registro de uso' });
  }
};

// ───────────────────────────────────────────────────────────────────────────────
// LISTAR RDUs DESHABILITADOS (paginado)
// ───────────────────────────────────────────────────────────────────────────────
const listDisabledUsages = async (req, res) => {
  try {
    const { page = 1, pageSize = 50 } = req.query;

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const { data, error, count } = await supabase
      .from('usage_records')
      .select('id, date, product_id, amount_used, unit, total_area, previous_crop, current_crop, user_id, enabled, created_at', { count: 'exact' })
      .eq('enabled', false)
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error al listar registros de uso deshabilitados:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al listar registros de uso deshabilitados' });
    }

    return res.json({
      data: data || [],
      page: Number(page),
      pageSize: limit,
      total: count ?? (data?.length || 0),
    });
  } catch (err) {
    console.error('Error inesperado al listar registros de uso deshabilitados:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al listar registros de uso deshabilitados' });
  }
};

// ───────────────────────────────────────────────────────────────────────────────
/**
 * HABILITAR UN RDU (restore)
 * - Descuenta stock (amount_used) nuevamente del producto
 * - Marca enabled=true solo si estaba false
 */
// ───────────────────────────────────────────────────────────────────────────────
const enableUsage = async (req, res) => {
  try {
    const { id } = req.params;

    // 1) Leer registro (solo si esta deshabilitado)
    const { data: usage, error: fErr } = await supabase
      .from('usage_records')
      .select('id, product_id, amount_used, enabled')
      .eq('id', id)
      .eq('enabled', false)
      .maybeSingle();

    if (fErr) throw fErr;
    if (!usage) return res.status(404).json({ error: 'NotFound', message: 'Registro no encontrado o ya habilitado' });

    const qty = toNum(usage.amount_used, 0);

    // 2) Descontar stock nuevamente
    await adjustStock(usage.product_id, -qty);

    // 3) Marcar enabled
    const { data, error: uErr } = await supabase
      .from('usage_records')
      .update({ enabled: true })
      .eq('id', id)
      .select('id, enabled')
      .maybeSingle();

    if (uErr) throw uErr;
    if (!data) return res.status(404).json({ error: 'NotFound', message: 'No se pudo habilitar (no encontrado)' });

    return res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Error al habilitar registro de uso:', err);
    const status = err.status || 500;
    return res.status(status).json({ error: 'EnableUsageError', message: err.message || 'Error al habilitar registro de uso' });
  }
};

module.exports = {
  listUsages,
  createUsage,
  editUsage,
  disableUsage,
  listDisabledUsages,
  enableUsage
};

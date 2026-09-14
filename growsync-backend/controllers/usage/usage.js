const {assertSameUnit} = require('../../services/inventoryUnits');
// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require("../../db/supabaseClient");
const { pool } = require("../../db/supabaseClient");
const { createNotification } = require('../notifications');
const stock = require('../../services/stock');
const stockUsage = require('../../services/stockUsage');
const legacyUsage = require('../../services/legacyUsage');

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
/**
 * Lee available_quantity y la actualiza sumando delta (puede ser negativo).
 * Devuelve la cantidad nueva. Lanza error si no alcanza stock para bajar.
 */
async function adjustStock(productId, delta, companyId) {
  // Fallback: leer-modificar-escribir
  const { data: prod, error: e1 } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('company_id', companyId)
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
    .eq('company_id', companyId)
    .select('id, available_quantity')
    .maybeSingle();

  if (e2) throw e2;
  if (!upd) {
    const err = new Error('No se pudo actualizar stock');
    err.status = 500;
    throw err;
  }

  // [NOTIFICACIÓN] Low Stock
  // Si el stock bajó (delta < 0) y cruzó o tocó el umbral de 5
  if (delta < 0 && !stock.isLowStock({...prod,available_quantity:current}) && stock.isLowStock({...prod,available_quantity:next})) {
    try {
      // Buscar admins y managers de la misma compañia
      const { data: recipients } = await supabase
        .from('users')
        .select('id')
        .eq('company_id', companyId)
        .in('role', [1, 2, 3]) // 1=Supervisor, 2=Dueño, 3=Admin
        .eq('enabled', true);

      if (recipients && recipients.length > 0) {
        for (const user of recipients) {
          createNotification(
            user.id,
            'low_stock',
            'high',
            'Stock bajo',
            `${prod.name || 'Producto'} quedó con bajo stock: ${next} ${prod.unit || 'unidades'}.`,
            { product_id: productId, current_stock: next },
            companyId
          ).catch(e => console.error('Error enviando notif low_stock:', e));
        }
      }
    } catch (notifErr) {
      console.error('Error procesando notificación de stock bajo:', notifErr);
    }
  }

  return upd.available_quantity;
}

async function upsertUsageLots(usageId, lotIds, companyId) {
  await validateUsageReferences({companyId,lotIds});
  // Reemplazo total: borro y vuelvo a insertar
  const { error: delErr } = await supabase.from('usage_lots').delete().eq('usage_id', usageId);
  if (delErr) throw delErr;

  const clean = [...new Set(asIdArray(lotIds))];
  if (!clean.length) return;

  const rows = clean.map((lot_id) => ({ usage_id: usageId, lot_id }));
  const { error: insErr } = await supabase.from('usage_lots').insert(rows);
  if (insErr) throw insErr;
}

const resolveUsageLotName = (usageLot) => (
  usageLot?.sub_lot?.name
  || usageLot?.sub_lot_name
  || usageLot?.lot?.name
  || usageLot?.lot_name
  || usageLot?.lot_id
);

const summarizeCropNames = (names, emptyValue) => {
  const clean = [...new Set((names || []).filter(Boolean))];
  if (!clean.length) return emptyValue;
  if (clean.length === 1) return clean[0];
  return 'Varios';
};

const resolveUsageCropIdSnapshot = async ({ companyId, date, lotIds = [] }) => {
  if (!pool || !date || !lotIds.length) return null;
  const cleanLotIds = [...new Set(asIdArray(lotIds))];
  if (!cleanLotIds.length) return null;

  const { rows } = await pool.query(
    `
    SELECT DISTINCT ca.crop_id
    FROM crop_assignments ca
    WHERE ca.company_id = $1
      AND ca.lot_id = ANY($2::uuid[])
      AND ca.sub_lot_id IS NULL
      AND ca.start_date <= $3::date
      AND (ca.end_date IS NULL OR ca.end_date >= $3::date);
    `,
    [companyId, cleanLotIds, date]
  );

  return rows.length === 1 ? rows[0].crop_id : null;
};

const fetchUsageSurfaces = async (usageIds, companyId) => {
  if (!pool || !usageIds.length) return new Map();

  const { rows } = await pool.query(
    `
    SELECT
      ul.usage_id,
      ul.lot_id,
      l.name AS lot_name,
      ul.sub_lot_id,
      sl.name AS sub_lot_name,
      CASE
        WHEN ul.sub_lot_id IS NULL THEN ST_AsGeoJSON(l.geom)::json
        ELSE ST_AsGeoJSON(sl.geom)::json
      END AS geometry,
      CASE
        WHEN ul.sub_lot_id IS NOT NULL THEN ST_AsGeoJSON(l.geom)::json
        ELSE NULL
      END AS parent_geometry
    FROM usage_lots ul
    JOIN usage_records ur
      ON ur.id = ul.usage_id
     AND ur.company_id = $1
    JOIN lots l
      ON l.id = ul.lot_id
     AND l.company_id = $1
    LEFT JOIN sub_lots sl
      ON sl.id = ul.sub_lot_id
     AND sl.company_id = $1
    WHERE ul.usage_id = ANY($2::uuid[])
    ORDER BY l.name ASC, sl.sort_order NULLS FIRST, sl.code NULLS FIRST, sl.name ASC;
    `,
    [companyId, usageIds]
  );

  return rows.reduce((acc, row) => {
    const current = acc.get(row.usage_id) || [];
    current.push({
      lot_id: row.lot_id,
      lot_name: row.lot_name,
      sub_lot_id: row.sub_lot_id || null,
      sub_lot_name: row.sub_lot_name || null,
      geometry: row.geometry || null,
      parent_geometry: row.parent_geometry || null,
    });
    acc.set(row.usage_id, current);
    return acc;
  }, new Map());
};

const enrichUsagesWithProductiveContext = async (usages, companyId) => {
  const usageIds = (usages || []).map(usage => usage.id).filter(Boolean);
  const surfacesByUsage = await fetchUsageSurfaces(usageIds, companyId);

  return usages.map((usage) => {
    const usageSurfaces = surfacesByUsage.get(usage.id) || [];
    const lotNames = usageSurfaces.length
      ? usageSurfaces.map(surface => surface.sub_lot_name || surface.lot_name).filter(Boolean)
      : (usage.usage_lots || []).map(resolveUsageLotName).filter(Boolean);

    return {
      ...usage,
      products: usage.products?.company_id === companyId ? usage.products : null,
      usage_surfaces: usageSurfaces,
      lot_names: lotNames,
      current_crop_resolved: usage.crop?.name || usage.current_crop || 'Sin cultivo',
      previous_crop_resolved: summarizeCropNames([usage.previous_crop], '—'),
      origin: usage.source_planning_id ? 'Planificación' : 'Registro manual',
      source_activity_type: usage.planning?.activity_type || null,
    };
  });
};

// ───────────────────────────────────────────────────────────────────────────────
// LISTAR RDUs HABILITADOS (con filtros/paginado y joins basicos)
// GET /api/usages?from=&to=&product_id=&lotId=&user_id=&q=&page=&pageSize=&includeDisabled=0/1
// ───────────────────────────────────────────────────────────────────────────────
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

    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const selectCols = `
      id, date, product_id, amount_used, unit, total_area,
      previous_crop, current_crop, crop_id, user_id, enabled, created_at, source_planning_id, source_planning_product_id,
      products:product_id ( id, name, unit, company_id ),
      crop:crops!usage_records_crop_id_fkey ( id, name ),
      planning:source_planning_id ( id, activity_type ),
      user:users!usage_records_user_id_fkey ( id, full_name, email ),
      usage_lots (
        lot_id,
        sub_lot_id,
        lot:lots ( id, name, location, geom ),
        sub_lot:sub_lots ( id, name, geom )
      )
    `;

    let query = supabase
      .from('usage_records')
      .select(selectCols, { count: 'exact' })
      .eq('company_id', company_id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    if (!includeDisabled) query = query.eq('enabled', true);
    if (from && to) query = query.gte('date', from).lte('date', to);
    if (product_id) query = query.eq('product_id', product_id);
    if (user_id) query = query.eq('user_id', user_id);
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

    const enrichedData = await enrichUsagesWithProductiveContext(data || [], company_id);

    return res.json({
      data: enrichedData,
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
    if (stock.isEnabled(req.user?.company_id)) {
      return res.status(200).json(await stockUsage.createManualUsage(pool, {
        companyId: req.user.company_id, actorId: req.user.id,
        key: req.get('Idempotency-Key'), body: req.body,
      }));
    }
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

    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });

    const qty = toNum(amount_used, NaN);
    if (!product_id || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'ValidationError', message: 'product_id y amount_used (>0) son requeridos' });
    }

    const baseUnit=await validateUsageReferences({companyId:company_id,productId:product_id,unit,lotIds:lot_ids,userId:user_id});
    const cropId = await resolveUsageCropIdSnapshot({ companyId: company_id, date, lotIds: lot_ids });

    // 1) Crear registro
    const { data: usage, error: insertError } = await supabase
      .from('usage_records')
      .insert([{
        product_id,
        amount_used: qty,
        unit: baseUnit,
        total_area,
        previous_crop,
        current_crop,
        crop_id: cropId,
        user_id,
        date,
        company_id
      }])
      .select('id, product_id, amount_used')
      .single();

    if (insertError) throw insertError;
    const usageId = usage.id;

    try {
      // 2) Relacionar lotes
      await upsertUsageLots(usageId, lot_ids, company_id);

      // 3) Descontar stock
      await adjustStock(product_id, -qty, company_id);
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
// ───────────────────────────────────────────────────────────────────────────────
// EDITAR UN RDU
// - Si cambia product_id o amount_used, ajusta stock por diferencia:
//   - Si cambia de producto: +oldQty al producto viejo, -newQty al nuevo.
//   - Si cambia cantidad: aplica delta en el mismo producto.
// - Reemplaza usage_lots si llega lot_ids.
// ───────────────────────────────────────────────────────────────────────────────
const editUsage = async (req, res) => {
  try {
    if (stock.isEnabled(req.user?.company_id)) throw stock.fail('Con partidas, revertí el uso y registrá uno nuevo. Los usos legacy requieren conciliación.');
    const { stockChanges, ...result } = await legacyUsage.mutate(pool, {
      companyId: req.user?.company_id, usageId: req.params.id, body: req.body,
    });
    // External notifications happen only after COMMIT and cannot fail the mutation.
    await notifyLegacyStockChanges(stockChanges, req.user.company_id);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: 'editUsageError', message: err.message });
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
    if (stock.isEnabled(req.user?.company_id)) return res.json(await stockUsage.disableManualUsage(pool, {companyId:req.user.company_id, actorId:req.user.id, usageId:req.params.id}));
    const { stockChanges, ...result } = await legacyUsage.mutate(pool, {
      companyId: req.user?.company_id, usageId: req.params.id, enabled: false,
    });
    // External notifications happen only after COMMIT and cannot fail the mutation.
    await notifyLegacyStockChanges(stockChanges, req.user.company_id);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: 'disableUsageError', message: err.message });
  }
};

// ───────────────────────────────────────────────────────────────────────────────
// LISTAR RDUs DESHABILITADOS (paginado)
// ───────────────────────────────────────────────────────────────────────────────
const listDisabledUsages = async (req, res) => {
  try {
    const { page = 1, pageSize = 50 } = req.query;

    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const selectCols = `
      id, date, product_id, amount_used, unit, total_area,
      previous_crop, current_crop, crop_id, user_id, enabled, created_at, source_planning_id, source_planning_product_id,
      products:product_id ( id, name, unit, company_id ),
      crop:crops!usage_records_crop_id_fkey ( id, name ),
      planning:source_planning_id ( id, activity_type ),
      user:users!usage_records_user_id_fkey ( id, full_name, email ),
      usage_lots (
        lot_id,
        sub_lot_id,
        lot:lots ( id, name, location, geom ),
        sub_lot:sub_lots ( id, name, geom )
      )
    `;

    const { data, error, count } = await supabase
      .from('usage_records')
      .select(selectCols, { count: 'exact' })
      .eq('company_id', company_id)
      .eq('enabled', false)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error al listar registros de uso deshabilitados:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al listar registros de uso deshabilitados' });
    }

    const enrichedData = await enrichUsagesWithProductiveContext(data || [], company_id);

    return res.json({
      data: enrichedData,
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
    if (stock.isEnabled(req.user?.company_id)) throw stock.fail('Con partidas, registrá un nuevo uso en lugar de reactivar.');
    const { stockChanges, ...result } = await legacyUsage.mutate(pool, {
      companyId: req.user?.company_id, usageId: req.params.id, enabled: true,
    });
    // External notifications happen only after COMMIT and cannot fail the mutation.
    await notifyLegacyStockChanges(stockChanges, req.user.company_id);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: 'enableUsageError', message: err.message });
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

async function validateUsageReferences({companyId,productId,unit,lotIds,userId}) {
  let baseUnit;
  if (productId) {
    const {data,error}=await supabase.from('products').select('id,unit,enabled').eq('company_id',companyId).eq('id',productId).maybeSingle();
    if(error) throw error;
    if(!data?.enabled) throw stock.fail('Producto no disponible en esta empresa.',404);
    baseUnit=assertSameUnit(data.unit,unit);
  }
  if (lotIds!==undefined) {
    const ids=[...new Set(asIdArray(lotIds))];
    const {data,error}=await supabase.from('lots').select('id').eq('company_id',companyId).in('id',ids);
    if(error) throw error;
    if((data||[]).length!==ids.length) throw stock.fail('Lotes no disponibles en esta empresa.',400);
  }
  if(userId){
    const {data,error}=await supabase.from('users').select('id').eq('company_id',companyId).eq('id',userId).maybeSingle();
    if(error) throw error;
    if(!data) throw stock.fail('Responsable no disponible en esta empresa.',400);
  }
  return baseUnit;
}

async function notifyLegacyStockChanges(changes, companyId) {
  try {
    for (const {product, before, after} of changes) {
      if (stock.decimal(after) >= stock.decimal(before)
        || stock.isLowStock({...product, available_quantity:before})
        || !stock.isLowStock({...product, available_quantity:after})) continue;
      const {data: recipients, error} = await supabase.from('users').select('id')
        .eq('company_id', companyId).in('role', [1,2,3]).eq('enabled', true);
      if (error) throw error;
      await Promise.all((recipients || []).map(user => createNotification(user.id, 'low_stock', 'high',
        'Stock bajo', `${product.name || 'Producto'} quedó con bajo stock: ${after} ${product.unit || 'unidades'}.`,
        {product_id:product.id, current_stock:Number(after)}, companyId)));
    }
  } catch (error) { console.error('Error enviando notificación posterior al commit:', error); }
}

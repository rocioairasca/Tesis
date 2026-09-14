const stock = require('./stock');
const { assertSameUnit } = require('./inventoryUnits');

// One SQL client for the entire mutation. Never fall back to REST compensation.
async function mutate(pool, { companyId, usageId, body = {}, enabled }) {
  if (!companyId) throw stock.fail('Empresa obligatoria.', 400);
  return stock.transaction(pool, async client => {
    const { rows: usages } = await client.query(
      'SELECT * FROM usage_records WHERE company_id=$1 AND id=$2 FOR UPDATE', [companyId, usageId]);
    const current = usages[0];
    if (!current) throw stock.fail('Registro de uso no encontrado', 404);
    if (current.source_planning_id) throw stock.fail('Este uso fue generado al completar una planificación y no puede modificarse de forma independiente.');
    const toggling = typeof enabled === 'boolean';
    if (toggling && current.enabled === enabled) return { ok: true, id: usageId, replayed: true, stockChanges: [] };
    if (!toggling && !current.enabled) throw stock.fail('No se puede editar un uso deshabilitado.');

    const productId = toggling ? current.product_id : body.product_id ?? current.product_id;
    // Stable ordering prevents opposite product swaps from deadlocking.
    const ids = [...new Set([current.product_id, productId])].sort();
    const { rows: products } = await client.query(
      'SELECT * FROM products WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [companyId, ids]);
    if (products.length !== ids.length || products.some(p => p.enabled === false)) {
      throw stock.fail('Producto no disponible en esta empresa.', 404);
    }
    const product = products.find(p => p.id === productId);
    const baseUnit = assertSameUnit(product.unit, toggling ? current.unit : body.unit ?? current.unit);
    const previous = stock.decimal(current.amount_used);
    const quantity = toggling ? previous : stock.decimal(body.amount_used ?? current.amount_used);
    if (quantity <= 0n) throw stock.fail('amount_used debe ser > 0', 400);

    let lotIds;
    if (!toggling && body.lot_ids !== undefined) {
      lotIds = [...new Set(body.lot_ids)];
      const { rows } = await client.query(
        'SELECT id FROM lots WHERE company_id=$1 AND id=ANY($2::uuid[]) FOR SHARE', [companyId, lotIds]);
      // Preserve existing semantics; Q04 (enabled lots) is outside this fix.
      if (rows.length !== lotIds.length) throw stock.fail('Lotes no disponibles en esta empresa.', 400);
    }
    if (!toggling && body.user_id) {
      const { rows } = await client.query('SELECT id FROM users WHERE company_id=$1 AND id=$2 FOR SHARE', [companyId, body.user_id]);
      if (!rows.length) throw stock.fail('Responsable no disponible en esta empresa.', 400);
    }

    const deltas = new Map();
    if (toggling) deltas.set(productId, enabled ? -quantity : quantity);
    else {
      deltas.set(current.product_id, previous);
      deltas.set(productId, (deltas.get(productId) || 0n) - quantity);
    }
    const stockChanges = [];
    for (const p of products) {
      const delta = deltas.get(p.id) || 0n;
      if (!delta) continue;
      const before = stock.decimal(p.available_quantity ?? 0);
      const after = before + delta;
      if (after < 0n) throw stock.fail('Stock insuficiente');
      const updated = await client.query(
        'UPDATE products SET available_quantity=$3 WHERE company_id=$1 AND id=$2 RETURNING id',
        [companyId, p.id, stock.amount(after)]);
      if (updated.rows.length !== 1) throw stock.fail('No se pudo actualizar stock', 500);
      stockChanges.push({ product: p, before: stock.amount(before), after: stock.amount(after) });
    }

    const changes = toggling ? { enabled } : { product_id: productId, amount_used: stock.amount(quantity), unit: baseUnit };
    if (!toggling) {
      for (const key of ['total_area', 'previous_crop', 'current_crop', 'user_id', 'date']) {
        if (body[key] !== undefined) changes[key] = body[key];
      }
      if (body.date !== undefined || lotIds !== undefined) {
        if (lotIds === undefined) {
          const { rows } = await client.query('SELECT lot_id FROM usage_lots WHERE usage_id=$1', [usageId]);
          lotIds = rows.map(row => row.lot_id);
        }
        const { rows } = await client.query(`SELECT DISTINCT crop_id FROM crop_assignments
          WHERE company_id=$1 AND lot_id=ANY($2::uuid[]) AND sub_lot_id IS NULL
          AND start_date<=$3::date AND (end_date IS NULL OR end_date>=$3::date)`,
        [companyId, lotIds, body.date ?? current.date]);
        changes.crop_id = rows.length === 1 ? rows[0].crop_id : null;
      }
      if (body.lot_ids !== undefined) {
        await client.query('DELETE FROM usage_lots WHERE usage_id=$1', [usageId]);
        for (const lotId of lotIds) await client.query('INSERT INTO usage_lots(usage_id,lot_id) VALUES ($1,$2)', [usageId, lotId]);
      }
    }
    // Column names come only from the fixed allowlist above, never request keys.
    const entries = Object.entries(changes);
    const updated = await client.query(`UPDATE usage_records SET ${entries.map(([key], i) => `${key}=$${i + 3}`).join(',')}
      WHERE company_id=$1 AND id=$2 RETURNING id`, [companyId, usageId, ...entries.map(([, value]) => value)]);
    if (updated.rows.length !== 1) throw stock.fail('No se pudo actualizar el uso', 500);
    return { ok: true, id: usageId, stockChanges };
  });
}

module.exports = { mutate };

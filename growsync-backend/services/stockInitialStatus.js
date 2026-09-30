const stock = require('./stock');
const { authorize } = require('./historicalImport');

module.exports = async function stockInitialStatus(pool, { companyId, actorId }) {
  if (!pool) throw stock.fail('Conexión SQL no disponible.', 503);
  const client = await pool.connect();
  try {
    await authorize(client, companyId, actorId);
    // One statement gives the opening and counts a consistent snapshot.
    const { rows } = await client.query(`
      SELECT c.inventory_control_start_date::text AS control_date,
        o.id AS opening_id, o.effective_date::text AS effective_date, o.created_at,
        (SELECT count(*) FROM stock_batches WHERE company_id=c.id) AS batches,
        (SELECT count(*) FROM stock_movements WHERE company_id=c.id) AS movements
      FROM companies c
      LEFT JOIN stock_initial_openings o ON o.company_id=c.id
      WHERE c.id=$1`, [companyId]);
    if (!rows.length) throw stock.fail('Empresa no disponible.', 404);
    const row = rows[0];
    const enabled = stock.isEnabled(companyId);
    const exists = row.opening_id != null;
    const batches = Number(row.batches), movements = Number(row.movements);
    const blockers = [];
    if (!row.control_date) blockers.push('CONTROL_DATE_MISSING');
    if (exists) blockers.push('OPENING_ALREADY_EXISTS');
    if (batches > 0 || movements > 0) blockers.push('INVENTORY_NOT_EMPTY');
    return {
      inventory_control_start_date: row.control_date,
      inventory_v1_enabled: enabled,
      opening: { exists, id: row.opening_id, effective_date: row.effective_date, created_at: row.created_at },
      stock: { batches, movements },
      can_prepare: Boolean(row.control_date) && !exists,
      can_confirm: blockers.length === 0,
      blockers,
    };
  } finally {
    client.release();
  }
};

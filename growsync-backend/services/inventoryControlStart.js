const stock = require('./stock');
const { authorize } = require('./historicalImport');

module.exports = async function inventoryControlStart(pool, { companyId, actorId, date }) {
  stock.calendarDate(date);
  return stock.transaction(pool, async client => {
    await authorize(client, companyId, actorId);
    // Same order as opening/receipts and the batch INSERT guard.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`stock-initial:${companyId}`]);
    const { rows } = await client.query('SELECT inventory_control_start_date::text FROM companies WHERE id=$1 FOR UPDATE', [companyId]);
    if (!rows.length) throw stock.fail('Empresa no disponible.', 404);
    const previous = rows[0].inventory_control_start_date;
    if (previous === date) return { inventory_control_start_date: date };
    const { rows: dependencies } = await client.query(`SELECT
      EXISTS(SELECT 1 FROM stock_initial_openings WHERE company_id=$1) AS opened,
      EXISTS(SELECT 1 FROM stock_batches WHERE company_id=$1)
        OR EXISTS(SELECT 1 FROM stock_movements WHERE company_id=$1) AS occupied`, [companyId]);
    if (dependencies[0].opened) throw stock.fail('El inventario inicial ya fue confirmado. No se puede cambiar la fecha de inicio.');
    if (dependencies[0].occupied) throw stock.fail('Ya existen existencias o movimientos de inventario. No se puede cambiar la fecha de inicio.');
    // Historical imports/operations have an explicit immutable impact mode;
    // changing this date does not reclassify them or recalculate their stock.
    await client.query('UPDATE companies SET inventory_control_start_date=$2 WHERE id=$1', [companyId, date]);
    await client.query(`INSERT INTO historical_events(company_id,actor_id,entity_table,entity_id,before_data,after_data)
      VALUES($1,$2,'companies',$1,$3::jsonb,$4::jsonb)`, [companyId, actorId,
      JSON.stringify({ inventory_control_start_date: previous }), JSON.stringify({ inventory_control_start_date: date })]);
    return { inventory_control_start_date: date };
  });
};

// Explicit domain semantics: retroactive is not synonymous with no stock.
const NORMAL = 'NORMAL';
const HISTORICAL = 'HISTORICAL_NO_STOCK';
const isHistorical = row => row?.inventory_impact_mode === HISTORICAL;
function fail(message, status = 409) { return Object.assign(new Error(message), { status }); }
function assertModeUnchanged(row, body = {}) {
  if (body.inventory_impact_mode !== undefined && body.inventory_impact_mode !== (row.inventory_impact_mode || NORMAL)) {
    throw fail('El modo de inventario es inmutable. Registrá una actividad independiente.');
  }
}
async function assertStockUsage(client, companyId, usageId) {
  if (!usageId) return;
  const { rows } = await client.query('SELECT * FROM usage_records WHERE company_id=$1 AND id=$2', [companyId, usageId]);
  if (rows.some(isHistorical)) throw fail('Un antecedente histórico no admite movimientos de inventario.');
}
module.exports = { NORMAL, HISTORICAL, isHistorical, assertModeUnchanged, assertStockUsage, fail };

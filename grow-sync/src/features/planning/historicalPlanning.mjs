export const isHistoricalPlanning = row => row?.inventory_impact_mode === 'HISTORICAL_NO_STOCK';
export const canEditPlanning = (row, canEdit, canImportHistory) =>
  Boolean(canEdit && (!isHistoricalPlanning(row) || canImportHistory));

const datePart = value => value ? String(value).slice(0, 10) : null;
const sameQuantity = (a, b) => a == null || b == null ? a == b : Number(a) === Number(b);

// Use original relationship IDs, never catalog selections or current geometry.
// Omit unchanged dates/areas: linked cycles prohibit even resubmitting those fields.
export function buildHistoricalPayload(editing, values) {
  if (!isHistoricalPlanning(editing)) throw new Error('La actividad no es histórica.');
  const payload = {
    title: values.title?.trim() || null,
    description: values.description?.trim() || null,
    responsible_user: values.responsible_user,
  };
  for (const [index, key] of ['start_at', 'end_at'].entries()) {
    const date = values.date_range?.[index]?.format('YYYY-MM-DD');
    if (!date) throw new Error('Seleccioná el período.');
    if (date !== datePart(editing[key])) payload[key] = `${date}T00:00:00.000Z`;
  }
  const effectiveDate = values.effective_date?.format('YYYY-MM-DD') || null;
  if (effectiveDate !== datePart(editing.effective_date)) {
    if (!effectiveDate) throw new Error('Seleccioná la fecha real de realización.');
    payload.effective_date = effectiveDate;
  }
  const lots = (editing.lots || []).map((lot, index) => ({
    lot_id: lot.lot_id || lot.id,
    sub_lot_id: lot.sub_lot_id || null,
    area_ha: values.historical_lots?.[index]?.area_ha ?? null,
  }));
  if (lots.some((lot, index) => !sameQuantity(lot.area_ha, editing.lots[index].area_ha))) {
    payload.lot_selections = lots;
  }
  const products = (editing.products || []).flatMap((product, index) => {
    // Recorded quantities also support historical products without a consumption record.
    if (product.actual_amount == null) return [];
    const value = values.products?.[index];
    if (!value) throw new Error('Faltan las cantidades del producto.');
    if (sameQuantity(value.amount, product.amount) && sameQuantity(value.actual_amount, product.actual_amount)) return [];
    return [{ planning_product_id: product.planning_product_id || product.id,
      actual_amount: value.actual_amount, amount: value.amount }];
  });
  if (products.length) payload.products = products;
  return payload;
}

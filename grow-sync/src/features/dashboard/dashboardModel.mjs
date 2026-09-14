import { calendarDateKey, parseCalendarDate } from '../../utils/calendarDate.js';
import { lowStock, stockQuantity } from '../inventory/inventoryModel.mjs';

import { numberValue } from '../../utils/numberFormat.js';
export { numberValue, formatNumber } from '../../utils/numberFormat.js';
export const harvestUnits = [
  { value: 'kg', label: 'Kilogramos', yieldLabel: 'kg/ha' },
  { value: 'tn', label: 'Toneladas', yieldLabel: 'tn/ha' },
  { value: 'qq', label: 'Quintales', yieldLabel: 'qq/ha' },
];
export function localDayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
// Planning stores calendar days as UTC midnight, just like its current calendar.
export function workWindow(today = localDayKey()) {
  const end = parseCalendarDate(today).add(7, 'day').format('YYYY-MM-DD');
  return { from: `${today}T00:00:00.000Z`, to: `${end}T23:59:59.999Z`, today, end };
}
export function workRows(rows, today) {
  return rows.filter(row => !['completado', 'cancelado'].includes(row.status_effective || row.status))
    .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)) || String(a.id).localeCompare(String(b.id)))
    .map(row => ({ ...row, isToday: String(row.start_at).slice(0, 10) <= today && String(row.end_at).slice(0, 10) >= today }));
}
export function inventoryAlerts(products, enabled, today = localDayKey()) {
  const counts = { low: 0, empty: 0, expired: 0, expiring: 0, unknown: 0 };
  for (const product of products) {
    if (product.enabled === false) continue;
    if (numberValue(enabled ? product.on_hand_quantity : product.available_quantity) == null) { counts.unknown++; continue; }
    const quantity = stockQuantity(product, enabled);
    if (quantity <= 0) { counts.empty++; continue; }
    if (lowStock(product, enabled)) counts.low++;
    // Acquisition is not an expiration date. Never infer a legacy expiration.
    const date = calendarDateKey(enabled ? product.next_expiration_date : product.expiration_date);
    if (!date) continue;
    if (date < today) counts.expired++;
    else if (parseCalendarDate(date).diff(parseCalendarDate(today), 'day') <= 15) counts.expiring++;
  }
  return counts;
}
export function filteredHarvest(summary, byCrop, byCampaign, filters) {
  const cropKey = value => String(value || '').trim().toLowerCase();
  const normalize = row => ({ ...row, production_kg: numberValue(row.production_kg), area_ha: numberValue(row.area_ha), yield_kg_ha: numberValue(row.yield_kg_ha) });
  // Each grouped endpoint supports only the OTHER dimension. Select the remaining
  // group locally; quantities and weighted yields remain those returned by the API.
  return {
    summary,
    byCrop: byCrop.filter(row => !filters.crop || cropKey(row.crop) === cropKey(filters.crop)).map(normalize),
    byCampaign: byCampaign.filter(row => !filters.campaign || (row.campaign_id ?? row.campaign) === filters.campaign).map(normalize),
  };
}

export async function readAllPages(readPage, params = {}, signal) {
  const rows = [];
  let first;
  for (let page = 1; ; page++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await readPage({ ...params, page, pageSize: 1000 });
    if (!Array.isArray(result?.data) || numberValue(result.total) == null) throw new Error('Respuesta incompleta');
    first ||= result;
    rows.push(...result.data);
    if (rows.length >= Number(result.total)) return { ...first, data: [...new Map(rows.map(row => [row.id, row])).values()] };
    if (!result.data.length) throw new Error('Listado incompleto');
  }
}

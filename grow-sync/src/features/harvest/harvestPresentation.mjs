export const cropLabel = row => row?.crop_name || row?.crop || 'Sin cultivo informado';
import { campaignLabel } from '../../utils/campaigns.mjs';
export { campaignLabel } from '../../utils/campaigns.mjs';
export const surfaceLabel = row => row?.sub_lot_name || row?.lot_name || 'No informado';
export function authorLabel(record, users = []) {
  const author = users.find(user => user?.id && String(user.id) === String(record?.created_by));
  return author?.full_name?.trim() || author?.email?.trim() || 'No informado';
}
export function filterHarvestRows(rows, { search = '', surface, origin } = {}) {
  const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return rows.filter(row => (!surface || (row.sub_lot_id ? `sub:${row.sub_lot_id}` : `lot:${row.lot_id}`) === surface)
    && (!origin || (origin === 'historical' ? row.registered_retroactively === true : origin === 'current' ? row.registered_retroactively === false : row.registered_retroactively == null))
    && normalized([cropLabel(row), campaignLabel(row), surfaceLabel(row), row.lot_name || '', row.notes || ''].join(' ')).includes(normalized(search.trim())));
}
// Read every server page before searching locally. Never search only the visible page.
export async function readHarvestPages(read, params = {}, cancelled = () => false) {
  const rows = [];
  for (let page = 1; ; page++) {
    if (cancelled()) return [];
    const response = await read({ ...params, page, pageSize: 100 });
    if (!Array.isArray(response?.data) || !Number.isFinite(Number(response?.pagination?.total))) throw new Error('Listado de cosechas incompleto');
    rows.push(...response.data);
    if (rows.length >= Number(response.pagination.total)) return [...new Map(rows.map(row => [row.id, row])).values()];
    if (!response.data.length) throw new Error('Listado de cosechas incompleto');
  }
}
// A historical sublot must never silently fall back to the parent's geometry.
export function harvestGeometry(record, lots) {
  const lot = lots.find(item => String(item.id) === String(record?.lot_id));
  if (record?.sub_lot_id) return lot?.active_layout?.sub_lots?.find(item => String(item.id) === String(record.sub_lot_id))?.geom || null;
  return lot?.geom || lot?.location || null;
}

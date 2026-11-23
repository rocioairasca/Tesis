// Pure presentation helpers for "Resultados por lote" (productive base). Production is stored in kg and yield in kg/ha:
// the units below are presentation only and never travel back to the API.
export const YIELD_UNITS = {
  kg: { divisor: 1, label: 'kg/ha' },
  qq: { divisor: 100, label: 'qq/ha' },
  tn: { divisor: 1000, label: 'tn/ha' },
};
export const YIELD_UNIT_OPTIONS = Object.entries(YIELD_UNITS).map(([value, { label }]) => ({ value, label }));

const numberOrNull = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const format = (value, digits = 2) => numberOrNull(value) == null ? '—'
  : new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits }).format(Number(value));

/** kg/ha -> selected unit. Returns null when the value is unknown (never 0). */
export function convertYield(kgPerHa, unit = 'kg') {
  const value = numberOrNull(kgPerHa);
  // Presentation only: round away binary floating noise (89.31190000000001) without changing the displayed 2 decimals.
  return value == null ? null : Math.round((value / (YIELD_UNITS[unit] || YIELD_UNITS.kg).divisor) * 1e6) / 1e6;
}
export function formatYield(kgPerHa, unit = 'kg', { withUnit = true } = {}) {
  const converted = convertYield(kgPerHa, unit);
  if (converted == null) return '—';
  const text = format(converted, 2);
  return withUnit ? `${text} ${(YIELD_UNITS[unit] || YIELD_UNITS.kg).label}` : text;
}
export const formatProduction = value => numberOrNull(value) == null ? 'Pendiente' : `${format(value)} kg`;
export const formatArea = value => numberOrNull(value) == null ? '—' : `${format(value)} ha`;

export const HARVEST_STATUS = {
  not_started: { label: 'Sin cosecha', tone: 'neutral' },
  in_progress: { label: 'En curso', tone: 'info' },
  closed: { label: 'Finalizada', tone: 'success' },
};
export const harvestStatus = value => HARVEST_STATUS[value] || null;

export const resultTitle = row => row?.sub_lot?.name ? `${row.lot?.name || 'Lote'} · ${row.sub_lot.name}` : (row?.lot?.name || 'No informado');
export const resultLabel = row => `${resultTitle(row)} · ${row?.crop?.name || 'Sin cultivo'}`;
export const proratedNote = 'Incluye producción repartida en proporción a la superficie; no es una medición por subdivisión.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseSurface(value) {
  const [kind, id] = String(value || '').split(':');
  return id && UUID.test(id) ? (kind === 'sub' ? { sub_lot_id: id } : kind === 'lot' ? { lot_id: id } : {}) : {};
}
/** Shared filters -> /harvest-records/results params. Empty values are omitted. */
export function resultParams(filters = {}, { page = 1, pageSize = 25 } = {}) {
  const params = { page, pageSize, ...parseSurface(filters.surface) };
  if (filters.campaign) params.campaign = filters.campaign;
  if (filters.crop) params.crop = filters.crop;
  if (typeof filters.search === 'string' && filters.search.trim()) params.search = filters.search.trim();
  return params;
}
/** Result row -> exact id filter for the Registros tab ("Ver los N registros"). */
export function recordsFilterFor(row) {
  return {
    campaign_id: row.campaign.id, crop_id: row.crop.id, lot_id: row.lot.id, ...(row.sub_lot ? { sub_lot_id: row.sub_lot.id } : {}),
    label: resultLabel(row),
  };
}
export const surfaceOptionsFromLots = (lots = []) => lots.flatMap(lot => [
  { value: `lot:${lot.id}`, label: lot.name },
  ...(lot.active_layout?.sub_lots || []).map(sub => ({ value: `sub:${sub.id}`, label: `${lot.name} · ${sub.name}` })),
]);
export const mergeOptions = (...lists) => [...new Map(lists.flat().filter(Boolean).map(option => [option.value, option])).values()];

/** antd tree rows: sublot children only when they exist (an empty array would still render an expander). */
export const treeRows = rows => rows.map(({ children, ...row }) => children?.length ? { ...row, children: children.map(child => ({ ...child })) } : row);
export function unclassifiedNote(summary) {
  const count = Number(summary?.unclassified?.records || 0);
  return count ? `${count} ${count === 1 ? 'cosecha no se puede clasificar' : 'cosechas no se pueden clasificar'} por falta de campaña, cultivo o superficies válidas. No se asignaron por suposición.` : null;
}

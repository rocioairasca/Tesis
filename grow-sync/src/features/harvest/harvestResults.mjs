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

/** Formats production converting kg → selected unit (same divisors as yield). Pure presentation. */
const PROD_UNIT_LABEL = { kg: 'kg', qq: 'qq', tn: 'tn' };
export const formatProductionUnit = (kgValue, unit = 'kg') => {
  const kg = numberOrNull(kgValue);
  if (kg === null) return 'Pendiente';
  const divisor = (YIELD_UNITS[unit] || YIELD_UNITS.kg).divisor;
  return `${format(kg / divisor, 2)} ${PROD_UNIT_LABEL[unit] || 'kg'}`;
};

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

// ---- Real costs from Planning (FIN-01B) ------------------------------------------------------------------------------
// Costs are a KNOWN FLOOR (≥) until an explicit, still-valid completeness declaration exists (FIN-01C); then the status is "Completo".
// Money arrives as decimal strings; rounding to 2 decimals (half up) is done on integers, never with floats.
function microUnits(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const result = BigInt(whole) * 1000000n + BigInt((fraction + '000000').slice(0, 6));
  return negative ? -result : result;
}
export function formatUsd(value) {
  const micro = microUnits(value);
  if (micro == null) return '—';
  const cents = (micro + 5000n) / 10000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = String(cents % 100n).padStart(2, '0');
  return `USD ${whole}${fraction === '00' ? '' : ',' + fraction}`; // integers never show ,00
}
export const COST_STATUS = { pending: { label: 'Pendiente', tone: 'neutral' }, partial: { label: 'Parcial', tone: 'warning' }, complete: { label: 'Completo', tone: 'success' } };
export const costStatus = costs => (costs && COST_STATUS[costs.status]) || null;
export const hasKnownCost = costs => !!costs && costs.known_total_usd != null;
const floor = (costs, text) => text === '—' ? text : (costs?.is_minimum ? `≥ ${text}` : text);
export const formatKnownCost = costs => hasKnownCost(costs) ? `${formatUsd(costs.known_total_usd)} conocidos` : 'Pendiente';
export const formatCostPerHa = costs => costs?.per_ha_usd == null ? '—' : floor(costs, `${formatUsd(costs.per_ha_usd)}/ha`);
// A complete cost keeps "prov." while the harvest is open: production may still grow even though costs are reviewed.
export const formatCostPerTn = costs => costs?.per_tn_usd == null ? '—' : floor(costs, `${formatUsd(costs.per_tn_usd)}/t`) + (costs.status === 'complete' && costs.is_provisional ? ' · prov.' : '');
export const costDisclaimer = 'Estos costos corresponden a ejecuciones registradas en GrowSync. Pueden existir otros gastos aún no imputados.';
export const provisionalNote = 'La cosecha sigue en curso: el costo por tonelada es provisional.';
export const summaryCostHelp = 'Costos registrados hasta el momento';
export const hasCostAccess = data => data?.summary?.cost_access === true;
/** Identity of one result, used to ask for its detail and to remember the selection. */
export const resultKeyParams = row => ({ campaign_id: row.campaign.id, crop_id: row.crop.id, lot_id: row.lot.id, ...(row.sub_lot ? { sub_lot_id: row.sub_lot.id } : {}) });
export const sameResult = (row, params) => !!row && !!params && row.campaign.id === params.campaign_id && row.crop.id === params.crop_id
  && row.lot.id === params.lot_id && (row.sub_lot?.id || null) === (params.sub_lot_id || null);

// ---- Additional expenses and completeness (FIN-01C) -------------------------------------------------------------------
export const COST_CATEGORIES = [
  { value: 'seed', label: 'Semilla' }, { value: 'contractor', label: 'Contratista' }, { value: 'labor', label: 'Labor' },
  { value: 'fuel_machinery', label: 'Combustible / maquinaria' }, { value: 'rent', label: 'Alquiler' }, { value: 'freight', label: 'Flete' },
  { value: 'drying', label: 'Secado' }, { value: 'other', label: 'Otro' },
];
export const categoryLabel = value => COST_CATEGORIES.find(item => item.value === value)?.label || 'Otro';
export const overlapWarning = 'Verificá que este gasto no esté ya registrado mediante una planificación ejecutada.';
export const campaignScopeNotice = 'El gasto se distribuirá entre los destinos actuales de la campaña.';
export const completeWarning = 'Confirmás que revisaste los gastos de este lote, campaña y cultivo y que no quedan gastos conocidos por registrar.';
export const pendingEntryNote = 'Pendiente: falta la cotización del día de pago. No suma al total hasta confirmarla.';
export const COMPLETE_BLOCKERS = {
  no_known_cost: 'Todavía no hay gastos conocidos para declarar.',
  pending_lines: 'Hay líneas de planificaciones pendientes de valorizar.',
  pending_entries: 'Hay gastos pendientes de cotización.',
};
export const blockerText = blockers => (blockers || []).map(code => COMPLETE_BLOCKERS[code]).filter(Boolean);
export const distributionLabel = method => (method === 'manual_percent' ? 'Porcentaje manual' : 'Por superficie');
/** Percent text ("33.3333") -> integer x10^4, or null when invalid. Never a float. */
export function percentUnits(text) {
  const value = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 10000 + Number(fraction.padEnd(4, '0'));
}
export const percentsSumToHundred = list => list.length > 0 && list.every(text => percentUnits(text) != null) && list.reduce((sum, text) => sum + percentUnits(text), 0) === 1000000;
export const revisedBy = part => (part?.declared_by ? `Revisado por ${part.declared_by}` : 'Revisado') + (part?.declared_at ? ` · ${String(part.declared_at).slice(0, 10).split('-').reverse().join('/')}` : '');

/** Builds the POST /cost-entries body from the form state. Tenant and actor are never part of it. */
export function buildCostPayload(form) {
  const dest = form.scope === 'campaign'
    ? { scope: 'campaign', crop_id: form.crop_id, method: 'area_proportional' }
    : { scope: 'lots', crop_id: form.crop_id, method: form.method,
        targets: form.targets.map(target => ({ lot_id: target.lot_id, sub_lot_id: target.sub_lot_id || null, ...(form.method === 'manual_percent' ? { percent: String(target.percent).replace(',', '.') } : {}) })) };
  const ars = form.currency === 'ARS';
  const clean = value => (value == null || String(value).trim() === '' ? null : String(value).trim());
  return { campaign_id: form.campaign_id, category: form.category, description: form.description.trim(), expense_date: form.expense_date, currency: form.currency,
    amount: String(form.amount).trim().replace(',', '.'),
    ...(ars ? { payment_date: clean(form.payment_date), fx_rate: clean(form.fx_rate)?.replace(',', '.') ?? null, fx_date: clean(form.fx_rate) && clean(form.payment_date) ? form.payment_date : null, fx_source: clean(form.fx_source) } : {}),
    supplier_name: clean(form.supplier_name), reference: clean(form.reference), notes: clean(form.notes), destination: dest };
}

'use strict';
// "Resultados por lote": productive base (FIN-01A) plus real costs already sealed by Planning (FIN-01B).
// Costs: the latest Planning economic snapshots + current additional cost entries (harvestCostSources.js).
// A result is `complete` ONLY with a valid explicit completeness declaration and nothing pending (FIN-01C).
// Result identity: lot_id + sub_lot_id + campaign_id + crop_id. Every amount is exact (BigInt hundredths);
// yield is always SUM(production)/SUM(area), never an average of per-record yields.
const economic = require('./economicExecution');
const sources = require('./harvestCostSources');
const { keyOf, inClause, campaignIdsOf, cropIdsOf, usd, hasKnown, hasEvidence, hasPending, loadCosts, loadDeclarations, declarationValid, mergeCosts, rowComplete, costView } = sources;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const fold = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const optionalUuid = (value, label) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw fail(`${label} inválido.`);
  return value.toLowerCase();
};

// Decimal text -> hundredths (round half up). null when the value is not a finite decimal.
function cents(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  let result = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) result += 1n;
  return negative ? -result : result;
}
const decimal2 = value => {
  const negative = value < 0n, abs = negative ? -value : value;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};
// kg/ha with two decimals, half up, from hundredths of kg and hundredths of ha.
const yieldText = (productionCents, areaCents) =>
  areaCents > 0n ? decimal2((productionCents * 200n + areaCents) / (2n * areaCents)) : null;

const parentKeyOf = key => { const [lot, , campaign, crop] = key.split('|'); return [lot, campaign, crop].join('|'); };

// Largest-remainder split of an exact total by integer weights. Stable order breaks ties.
function distribute(total, weights) {
  const sum = weights.reduce((n, w) => n + w, 0n);
  const shares = weights.map(w => total * w / sum);
  let left = total - shares.reduce((n, v) => n + v, 0n);
  const ranked = weights.map((w, index) => ({ index, remainder: total * w % sum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; left > 0n; i++, left--) shares[ranked[i % ranked.length].index]++;
  return shares;
}

const reasonLabels = ['missing_campaign', 'missing_crop', 'invalid_production', 'invalid_area', 'invalid_link_area', 'orphan_link'];

/** Turns the rows of ONE harvest record (record x links) into result parts or an unclassified reason. */
function classify(rows) {
  const first = rows[0];
  const production = cents(first.production_kg);
  const recordArea = cents(first.harvested_area_ha);
  const unclassified = reason => ({ unclassified: reason });
  if (production == null || production < 0n) return unclassified('invalid_production');
  const links = rows.filter(row => row.crop_assignment_id);
  if (!links.length) {
    if (!first.campaign_id) return unclassified('missing_campaign');
    if (!first.crop_id) return unclassified('missing_crop');
    if (recordArea == null || recordArea <= 0n) return unclassified('invalid_area');
    return { parts: [{ key: keyOf(first.lot_id, first.sub_lot_id, first.campaign_id, first.crop_id), production, area: recordArea, prorated: false }] };
  }
  if (links.some(link => !link.ca_id)) return unclassified('orphan_link');
  const byKey = new Map();
  for (const link of links) {
    const key = keyOf(link.ca_lot_id, link.ca_sub_lot_id, link.ca_campaign_id, link.ca_crop_id);
    const area = cents(link.link_area_ha);
    byKey.set(key, [...(byKey.get(key) || []), area]);
  }
  if (byKey.size === 1) {
    // Same result key: consolidate without any proration. The record owns its area; fall back to the links.
    const [key, areas] = [...byKey.entries()][0];
    const linkedArea = areas.every(a => a != null && a > 0n) ? areas.reduce((n, a) => n + a, 0n) : null;
    const area = recordArea != null && recordArea > 0n ? recordArea : linkedArea;
    if (area == null) return unclassified('invalid_area');
    return { parts: [{ key, production, area, prorated: false }] };
  }
  // Different keys and no production measured per destination: explicit area-proportional proration.
  const keys = [...byKey.keys()].sort();
  const weights = [];
  for (const key of keys) {
    const areas = byKey.get(key);
    if (areas.some(a => a == null || a <= 0n)) return unclassified('invalid_link_area');
    weights.push(areas.reduce((n, a) => n + a, 0n));
  }
  const shares = distribute(production, weights);
  return { parts: keys.map((key, i) => ({ key, production: shares[i], area: weights[i], prorated: true })) };
}

// ---- Names and filters ---------------------------------------------------------------------------------------------
async function loadNames(pool, companyId) {
  const q = sql => pool.query(sql, [companyId]).then(r => r.rows);
  const [lots, subLots, crops, campaigns] = await Promise.all([
    q('SELECT id, name, COALESCE(area_ha, NULLIF(area, 0))::text AS area_ha FROM lots WHERE company_id = $1'),
    q('SELECT id, lot_id, name, area_ha::text AS area_ha FROM sub_lots WHERE company_id = $1'),
    q('SELECT id, name FROM crops WHERE company_id = $1'),
    q('SELECT id, name FROM campaigns WHERE company_id = $1'),
  ]);
  return { lots, subLots, crops, campaigns };
}

function parseFilters(query = {}, data) {
  const filters = {
    campaign_id: optionalUuid(query.campaign_id, 'La campaña'), crop_id: optionalUuid(query.crop_id, 'El cultivo'),
    lot_id: optionalUuid(query.lot_id, 'El lote'), sub_lot_id: optionalUuid(query.sub_lot_id, 'La subdivisión'),
    campaign_ids: null, crop_ids: null,
    search: typeof query.search === 'string' ? fold(query.search) : '',
  };
  // Names are accepted for compatibility with the existing Cosechas filters (id or name).
  if (!filters.campaign_id && query.campaign) {
    const value = String(query.campaign);
    filters.campaign_ids = UUID_RE.test(value) ? [value.toLowerCase()]
      : data.campaigns.filter(c => fold(c.name) === fold(value)).map(c => c.id);
  }
  if (!filters.crop_id && query.crop) filters.crop_ids = data.crops.filter(c => fold(c.name) === fold(query.crop)).map(c => c.id);
  return filters;
}
const pageNumber = (value, fallback, max) => Math.min(Math.max(Math.trunc(Number(value)) || fallback, 1), max);

// ---- Productive facts (filters are a conservative SQL pre-filter; the exact checks stay in JS) -----------------------
async function loadFacts(pool, companyId, filters) {
  const campaigns = campaignIdsOf(filters), crops = cropIdsOf(filters);
  // Cycles: a cycle key is exact, so every filter can be applied here.
  const cycleParams = [companyId], cycleWhere = ['company_id = $1'];
  if (campaigns) cycleWhere.push(`${inClause(cycleParams, 'campaign_id', campaigns)}`);
  if (crops) cycleWhere.push(`${inClause(cycleParams, 'crop_id', crops)}`);
  if (filters.lot_id) { cycleParams.push(filters.lot_id); cycleWhere.push(`lot_id = $${cycleParams.length}`); }
  if (filters.sub_lot_id) { cycleParams.push(filters.sub_lot_id); cycleWhere.push(`sub_lot_id = $${cycleParams.length}`); }
  const cycles = (await pool.query(`SELECT id, lot_id, sub_lot_id, campaign_id, crop_id, area_ha::text AS area_ha, (end_date IS NOT NULL) AS closed
    FROM crop_assignments WHERE ${cycleWhere.join(' AND ')}`, cycleParams)).rows;

  // Records: keep a record if one of its cycle links matches, if a link is orphaned (reported as unclassified),
  // or if it has no links and its own known columns do not contradict the filter.
  const params = [companyId], where = ['hr.company_id = $1', 'hr.enabled = TRUE'];
  if (filters.lot_id) { params.push(filters.lot_id); where.push(`hr.lot_id = $${params.length}`); }
  const link = [], own = [];
  if (campaigns) { link.push(`${inClause(params, 'ca.campaign_id', campaigns)}`); own.push(`(hr.campaign_id IS NULL OR ${inClause(params, 'hr.campaign_id', campaigns)})`); }
  if (crops) { link.push(`${inClause(params, 'ca.crop_id', crops)}`); own.push(`(hr.crop_id IS NULL OR ${inClause(params, 'hr.crop_id', crops)})`); }
  if (filters.sub_lot_id) { params.push(filters.sub_lot_id); link.push(`ca.sub_lot_id = $${params.length}`); own.push(`hr.sub_lot_id = $${params.length}`); }
  if (link.length) {
    where.push(`(
      EXISTS (SELECT 1 FROM harvest_crop_assignments hca JOIN crop_assignments ca ON ca.id = hca.crop_assignment_id AND ca.company_id = hr.company_id
              WHERE hca.harvest_id = hr.id AND ${link.join(' AND ')})
      OR EXISTS (SELECT 1 FROM harvest_crop_assignments hca LEFT JOIN crop_assignments ca ON ca.id = hca.crop_assignment_id AND ca.company_id = hr.company_id
                 WHERE hca.harvest_id = hr.id AND ca.id IS NULL)
      OR (NOT EXISTS (SELECT 1 FROM harvest_crop_assignments hca WHERE hca.harvest_id = hr.id) AND ${own.join(' AND ')})
    )`);
  }
  const records = (await pool.query(`SELECT hr.id AS record_id, hr.lot_id, hr.sub_lot_id, hr.crop_id, hr.campaign_id,
      hr.production_kg::text AS production_kg, hr.harvested_area_ha::text AS harvested_area_ha,
      hca.crop_assignment_id, hca.harvested_area_ha::text AS link_area_ha,
      ca.id AS ca_id, ca.lot_id AS ca_lot_id, ca.sub_lot_id AS ca_sub_lot_id, ca.campaign_id AS ca_campaign_id, ca.crop_id AS ca_crop_id
    FROM harvest_records hr
    LEFT JOIN harvest_crop_assignments hca ON hca.harvest_id = hr.id
    LEFT JOIN crop_assignments ca ON ca.id = hca.crop_assignment_id AND ca.company_id = hr.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY hr.id, hca.crop_assignment_id`, params)).rows;
  return { records, cycles };
}

// ---- Result computation --------------------------------------------------------------------------------------------
const rowMeta = new WeakMap();
const cents6 = text => { const [w, f = ''] = String(text).split('.'); return BigInt(w) * 1000000n + BigInt((f + '000000').slice(0, 6)); };
const fmt6 = value => `${value / 1000000n}.${String(value % 1000000n).padStart(6, '0')}`;

async function compute(pool, { user, query = {}, withDetail = false }) {
  const companyId = user?.company_id;
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) throw fail('No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.');
  if (!pool) throw fail('Base de datos no disponible.', 503);
  // Economic access is decided here, on the server: harvest.view alone never returns an amount.
  const costAccess = economic.allowed(user, economic.readKeys);
  const names = await loadNames(pool, companyId);
  const filters = parseFilters(query, names);
  const [facts, costs, declarations] = await Promise.all([
    loadFacts(pool, companyId, filters),
    costAccess ? loadCosts(pool, companyId, filters, withDetail) : { byKey: new Map(), additionalAvailable: true },
    costAccess ? loadDeclarations(pool, companyId, filters) : new Map(),
  ]);
  const name = {
    lot: new Map(names.lots.map(l => [l.id, l])), sub: new Map(names.subLots.map(s => [s.id, s])),
    crop: new Map(names.crops.map(c => [c.id, c.name])), campaign: new Map(names.campaigns.map(c => [c.id, c.name])),
  };

  // 1) Result keys from productive cycles (authoritative surface and closure state) and from sealed cost targets.
  const keys = new Map();
  const ensure = key => {
    if (!keys.has(key)) {
      const [lot, sub, campaign, crop] = key.split('|');
      keys.set(key, { key, lot_id: lot, sub_lot_id: sub || null, campaign_id: campaign, crop_id: crop,
        production: 0n, area: 0n, records: new Set(), prorated: 0, cycles: [], cost: null });
    }
    return keys.get(key);
  };
  for (const cycle of facts.cycles) ensure(keyOf(cycle.lot_id, cycle.sub_lot_id, cycle.campaign_id, cycle.crop_id)).cycles.push(cycle);
  // The economic combination must equal the productive one explicitly (lot + sublot + campaign + beneficiary crop).
  for (const [key, cost] of costs.byKey) ensure(key).cost = cost;

  // 2) Harvest facts, one record at a time, then aggregated by key.
  const byRecord = new Map();
  for (const row of facts.records) byRecord.set(row.record_id, [...(byRecord.get(row.record_id) || []), row]);
  const unclassified = { records: 0, production: 0n, area: 0n, reasons: Object.fromEntries(reasonLabels.map(r => [r, 0])), record_ids: [] };
  for (const rows of byRecord.values()) {
    const outcome = classify(rows), first = rows[0];
    if (outcome.unclassified) {
      // Filters apply only to fields the record actually knows; an unknown field is never guessed.
      if (filters.lot_id && first.lot_id !== filters.lot_id) continue;
      if (filters.sub_lot_id && first.sub_lot_id !== filters.sub_lot_id) continue;
      if (filters.crop_id && first.crop_id && first.crop_id !== filters.crop_id) continue;
      if (filters.crop_ids && first.crop_id && !filters.crop_ids.includes(first.crop_id)) continue;
      if (filters.campaign_id && first.campaign_id && first.campaign_id !== filters.campaign_id) continue;
      if (filters.campaign_ids && first.campaign_id && !filters.campaign_ids.includes(first.campaign_id)) continue;
      unclassified.records++; unclassified.reasons[outcome.unclassified]++;
      unclassified.production += cents(first.production_kg) ?? 0n;
      unclassified.area += cents(first.harvested_area_ha) ?? 0n;
      if (unclassified.record_ids.length < 50) unclassified.record_ids.push(first.record_id);
      continue;
    }
    for (const part of outcome.parts) {
      const target = ensure(part.key);
      target.production += part.production; target.area += part.area; target.records.add(first.record_id);
      if (part.prorated) target.prorated++;
    }
  }

  // 3) Result rows (own key level), with surface and harvest status.
  const surfaceOf = entry => {
    if (entry.cycles.length) {
      const areas = entry.cycles.map(c => cents(c.area_ha));
      return areas.every(a => a != null && a > 0n) ? { value: areas.reduce((n, a) => n + a, 0n), source: 'cycles' } : { value: null, source: null };
    }
    const area = entry.sub_lot_id ? cents(name.sub.get(entry.sub_lot_id)?.area_ha) : cents(name.lot.get(entry.lot_id)?.area_ha);
    return area != null && area > 0n ? { value: area, source: 'surface_fallback' } : { value: null, source: null };
  };
  const statusOf = entry => {
    if (!entry.cycles.length) return null;
    if (entry.cycles.every(c => c.closed)) return 'closed';
    return entry.records.size ? 'in_progress' : 'not_started';
  };
  const matches = entry => (!filters.campaign_id || entry.campaign_id === filters.campaign_id)
    && (!filters.campaign_ids || filters.campaign_ids.includes(entry.campaign_id))
    && (!filters.crop_id || entry.crop_id === filters.crop_id)
    && (!filters.crop_ids || filters.crop_ids.includes(entry.crop_id))
    && (!filters.lot_id || entry.lot_id === filters.lot_id);
  const entries = [...keys.values()].filter(matches);
  const subText = entry => entry.sub_lot_id ? name.sub.get(entry.sub_lot_id)?.name : '';
  const base = entry => {
    const surface = surfaceOf(entry), harvested = entry.records.size > 0;
    return { entry, surface, status: statusOf(entry), production: harvested ? entry.production : null, area: harvested ? entry.area : null,
      records: new Set(entry.records), prorated: entry.prorated, cost: entry.cost };
  };
  const present = (row, level, children = []) => {
    const e = row.entry;
    const lot = name.lot.get(e.lot_id), sub = e.sub_lot_id ? name.sub.get(e.sub_lot_id) : null;
    const out = {
      key: level === 'lot' ? parentKeyOf(e.key) : e.key, level,
      lot: { id: e.lot_id, name: lot?.name ?? null }, sub_lot: e.sub_lot_id ? { id: e.sub_lot_id, name: sub?.name ?? null } : null,
      campaign: { id: e.campaign_id, name: name.campaign.get(e.campaign_id) ?? null }, crop: { id: e.crop_id, name: name.crop.get(e.crop_id) ?? null },
      surface_ha: row.surface.value == null ? null : decimal2(row.surface.value), surface_source: row.surface.source,
      production_kg: row.production == null ? null : decimal2(row.production),
      harvested_area_ha: row.area == null ? null : decimal2(row.area),
      yield_kg_ha: row.production == null ? null : yieldText(row.production, row.area),
      records_count: row.records.size, harvest_status: row.status,
      production_basis: { prorated_records: row.prorated, method: row.prorated ? 'area_proportional' : null },
      costs: costAccess ? costView(row.cost, row.surface.value, row.production, row.status, rowComplete(row.parts || [row], declarations)) : null,
      children,
    };
    rowMeta.set(out, { parts: row.parts || [row], cost: row.cost });
    return out;
  };
  const toRowObject = parentEntries => {
    // Parent = total of own lot-level key plus every sublot key (D2). Lot-level amounts are never spread to children.
    const parts = parentEntries.map(base);
    const own = parts.find(p => !p.entry.sub_lot_id), children = parts.filter(p => p.entry.sub_lot_id);
    const harvested = parts.filter(p => p.production != null);
    const surfaces = parts.map(p => p.surface.value);
    const statuses = parts.map(p => p.status).filter(Boolean);
    const total = {
      entry: (own || children[0]).entry, parts, surface: { value: surfaces.every(v => v != null) ? surfaces.reduce((n, v) => n + v, 0n) : null, source: own ? own.surface.source : 'cycles' },
      status: !statuses.length ? null : statuses.every(s => s === 'closed') ? 'closed' : statuses.every(s => s === 'not_started') ? 'not_started' : 'in_progress',
      production: harvested.length ? harvested.reduce((n, p) => n + p.production, 0n) : null,
      area: harvested.length ? harvested.reduce((n, p) => n + p.area, 0n) : null,
      records: new Set(parts.flatMap(p => [...p.records])), prorated: parts.reduce((n, p) => n + p.prorated, 0),
      cost: mergeCosts(parts.map(p => p.cost)),
    };
    const row = present(total, 'lot', children.sort((a, b) => fold(subText(a.entry)).localeCompare(fold(subText(b.entry)), 'es', { numeric: true })).map(c => present(c, 'sub_lot')));
    row.sub_lot = null; // the parent represents the whole lot
    row.surface_source = own ? own.surface.source : 'children';
    return row;
  };

  let rows;
  if (filters.sub_lot_id) {
    // A sublot filter returns the matching sublot results as top-level rows, never a partial lot total.
    rows = entries.filter(e => e.sub_lot_id === filters.sub_lot_id).map(e => present(base(e), 'sub_lot'));
  } else {
    const groups = new Map();
    for (const e of entries) groups.set(parentKeyOf(e.key), [...(groups.get(parentKeyOf(e.key)) || []), e]);
    rows = [...groups.values()].map(toRowObject);
  }
  if (filters.search) {
    rows = rows.filter(row => [row.lot.name, row.crop.name, row.campaign.name, row.sub_lot?.name, ...row.children.map(c => c.sub_lot?.name)]
      .some(value => fold(value).includes(filters.search)));
  }
  const compare = (a, b) => fold(a.crop.name).localeCompare(fold(b.crop.name), 'es')
    || fold(a.lot.name).localeCompare(fold(b.lot.name), 'es', { numeric: true })
    || fold(a.sub_lot?.name).localeCompare(fold(b.sub_lot?.name), 'es', { numeric: true }) || a.key.localeCompare(b.key);
  rows.sort(compare);

  // Summary over the WHOLE filtered set (not the page). Parents already include their children: never add both.
  const sum = selector => rows.reduce((n, r) => n + (selector(r) == null ? 0n : cents(selector(r))), 0n);
  const recordIds = new Set();
  const idsByKey = new Map([...keys.values()].map(e => [e.key, e.records]));
  const idsOf = row => row.level === 'sub_lot' ? idsByKey.get(row.key) : new Set([...idsByKey.entries()].filter(([k]) => parentKeyOf(k) === row.key).flatMap(([, s]) => [...s]));
  for (const row of rows) for (const id of idsOf(row)) recordIds.add(id);
  const summary = {
    lots: new Set(rows.map(r => r.lot.id)).size, results: rows.length,
    results_with_harvest: rows.filter(r => r.records_count > 0).length,
    harvested_area_ha: decimal2(sum(r => r.harvested_area_ha)), production_kg: decimal2(sum(r => r.production_kg)),
    records: recordIds.size, prorated_records: rows.reduce((n, r) => n + r.production_basis.prorated_records, 0),
    cost_access: costAccess,
    unclassified: { records: unclassified.records, production_kg: decimal2(unclassified.production), harvested_area_ha: decimal2(unclassified.area),
      reasons: unclassified.reasons, record_ids: unclassified.record_ids },
  };
  if (costAccess) {
    // Known cost only; "complete" rows come from explicit declarations. No average is offered.
    const known = rows.reduce((n, r) => { const c = rowMeta.get(r).cost; return n + (hasKnown(c) ? c.total : 0n); }, 0n);
    summary.known_cost_usd = usd(known);
    summary.complete_lots = new Set(rows.filter(r => r.costs.status === 'complete').map(r => r.lot.id)).size;
    summary.incomplete_lots = new Set(rows.filter(r => r.costs.status !== 'complete').map(r => r.lot.id)).size;
    summary.lots_without_known_cost = new Set(rows.filter(r => r.costs.status === 'pending').map(r => r.lot.id)).size;
    summary.additional_costs_available = costs.additionalAvailable;
  }
  return { filters, query, rows, summary, costAccess, name, declarations, companyId, user };
}
async function results(pool, { user, query = {} }) {
  const { filters, rows, summary } = await compute(pool, { user, query });
  const pageSize = pageNumber(query.pageSize, 25, 100), page = pageNumber(query.page, 1, 1e6);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, totalPages);
  return {
    filters: { campaign_id: filters.campaign_id, crop_id: filters.crop_id, lot_id: filters.lot_id, sub_lot_id: filters.sub_lot_id, search: query.search || '' },
    summary, data: rows.slice((current - 1) * pageSize, current * pageSize),
    pagination: { total: rows.length, page: current, pageSize, totalPages: rows.length ? totalPages : 0 },
  };
}

/** Detail of ONE result: productive summary plus (with economic access) the cost breakdown per Planning. */
async function detail(pool, { user, query = {} }) {
  const required = { campaign_id: 'La campaña', crop_id: 'El cultivo', lot_id: 'El lote' };
  for (const [key, label] of Object.entries(required)) if (!query[key]) throw fail(`${label} es obligatorio.`);
  const state = await compute(pool, { user, query: { campaign_id: query.campaign_id, crop_id: query.crop_id, lot_id: query.lot_id, sub_lot_id: query.sub_lot_id }, withDetail: true });
  const row = state.rows[0];
  if (!row) throw fail('Resultado no encontrado.', 404);
  const result = { ...row, cost_access: state.costAccess,
    records_query: { campaign_id: row.campaign.id, crop_id: row.crop.id, lot_id: row.lot.id, ...(row.sub_lot ? { sub_lot_id: row.sub_lot.id } : {}) } };
  if (!state.costAccess) return result;
  const meta = rowMeta.get(row), plannings = [];
  for (const part of meta.parts) {
    if (!part.cost) continue;
    const sub = part.entry.sub_lot_id ? { id: part.entry.sub_lot_id, name: state.name.sub.get(part.entry.sub_lot_id)?.name ?? null } : null;
    for (const planning of part.cost.plannings.values()) {
      const known = planning.productKnown || planning.laborKnown;
      plannings.push({ planning_id: planning.planning_id, planning_enabled: planning.enabled, revision: planning.revision, activity: planning.activity, effective_date: planning.effective_date,
        sub_lot: sub, allocation_weight: planning.weight,
        products_usd: planning.productKnown ? usd(planning.products) : null, labor_usd: planning.laborKnown ? usd(planning.labor) : null,
        known_usd: known ? usd(planning.products + planning.labor) : null, pending_lines: planning.pending, lines: planning.lines });
    }
  }
  plannings.sort((a, b) => String(b.effective_date).localeCompare(String(a.effective_date)) || String(a.planning_id).localeCompare(String(b.planning_id)));

  // Additional expenses grouped by category (each entry x target counted once, with its own allocated share).
  const groups = new Map();
  for (const part of meta.parts) {
    if (!part.cost) continue;
    const sub = part.entry.sub_lot_id ? { id: part.entry.sub_lot_id, name: state.name.sub.get(part.entry.sub_lot_id)?.name ?? null } : null;
    for (const item of part.cost.entries.values()) {
      if (!groups.has(item.category)) groups.set(item.category, { category: item.category, sum: null, pending: 0, entries: [] });
      const group = groups.get(item.category);
      group.entries.push({ ...item, sub_lot: sub });
      if (item.pending) group.pending++; else group.sum = (group.sum ?? 0n) + cents6(item.amount_usd);
    }
  }
  const otherExpenses = [...groups.values()].map(({ sum, ...g }) => ({ ...g, known_usd: sum == null ? null : fmt6(sum),
    entries: g.entries.sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)) || String(a.entry_id).localeCompare(String(b.entry_id))) }))
    .sort((a, b) => a.category.localeCompare(b.category));

  // Completeness per literal key (parts with economic evidence): declared, valid or invalidated, who and when.
  const relevant = meta.parts.filter(part => hasEvidence(part.cost));
  const declaredBy = [...new Set(relevant.map(part => state.declarations.get(part.entry.key)?.declared_by).filter(Boolean))];
  const people = new Map();
  if (declaredBy.length) {
    const params = [state.companyId];
    const found = await pool.query(`SELECT id, COALESCE(NULLIF(btrim(full_name), ''), NULLIF(btrim(name), ''), email) AS display FROM users WHERE company_id = $1 AND ${inClause(params, 'id', declaredBy)}`, params);
    for (const person of found.rows) people.set(person.id, person.display);
  }
  const parts = relevant.map(part => {
    const declaration = state.declarations.get(part.entry.key);
    const valid = declarationValid(declaration, part.cost);
    return { sub_lot: part.entry.sub_lot_id ? { id: part.entry.sub_lot_id, name: state.name.sub.get(part.entry.sub_lot_id)?.name ?? null } : null,
      state: valid ? 'complete' : 'open', declared: !!declaration && declaration.state === 'complete', valid,
      evidence_changed: !!declaration && declaration.state === 'complete' && !valid,
      declared_by: declaration ? (people.get(declaration.declared_by) ?? null) : null, declared_at: declaration ? declaration.declared_at : null,
      observation: declaration ? declaration.observation : null, reason: declaration ? declaration.reason : null, auto_invalidated: declaration ? declaration.auto_invalidated : false,
      pending_lines: part.cost.pendingLines.size, pending_entries: part.cost.pendingEntries.size };
  });
  const rowCosts = row.costs;
  const blockers = [];
  if (!hasKnown(meta.cost)) blockers.push('no_known_cost');
  if (rowCosts.pending_lines > 0) blockers.push('pending_lines');
  if (rowCosts.pending_entries > 0) blockers.push('pending_entries');
  const economicEdit = economic.allowed(user, economic.editKeys);
  result.economic_edit = economicEdit;
  result.completeness = { status: rowCosts.status, parts, blockers, can_declare: economicEdit && !blockers.length && rowCosts.status !== 'complete',
    can_reopen: economicEdit && parts.some(part => part.declared), include_children: row.level === 'lot' && row.children.length > 0 };
  result.cost_detail = { plannings, other_expenses: otherExpenses, source: 'planning_economic_snapshots_and_cost_entries',
    note: 'Estos costos corresponden a ejecuciones registradas en GrowSync. Pueden existir otros gastos aún no imputados.' };
  return result;
}

module.exports = { results, detail, classify, cents, decimal2, yieldText, distribute, keyOf, parentKeyOf };

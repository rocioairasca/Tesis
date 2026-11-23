'use strict';
// "Resultados por lote": productive base (FIN-01A) plus real costs already sealed by Planning (FIN-01B).
// Costs come ONLY from the latest revision of each Planning economic snapshot; manual expenses and the
// completeness declaration do not exist yet (FIN-01C), so a result is never "complete".
// Result identity: lot_id + sub_lot_id + campaign_id + crop_id. Every amount is exact (BigInt hundredths);
// yield is always SUM(production)/SUM(area), never an average of per-record yields.
const economic = require('./economicExecution');
const money = require('../../shared/costEstimate.cjs');
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

const keyOf = (lot, sub, campaign, crop) => [lot, sub || '', campaign, crop].join('|');
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
const campaignIdsOf = f => f.campaign_id ? [f.campaign_id] : f.campaign_ids;
const cropIdsOf = f => f.crop_id ? [f.crop_id] : f.crop_ids;

// Pushes ids as individual parameters (no array params: the production adapter uses postgres.js unsafe()).
function inClause(params, column, ids) {
  if (!ids.length) return 'FALSE';
  return `${column} IN (${ids.map(id => { params.push(id); return `$${params.length}`; }).join(', ')})`;
}

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

// ---- Real costs from Planning (FIN-01B). The sealed economic snapshots are the only source. ---------------------------
// Exact arithmetic: amount (scale 1e12) x allocation_weight (scale 1e12) = scale 1e24. Never JS floats.
const S24 = money.COST_SCALE * money.COST_SCALE;
const half = (numerator, denominator) => (numerator * 2n + denominator) / (2n * denominator);
const fmt6 = value => `${value / 1000000n}.${String(value % 1000000n).padStart(6, '0')}`;
const usd = scaled24 => fmt6(half(scaled24, 10n ** 18n));
const newCost = () => ({ total: 0n, products: 0n, labor: 0n, productKnown: false, laborKnown: false, known: new Set(), pending: new Set(), plannings: new Map() });

/** Latest revision of every Planning only (a superseded revision is never counted), per result key. */
async function loadCosts(pool, companyId, filters, withLines) {
  const campaigns = campaignIdsOf(filters), crops = cropIdsOf(filters);
  const build = () => {
    const params = [companyId];
    // planning.enabled is soft-disable/visibility, NOT an economic reversal: a sealed snapshot keeps counting.
    const where = ['s.company_id = $1',
      'NOT EXISTS (SELECT 1 FROM economic_snapshots n WHERE n.company_id = s.company_id AND n.supersedes_id = s.id)'];
    if (campaigns) where.push(`${inClause(params, 's.campaign_id', campaigns)}`);
    const target = ['t.snapshot_id = s.id', 't.company_id = s.company_id'];
    if (crops) target.push(`${inClause(params, 't.beneficiary_crop_id', crops)}`);
    if (filters.lot_id) { params.push(filters.lot_id); target.push(`t.lot_id = $${params.length}`); }
    if (filters.sub_lot_id) { params.push(filters.sub_lot_id); target.push(`t.sub_lot_id = $${params.length}`); }
    return { params, where, target };
  };
  const a = build();
  const targets = (await pool.query(`SELECT s.id AS snapshot_id, s.planning_id, s.campaign_id, s.revision, s.effective_date::text AS effective_date,
      s.activity_type_snapshot AS activity, p.enabled AS planning_enabled, t.lot_id, t.sub_lot_id, t.beneficiary_crop_id AS crop_id, t.allocation_weight::text AS weight
    FROM economic_snapshots s
    JOIN planning p ON p.id = s.planning_id AND p.company_id = s.company_id
    JOIN economic_snapshot_targets t ON ${a.target.join(' AND ')}
    WHERE ${a.where.join(' AND ')}`, a.params)).rows;
  const byKey = new Map();
  if (!targets.length) return byKey;
  const b = build();
  const lines = (await pool.query(`SELECT l.snapshot_id, l.id AS line_id, l.kind, l.cost_status, l.amount_usd::text AS amount_usd,
      l.product_name_snapshot AS name, l.quantity::text AS quantity, l.unit_snapshot AS unit
    FROM economic_snapshot_lines l
    JOIN economic_snapshots s ON s.id = l.snapshot_id AND s.company_id = l.company_id
    WHERE l.company_id = $1 AND ${b.where.slice(1).join(' AND ')}
      AND EXISTS (SELECT 1 FROM economic_snapshot_targets t WHERE ${b.target.join(' AND ')})`, b.params)).rows;
  const linesOf = new Map();
  for (const line of lines) linesOf.set(line.snapshot_id, [...(linesOf.get(line.snapshot_id) || []), line]);
  for (const t of targets) {
    const weight = money.cost(t.weight);
    if (weight === 0n) continue; // a zero weight receives no cost and is not affected by a pending line
    const key = keyOf(t.lot_id, t.sub_lot_id, t.campaign_id, t.crop_id);
    if (!byKey.has(key)) byKey.set(key, newCost());
    const cost = byKey.get(key);
    const planning = withLines ? { planning_id: t.planning_id, revision: t.revision, effective_date: t.effective_date, activity: t.activity, weight: t.weight, enabled: t.planning_enabled !== false,
      products: 0n, labor: 0n, productKnown: false, laborKnown: false, pending: 0, lines: [] } : null;
    for (const line of linesOf.get(t.snapshot_id) || []) {
      const known = line.amount_usd != null; // NULL is pending, never zero; a confirmed zero is known
      const allocated = known ? money.cost(line.amount_usd) * weight : null;
      if (known) {
        cost.total += allocated; cost.known.add(line.line_id);
        if (line.kind === 'product') { cost.products += allocated; cost.productKnown = true; } else { cost.labor += allocated; cost.laborKnown = true; }
      } else cost.pending.add(line.line_id);
      if (planning) {
        if (known) { planning[line.kind === 'product' ? 'products' : 'labor'] += allocated; planning[line.kind === 'product' ? 'productKnown' : 'laborKnown'] = true; } else planning.pending++;
        planning.lines.push({ kind: line.kind, name: line.kind === 'product' ? line.name : 'Labor', quantity: line.kind === 'product' ? line.quantity : null,
          unit: line.kind === 'product' ? line.unit : null, amount_usd: known ? usd(allocated) : null, pending: !known });
      }
    }
    if (planning) cost.plannings.set(t.snapshot_id, planning);
  }
  return byKey;
}

const mergeCosts = parts => {
  const merged = newCost();
  for (const cost of parts) {
    if (!cost) continue;
    // Totals add (each line x target pair is unique); line sets are unions, so a pending line spread over several
    // sublots is still ONE pending line.
    merged.total += cost.total; merged.products += cost.products; merged.labor += cost.labor;
    merged.productKnown ||= cost.productKnown; merged.laborKnown ||= cost.laborKnown;
    cost.known.forEach(id => merged.known.add(id)); cost.pending.forEach(id => merged.pending.add(id));
  }
  return merged;
};

/** FIN-01B: only `pending` (nothing known) or `partial` (something known). `complete` needs FIN-01C and never appears. */
function costView(cost, surface, production, harvestStatus) {
  const known = !!cost && cost.known.size > 0;
  const view = { status: known ? 'partial' : 'pending', known_total_usd: null, products_usd: null, labor_usd: null,
    pending_lines: cost ? cost.pending.size : 0, per_ha_usd: null, per_tn_usd: null, is_minimum: known, is_provisional: false };
  if (!known) return view;
  view.known_total_usd = usd(cost.total);
  view.products_usd = cost.productKnown ? usd(cost.products) : null;
  view.labor_usd = cost.laborKnown ? usd(cost.labor) : null;
  if (surface != null && surface > 0n) view.per_ha_usd = fmt6(half(cost.total * 100n, surface * 10n ** 18n));
  if (production != null && production > 0n) {
    view.per_tn_usd = fmt6(half(cost.total * 100000n, production * 10n ** 18n));
    view.is_provisional = harvestStatus !== 'closed'; // production may still grow
  }
  return view;
}

// ---- Result computation --------------------------------------------------------------------------------------------
const rowMeta = new WeakMap();

async function compute(pool, { user, query = {}, withDetail = false }) {
  const companyId = user?.company_id;
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) throw fail('No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.');
  if (!pool) throw fail('Base de datos no disponible.', 503);
  // Economic access is decided here, on the server: harvest.view alone never returns an amount.
  const costAccess = economic.allowed(user, economic.readKeys);
  const names = await loadNames(pool, companyId);
  const filters = parseFilters(query, names);
  const [facts, costMap] = await Promise.all([loadFacts(pool, companyId, filters), costAccess ? loadCosts(pool, companyId, filters, withDetail) : new Map()]);
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
  for (const [key, cost] of costMap) ensure(key).cost = cost;

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
      costs: costAccess ? costView(row.cost, row.surface.value, row.production, row.status) : null,
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
    // Known cost only: FIN-01B has no completeness declaration, so no lot is ever "complete" and no average is offered.
    const known = rows.reduce((n, r) => { const c = rowMeta.get(r).cost; return n + (c && c.known.size ? c.total : 0n); }, 0n);
    summary.known_cost_usd = usd(known);
    summary.incomplete_lots = new Set(rows.map(r => r.lot.id)).size;
    summary.lots_without_known_cost = new Set(rows.filter(r => r.costs.status === 'pending').map(r => r.lot.id)).size;
  }
  return { filters, query, rows, summary, costAccess, name };
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
      plannings.push({ planning_id: planning.planning_id, revision: planning.revision, activity: planning.activity, effective_date: planning.effective_date,
        sub_lot: sub, allocation_weight: planning.weight, planning_enabled: planning.enabled,
        products_usd: planning.productKnown ? usd(planning.products) : null, labor_usd: planning.laborKnown ? usd(planning.labor) : null,
        known_usd: known ? usd(planning.products + planning.labor) : null, pending_lines: planning.pending, lines: planning.lines });
    }
  }
  plannings.sort((a, b) => String(b.effective_date).localeCompare(String(a.effective_date)) || String(a.planning_id).localeCompare(String(b.planning_id)));
  result.cost_detail = { plannings, source: 'planning_economic_snapshots',
    note: 'Estos costos corresponden a ejecuciones registradas en GrowSync. Pueden existir otros gastos aún no imputados.' };
  return result;
}

module.exports = { results, detail, classify, cents, decimal2, yieldText, distribute, keyOf, parentKeyOf };

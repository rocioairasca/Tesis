'use strict';
// Economic sources of "Resultados por lote": (1) the latest sealed Planning snapshots (FIN-01B) and (2) the current
// additional cost entries (FIN-01C), plus the explicit completeness declarations. Exact arithmetic only (BigInt).
//  - amount (scale 1e12) x allocation_weight (scale 1e12) = scale 1e24; nothing here uses JS floats for money.
//  - Each fact table is read once and joined in JS by key, never by a SQL product of harvests x lines x targets.
const { createHash } = require('node:crypto');
const money = require('../../shared/costEstimate.cjs');

const keyOf = (lot, sub, campaign, crop) => [lot, sub || '', campaign, crop].join('|');
const campaignIdsOf = f => f.campaign_id ? [f.campaign_id] : f.campaign_ids;
const cropIdsOf = f => f.crop_id ? [f.crop_id] : f.crop_ids;
// Pushes ids as individual parameters (no array params: the production adapter uses postgres.js unsafe()).
function inClause(params, column, ids) {
  if (!ids.length) return 'FALSE';
  return `${column} IN (${ids.map(id => { params.push(id); return `$${params.length}`; }).join(', ')})`;
}
// A deployment may run before the FIN-01C migrations: a missing relation means "no additional evidence", never a 500.
const missingRelation = error => error && (error.code === '42P01' || /does not exist/i.test(String(error.message || '')));
async function optionalQuery(pool, sql, params) {
  try { return (await pool.query(sql, params)).rows; } catch (error) { if (missingRelation(error)) return null; throw error; }
}

const half = (numerator, denominator) => (numerator * 2n + denominator) / (2n * denominator);
const fmt6 = value => `${value / 1000000n}.${String(value % 1000000n).padStart(6, '0')}`;
const usd = scaled24 => fmt6(half(scaled24, 10n ** 18n));

const newCost = () => ({
  total: 0n, products: 0n, labor: 0n, other: 0n, productKnown: false, laborKnown: false, otherKnown: false,
  knownLines: new Set(), pendingLines: new Set(), knownEntries: new Set(), pendingEntries: new Set(),
  categories: new Map(), plannings: new Map(), entries: new Map(), evidence: [], snapshotIds: new Set(),
});
const hasKnown = cost => !!cost && (cost.knownLines.size > 0 || cost.knownEntries.size > 0);
const hasEvidence = cost => !!cost && (hasKnown(cost) || cost.pendingLines.size > 0 || cost.pendingEntries.size > 0);
const hasPending = cost => !!cost && (cost.pendingLines.size > 0 || cost.pendingEntries.size > 0);
/** Fingerprint of the evidence behind ONE key: any new/revised cost or Planning snapshot changes it. */
const fingerprintOf = cost => createHash('sha256').update([...(cost?.evidence || [])].sort().join('\n')).digest('hex');

/** Latest revision of every Planning (snapshots) and every cost entry (current, active). */
async function loadCosts(pool, companyId, filters, withLines) {
  const campaigns = campaignIdsOf(filters), crops = cropIdsOf(filters);
  const build = () => {
    const params = [companyId];
    // planning.enabled is soft-disable/visibility, NOT an economic reversal: a sealed snapshot keeps counting.
    const where = ['s.company_id = $1',
      'NOT EXISTS (SELECT 1 FROM economic_snapshots n WHERE n.company_id = s.company_id AND n.supersedes_id = s.id)'];
    if (campaigns) where.push(inClause(params, 's.campaign_id', campaigns));
    const target = ['t.snapshot_id = s.id', 't.company_id = s.company_id'];
    if (crops) target.push(inClause(params, 't.beneficiary_crop_id', crops));
    if (filters.lot_id) { params.push(filters.lot_id); target.push(`t.lot_id = $${params.length}`); }
    if (filters.sub_lot_id) { params.push(filters.sub_lot_id); target.push(`t.sub_lot_id = $${params.length}`); }
    return { params, where, target };
  };
  const byKey = new Map();
  const costOf = key => { if (!byKey.has(key)) byKey.set(key, newCost()); return byKey.get(key); };

  // ---- Planning snapshots ----
  const a = build();
  const targets = (await pool.query(`SELECT s.id AS snapshot_id, s.planning_id, s.campaign_id, s.revision, s.effective_date::text AS effective_date,
      s.activity_type_snapshot AS activity, p.enabled AS planning_enabled, t.lot_id, t.sub_lot_id, t.beneficiary_crop_id AS crop_id, t.allocation_weight::text AS weight
    FROM economic_snapshots s
    JOIN planning p ON p.id = s.planning_id AND p.company_id = s.company_id
    JOIN economic_snapshot_targets t ON ${a.target.join(' AND ')}
    WHERE ${a.where.join(' AND ')}`, a.params)).rows;
  if (targets.length) {
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
      const cost = costOf(keyOf(t.lot_id, t.sub_lot_id, t.campaign_id, t.crop_id));
      cost.evidence.push(`s:${t.snapshot_id}:${t.weight}`); cost.snapshotIds.add(t.snapshot_id);
      const planning = withLines ? { planning_id: t.planning_id, revision: t.revision, effective_date: t.effective_date, activity: t.activity, weight: t.weight, enabled: t.planning_enabled !== false,
        products: 0n, labor: 0n, productKnown: false, laborKnown: false, pending: 0, lines: [] } : null;
      for (const line of linesOf.get(t.snapshot_id) || []) {
        const known = line.amount_usd != null; // NULL is pending, never zero; a confirmed zero is known
        const allocated = known ? money.cost(line.amount_usd) * weight : null;
        if (known) {
          cost.total += allocated; cost.knownLines.add(line.line_id);
          if (line.kind === 'product') { cost.products += allocated; cost.productKnown = true; } else { cost.labor += allocated; cost.laborKnown = true; }
        } else cost.pendingLines.add(line.line_id);
        if (planning) {
          if (known) { planning[line.kind === 'product' ? 'products' : 'labor'] += allocated; planning[line.kind === 'product' ? 'productKnown' : 'laborKnown'] = true; } else planning.pending++;
          planning.lines.push({ kind: line.kind, name: line.kind === 'product' ? line.name : 'Labor', quantity: line.kind === 'product' ? line.quantity : null,
            unit: line.kind === 'product' ? line.unit : null, amount_usd: known ? usd(allocated) : null, pending: !known });
        }
      }
      if (planning) cost.plannings.set(t.snapshot_id, planning);
    }
  }

  // ---- Additional cost entries (FIN-01C): current revision, active only; one row per (entry, target) ----
  const e = [];
  const ep = [companyId];
  e.push('e.company_id = $1', "e.state = 'active'",
    'NOT EXISTS (SELECT 1 FROM cost_entries n WHERE n.company_id = e.company_id AND n.supersedes_id = e.id)');
  if (campaigns) e.push(inClause(ep, 'e.campaign_id', campaigns));
  const et = ['t.cost_entry_id = e.id', 't.company_id = e.company_id'];
  if (crops) et.push(inClause(ep, 't.beneficiary_crop_id', crops));
  if (filters.lot_id) { ep.push(filters.lot_id); et.push(`t.lot_id = $${ep.length}`); }
  if (filters.sub_lot_id) { ep.push(filters.sub_lot_id); et.push(`t.sub_lot_id = $${ep.length}`); }
  const entryRows = await optionalQuery(pool, `SELECT e.id AS entry_id, e.root_id, e.revision, e.category, e.description, e.reference, e.supplier_name,
      e.expense_date::text AS expense_date, e.currency, e.amount_original::text AS amount_original, e.amount_usd::text AS amount_usd, e.cost_status, e.campaign_id,
      t.lot_id, t.sub_lot_id, t.beneficiary_crop_id AS crop_id, t.allocation_weight::text AS weight, t.allocation_method AS method
    FROM cost_entries e JOIN cost_entry_targets t ON ${et.join(' AND ')}
    WHERE ${e.join(' AND ')}`, ep);
  const additionalAvailable = entryRows !== null;
  for (const row of entryRows || []) {
    const weight = money.cost(row.weight);
    if (weight === 0n) continue;
    const cost = costOf(keyOf(row.lot_id, row.sub_lot_id, row.campaign_id, row.crop_id));
    cost.evidence.push(`e:${row.entry_id}:${row.weight}`);
    const known = row.amount_usd != null;                       // pending ARS without FX evidence: NULL, never zero
    const allocated = known ? money.cost(row.amount_usd) * weight : null;
    if (!cost.categories.has(row.category)) cost.categories.set(row.category, { total: 0n, known: false, pending: 0 });
    const category = cost.categories.get(row.category);
    if (known) { cost.total += allocated; cost.other += allocated; cost.otherKnown = true; cost.knownEntries.add(row.entry_id); category.total += allocated; category.known = true; }
    else { cost.pendingEntries.add(row.entry_id); category.pending++; }
    if (withLines) cost.entries.set(`${row.entry_id}|${row.lot_id}|${row.sub_lot_id || ''}`, { entry_id: row.entry_id, root_id: row.root_id, revision: row.revision, category: row.category,
      description: row.description, reference: row.reference, supplier_name: row.supplier_name, expense_date: row.expense_date, currency: row.currency, amount_original: row.amount_original,
      amount_usd: known ? usd(allocated) : null, cost_status: row.cost_status, weight: row.weight, method: row.method, pending: !known });
  }
  return { byKey, additionalAvailable };
}

/** Current declaration per key (highest revision). Returns null when the table does not exist yet. */
async function loadDeclarations(pool, companyId, filters) {
  const campaigns = campaignIdsOf(filters), crops = cropIdsOf(filters);
  const params = [companyId], where = ['d.company_id = $1',
    'NOT EXISTS (SELECT 1 FROM economic_completeness_declarations n WHERE n.supersedes_id = d.id)'];
  if (campaigns) where.push(inClause(params, 'd.campaign_id', campaigns));
  if (crops) where.push(inClause(params, 'd.crop_id', crops));
  if (filters.lot_id) { params.push(filters.lot_id); where.push(`d.lot_id = $${params.length}`); }
  const rows = await optionalQuery(pool, `SELECT d.id, d.lot_id, d.sub_lot_id, d.campaign_id, d.crop_id, d.state, d.revision, d.reason, d.observation, d.auto_invalidated,
      d.evidence_fingerprint, d.known_total_usd::text AS known_total_usd, d.declared_by, d.declared_at::text AS declared_at
    FROM economic_completeness_declarations d WHERE ${where.join(' AND ')}`, params);
  return new Map((rows || []).map(row => [keyOf(row.lot_id, row.sub_lot_id, row.campaign_id, row.crop_id), row]));
}

/** A declaration is valid only while it says complete AND its fingerprint still matches the current evidence. */
const declarationValid = (declaration, cost) => !!declaration && declaration.state === 'complete' && !!cost && declaration.evidence_fingerprint === fingerprintOf(cost);

const mergeCosts = parts => {
  const merged = newCost();
  for (const cost of parts) {
    if (!cost) continue;
    // Totals add (each line x target pair is unique); id sets are unions, so one pending line spread over sublots is ONE pending line.
    merged.total += cost.total; merged.products += cost.products; merged.labor += cost.labor; merged.other += cost.other;
    merged.productKnown ||= cost.productKnown; merged.laborKnown ||= cost.laborKnown; merged.otherKnown ||= cost.otherKnown;
    for (const name of ['knownLines', 'pendingLines', 'knownEntries', 'pendingEntries']) cost[name].forEach(id => merged[name].add(id));
    for (const [category, data] of cost.categories) {
      const into = merged.categories.get(category) || { total: 0n, known: false, pending: 0 };
      into.total += data.total; into.known ||= data.known; into.pending += data.pending; merged.categories.set(category, into);
    }
  }
  return merged;
};

/**
 * Row-level completeness (D2 + literal keys): `complete` only when something is known, nothing is pending and EVERY part with
 * economic evidence (own lot-level key and each sublot) has a valid `complete` declaration. A part without any evidence is not
 * "relevant"; the moment evidence appears in it, the row stops being complete.
 */
function rowComplete(parts, declarations) {
  const relevant = parts.filter(part => hasEvidence(part.cost));
  if (!relevant.length) return false;
  if (!relevant.some(part => hasKnown(part.cost))) return false;
  return relevant.every(part => !hasPending(part.cost) && declarationValid(declarations.get(part.entry.key), part.cost));
}

/** `pending` (nothing known) | `partial` (something known, not declared/valid) | `complete` (declared, reviewed, nothing pending). */
function costView(cost, surface, production, harvestStatus, complete) {
  const known = hasKnown(cost);
  const status = !known ? 'pending' : complete ? 'complete' : 'partial';
  const view = { status, known_total_usd: null, products_usd: null, labor_usd: null, other_usd: null,
    pending_lines: cost ? cost.pendingLines.size : 0, pending_entries: cost ? cost.pendingEntries.size : 0,
    per_ha_usd: null, per_tn_usd: null, is_minimum: known && !complete, is_provisional: false };
  if (!known) return view;
  view.known_total_usd = usd(cost.total);
  view.products_usd = cost.productKnown ? usd(cost.products) : null;
  view.labor_usd = cost.laborKnown ? usd(cost.labor) : null;
  view.other_usd = cost.otherKnown ? usd(cost.other) : null;
  if (surface != null && surface > 0n) view.per_ha_usd = fmt6(half(cost.total * 100n, surface * 10n ** 18n));
  if (production != null && production > 0n) {
    view.per_tn_usd = fmt6(half(cost.total * 100000n, production * 10n ** 18n));
    view.is_provisional = harvestStatus !== 'closed'; // production may still grow, even with complete costs
  }
  return view;
}

module.exports = { keyOf, inClause, campaignIdsOf, cropIdsOf, usd, fmt6, half, newCost, hasKnown, hasEvidence, hasPending, fingerprintOf,
  loadCosts, loadDeclarations, declarationValid, mergeCosts, rowComplete, costView, missingRelation };

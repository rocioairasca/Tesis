'use strict';
// FIN-01C: additional costs outside Planning (seed, contractors, fuel, rent, freight, drying, other).
// Append-only: a change is a new revision (supersedes_id) or an explicit `void`; nothing is updated or deleted.
// Costs never come from economic_snapshots (no double counting) and never touch Planning.
const { z } = require('zod');
const { randomUUID } = require('node:crypto');
const money = require('../../shared/costEstimate.cjs');
const stock = require('./stock');
const economic = require('./economicExecution');
const completeness = require('./economicCompleteness');
const { inClause } = require('./harvestCostSources');

const CATEGORIES = ['seed', 'contractor', 'labor', 'fuel_machinery', 'rent', 'freight', 'drying', 'other'];
const uuid = z.string().uuid();
const decimal = z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Importe inválido: hasta 6 decimales.');
const percent = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'Porcentaje inválido.');
const day = z.string().refine(v => { try { stock.calendarDate(v); return true; } catch { return false; } }, 'Fecha inválida.');
const text = max => z.string().trim().max(max);
const destination = z.object({
  scope: z.enum(['lots', 'campaign']), crop_id: uuid,
  method: z.enum(['area_proportional', 'manual_percent']).default('area_proportional'),
  targets: z.array(z.object({ lot_id: uuid, sub_lot_id: uuid.nullable().optional(), percent: percent.optional() }).strict()).max(200).optional(),
}).strict();
const body = {
  campaign_id: uuid, category: z.enum(CATEGORIES), description: text(500).min(1), expense_date: day,
  currency: z.enum(['USD', 'ARS']), amount: decimal,
  payment_date: day.nullable().optional(), fx_rate: decimal.nullable().optional(), fx_date: day.nullable().optional(), fx_source: text(500).nullable().optional(),
  supplier_name: text(500).nullable().optional(), reference: text(500).nullable().optional(), notes: text(2000).nullable().optional(),
  destination,
};
const createSchema = z.object(body).strict();
const reviseSchema = z.union([
  z.object({ ...body, supersedes_id: uuid, reason: text(2000).min(1) }).strict(),
  z.object({ state: z.literal('void'), supersedes_id: uuid, reason: text(2000).min(1) }).strict(),
]);
const parse = (s, v) => { try { return s.parse(v); } catch (e) { e.status = 400; throw e; } };

function authorize(user, edit) {
  if (!economic.allowed(user, edit ? economic.editKeys : economic.readKeys))
    throw stock.fail(edit ? 'Registrar gastos requiere edición de Planificaciones e Inventario.' : 'No tenés permisos para consultar costos reales.', 403);
  parse(uuid, user?.company_id); parse(uuid, user?.id);
}
const publicEntry = ({ request_hash, idempotency_key, created_txid, ...row }) => row;
const dateText = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

/** Currency/FX semantics identical to Planning labor: USD confirms; ARS confirms only with payment date, FX of that date and source. */
function amounts(d) {
  const original = money.input(d.amount);
  if (d.currency === 'USD') {
    if (['payment_date', 'fx_rate', 'fx_date', 'fx_source'].some(k => d[k] != null)) throw stock.fail('Un gasto en USD no utiliza cotización.', 400);
    return { cost_status: 'confirmed', amount_usd: money.costText(original * money.QUANTITY_SCALE), fx_type: null };
  }
  if (d.fx_rate != null && money.input(d.fx_rate) <= 0n) throw stock.fail('La cotización debe ser positiva.', 400);
  const fx = d.fx_rate == null ? 0n : money.input(d.fx_rate);
  const ready = d.payment_date && d.fx_date && d.fx_date === d.payment_date && d.fx_source?.trim() && fx > 0n;
  if (d.fx_date && d.payment_date && d.fx_date !== d.payment_date) throw stock.fail('La cotización debe corresponder a la fecha de pago.', 400);
  if (!ready) return { cost_status: 'pending', amount_usd: null, fx_type: null, nofx: true };
  // One rounding at storage scale 12: original/fx (both scale 1e6) -> usd with 12 decimals, half-up.
  const usd = (original * money.COST_SCALE * 2n + fx) / (2n * fx);
  return { cost_status: 'confirmed', amount_usd: money.costText(usd), fx_type: 'divisa_mayorista' };
}

async function referenceAreas(client, companyId, campaignId, cropId, targets) {
  const out = [];
  for (const t of targets) {
    const params = [companyId, campaignId, cropId, t.lot_id], where = ['company_id=$1', 'campaign_id=$2', 'crop_id=$3', 'lot_id=$4'];
    if (t.sub_lot_id) { params.push(t.sub_lot_id); where.push(`sub_lot_id=$${params.length}`); } else where.push('sub_lot_id IS NULL');
    let area = (await client.query(`SELECT COALESCE(SUM(area_ha),0)::text AS area FROM crop_assignments WHERE ${where.join(' AND ')}`, params)).rows[0].area;
    const lot = (await client.query('SELECT name, COALESCE(area_ha, area)::text AS area FROM lots WHERE id=$1 AND company_id=$2', [t.lot_id, companyId])).rows[0];
    if (!lot) throw stock.fail('Lote no encontrado.', 404);
    let sub = null;
    if (t.sub_lot_id) {
      sub = (await client.query('SELECT name, area_ha::text AS area FROM sub_lots WHERE id=$1 AND lot_id=$2 AND company_id=$3', [t.sub_lot_id, t.lot_id, companyId])).rows[0];
      if (!sub) throw stock.fail('Sublote no encontrado.', 404);
    }
    if (!(money.input(String(area)) > 0n)) area = sub ? sub.area : lot.area;     // no productive cycle: structural area
    if (area == null || !(money.input(String(area)) > 0n)) throw stock.fail('El destino no tiene una superficie válida.', 400);
    out.push({ ...t, sub_lot_id: t.sub_lot_id ?? null, area: String(area), lot_name: lot.name, sub_name: sub ? sub.name : null });
  }
  return out;
}

async function resolveTargets(client, companyId, d) {
  const dest = d.destination;
  const crop = (await client.query('SELECT name FROM crops WHERE id=$1 AND company_id=$2', [dest.crop_id, companyId])).rows[0];
  if (!crop) throw stock.fail('Cultivo no encontrado.', 404);
  if (!(await client.query('SELECT 1 FROM campaigns WHERE id=$1 AND company_id=$2', [d.campaign_id, companyId])).rows.length) throw stock.fail('Campaña no encontrada.', 404);
  let targets;
  if (dest.scope === 'campaign') {
    // Expanded NOW into explicit targets: lots/cycles created later never receive a share of this cost.
    const rows = (await client.query(`SELECT lot_id, sub_lot_id FROM crop_assignments WHERE company_id=$1 AND campaign_id=$2 AND crop_id=$3 GROUP BY lot_id, sub_lot_id ORDER BY lot_id, sub_lot_id NULLS FIRST`,
      [companyId, d.campaign_id, dest.crop_id])).rows;
    if (!rows.length) throw stock.fail('La campaña no tiene destinos actuales para este cultivo.');
    targets = rows.map(r => ({ lot_id: r.lot_id, sub_lot_id: r.sub_lot_id }));
    if (dest.method === 'manual_percent') throw stock.fail('Toda la campaña se distribuye por superficie.', 400);
  } else {
    if (!dest.targets?.length) throw stock.fail('Indicá al menos un lote o sublote de destino.', 400);
    targets = dest.targets.map(t => ({ lot_id: t.lot_id, sub_lot_id: t.sub_lot_id ?? null, percent: t.percent }));
    if (new Set(targets.map(t => `${t.lot_id}|${t.sub_lot_id || ''}`)).size !== targets.length) throw stock.fail('Hay destinos repetidos.', 400);
  }
  const resolved = await referenceAreas(client, companyId, d.campaign_id, dest.crop_id, targets);
  let weights;
  if (dest.method === 'area_proportional') weights = economic.weights(resolved.map(t => t.area));
  else {
    if (resolved.some(t => t.percent == null)) throw stock.fail('Indicá el porcentaje de cada destino.', 400);
    const p = resolved.map(t => { const [w, f = ''] = t.percent.split('.'); return BigInt(w) * 10000n + BigInt(f.padEnd(4, '0')); });   // percent x 10^4
    if (p.reduce((n, v) => n + v, 0n) !== 1000000n) throw stock.fail('Los porcentajes deben sumar exactamente 100.', 400);
    weights = p.map(v => money.costText(v * 1000000n));                              // 100.0000 % = 1000000 -> 1.000000000000
  }
  return resolved.map((t, i) => ({ ...t, crop_id: dest.crop_id, crop_name: crop.name, weight: weights[i], method: dest.method }));
}

async function insertEntry(client, row) {
  const keys = Object.keys(row);
  return (await client.query(`INSERT INTO cost_entries(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, keys.map(k => row[k]))).rows[0];
}
async function insertTargets(client, companyId, entryId, targets) {
  for (const t of targets)
    await client.query(`INSERT INTO cost_entry_targets(company_id,cost_entry_id,lot_id,sub_lot_id,beneficiary_crop_id,lot_name_snapshot,sub_lot_name_snapshot,crop_name_snapshot,reference_area_ha,allocation_method,allocation_weight)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [companyId, entryId, t.lot_id, t.sub_lot_id, t.crop_id, t.lot_name, t.sub_name, t.crop_name, t.area, t.method, t.weight]);
}
async function targetsOf(client, companyId, ids) {
  if (!ids.length) return new Map();
  const params = [companyId];
  const rows = (await client.query(`SELECT cost_entry_id, lot_id, sub_lot_id, beneficiary_crop_id AS crop_id, lot_name_snapshot AS lot_name, sub_lot_name_snapshot AS sub_lot_name,
      crop_name_snapshot AS crop_name, reference_area_ha::text AS reference_area_ha, allocation_method, allocation_weight::text AS allocation_weight
    FROM cost_entry_targets WHERE company_id=$1 AND ${inClause(params, 'cost_entry_id', ids)} ORDER BY lot_id, sub_lot_id NULLS FIRST`, params)).rows;
  const map = new Map();
  for (const r of rows) map.set(r.cost_entry_id, [...(map.get(r.cost_entry_id) || []), r]);
  return map;
}
const present = (entry, targets, isCurrent) => ({ ...publicEntry(entry), expense_date: dateText(entry.expense_date), payment_date: dateText(entry.payment_date), fx_date: dateText(entry.fx_date),
  is_current: isCurrent, targets: targets || [] });
const keysOf = (campaignId, targets) => targets.map(t => ({ campaign_id: campaignId, lot_id: t.lot_id, sub_lot_id: t.sub_lot_id ?? null, crop_id: t.crop_id ?? t.beneficiary_crop_id }));

function entryRow(user, d, id, extra) {
  const a = amounts(d);
  return { id, company_id: user.company_id, campaign_id: d.campaign_id, category: d.category, description: d.description, expense_date: d.expense_date, currency: d.currency,
    amount_original: stock.amount(money.input(d.amount)),
    amount_usd: a.amount_usd, cost_status: a.cost_status, payment_date: d.payment_date ?? null, fx_rate: d.fx_rate ?? null,
    fx_date: d.fx_date ?? null, fx_type: a.fx_type, fx_source: d.fx_source?.trim() || null, supplier_name: d.supplier_name || null, reference: d.reference || null, notes: d.notes || null,
    created_by: user.id, ...extra };
}

async function create(pool, { user, key, body: input }) {
  authorize(user, true);
  if (typeof key !== 'string' || !key.trim() || key.length > 200) throw stock.fail('Idempotency-Key obligatorio.', 400);
  const d = parse(createSchema, input || {}), hash = stock.fingerprint({ actor: user.id, kind: 'create', d });
  amounts(d);
  return stock.transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['cost_entry_key:' + user.company_id + ':' + key]);
    const replay = (await client.query('SELECT * FROM cost_entries WHERE company_id=$1 AND idempotency_key=$2', [user.company_id, key])).rows[0];
    if (replay) {
      if (replay.request_hash !== hash) throw stock.fail('La clave corresponde a otro gasto.');
      return { data: present(replay, (await targetsOf(client, user.company_id, [replay.id])).get(replay.id), true), replayed: true };
    }
    const targets = await resolveTargets(client, user.company_id, d), id = randomUUID();
    const entry = await insertEntry(client, entryRow(user, d, id, { root_id: id, revision: 1, state: 'active', idempotency_key: key, request_hash: hash }));
    await insertTargets(client, user.company_id, id, targets);
    await completeness.invalidate(client, { companyId: user.company_id, actorId: user.id, keys: keysOf(d.campaign_id, targets), cause: id });
    return { data: present(entry, await targetsOf(client, user.company_id, [id]).then(m => m.get(id)), true), replayed: false };
  });
}

async function revise(pool, { user, id, key, body: input }) {
  authorize(user, true); parse(uuid, id);
  if (typeof key !== 'string' || !key.trim() || key.length > 200) throw stock.fail('Idempotency-Key obligatorio.', 400);
  const d = parse(reviseSchema, input || {}), hash = stock.fingerprint({ actor: user.id, kind: 'revise', id, d });
  if (d.state !== 'void') amounts(d);
  return stock.transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['cost_entry_key:' + user.company_id + ':' + key]);
    const replay = (await client.query('SELECT * FROM cost_entries WHERE company_id=$1 AND idempotency_key=$2', [user.company_id, key])).rows[0];
    if (replay) {
      if (replay.request_hash !== hash) throw stock.fail('La clave corresponde a otra revisión.');
      return { data: present(replay, (await targetsOf(client, user.company_id, [replay.id])).get(replay.id), true), replayed: true };
    }
    const base = (await client.query('SELECT * FROM cost_entries WHERE company_id=$1 AND id=$2', [user.company_id, id])).rows[0];
    if (!base) throw stock.fail('Gasto no encontrado.', 404);
    const prev = (await client.query('SELECT * FROM cost_entries WHERE company_id=$1 AND root_id=$2 ORDER BY revision DESC LIMIT 1', [user.company_id, base.root_id])).rows[0];
    if (prev.id !== d.supersedes_id || prev.id !== id) throw stock.fail('El gasto cambió. Actualizá el detalle antes de continuar.');
    if (prev.state === 'void') throw stock.fail('El gasto está anulado y no admite revisiones.');
    const oldTargets = (await targetsOf(client, user.company_id, [prev.id])).get(prev.id) || [];
    const newId = randomUUID(), meta = { id: newId, root_id: prev.root_id, revision: prev.revision + 1, supersedes_id: prev.id, reason: d.reason, idempotency_key: key, request_hash: hash };
    let entry, targets = [];
    if (d.state === 'void') {
      const { id: _i, root_id, revision, supersedes_id, reason, created_at, created_txid, idempotency_key, request_hash, ...copy } = prev;
      entry = await insertEntry(client, { ...copy, ...meta, state: 'void' });
    } else {
      if (d.campaign_id !== prev.campaign_id) throw stock.fail('Un gasto no puede cambiar de campaña: anulalo y registrá uno nuevo.', 400);
      targets = await resolveTargets(client, user.company_id, d);
      entry = await insertEntry(client, entryRow(user, d, newId, { ...meta, state: 'active' }));
      await insertTargets(client, user.company_id, newId, targets);
    }
    const keys = [...keysOf(prev.campaign_id, oldTargets), ...keysOf(prev.campaign_id, targets)];
    await completeness.invalidate(client, { companyId: user.company_id, actorId: user.id, keys, cause: newId });
    return { data: present(entry, await targetsOf(client, user.company_id, [newId]).then(m => m.get(newId)), true), replayed: false };
  });
}

async function get(pool, { user, id }) {
  authorize(user, false); parse(uuid, id);
  const entry = (await pool.query('SELECT * FROM cost_entries WHERE company_id=$1 AND id=$2', [user.company_id, id])).rows[0];
  if (!entry) throw stock.fail('Gasto no encontrado.', 404);
  const next = (await pool.query('SELECT 1 FROM cost_entries WHERE company_id=$1 AND supersedes_id=$2', [user.company_id, id])).rows.length;
  const history = (await pool.query('SELECT id, revision, state, reason, created_at FROM cost_entries WHERE company_id=$1 AND root_id=$2 ORDER BY revision', [user.company_id, entry.root_id])).rows;
  return { data: { ...present(entry, (await targetsOf(pool, user.company_id, [id])).get(id), !next), history } };
}

const listSchema = z.object({ campaign_id: uuid.optional(), lot_id: uuid.optional(), sub_lot_id: uuid.optional(), crop_id: uuid.optional(),
  category: z.enum(CATEGORIES).optional(), status: z.enum(['confirmed', 'pending']).optional(), include_void: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }).strict();

async function list(pool, { user, query = {} }) {
  authorize(user, false);
  const q = parse(listSchema, Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== '')));
  const page = q.page || 1, pageSize = q.pageSize || 25, params = [user.company_id];
  const where = ['e.company_id=$1', 'NOT EXISTS (SELECT 1 FROM cost_entries n WHERE n.company_id=e.company_id AND n.supersedes_id=e.id)'];
  if (q.include_void !== 'true') where.push("e.state='active'");
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', '$' + params.length)); };
  if (q.campaign_id) add('e.campaign_id=?', q.campaign_id);
  if (q.category) add('e.category=?', q.category);
  if (q.status) add('e.cost_status=?', q.status);
  const t = [];
  for (const [col, v] of [['lot_id', q.lot_id], ['sub_lot_id', q.sub_lot_id], ['beneficiary_crop_id', q.crop_id]]) if (v) { params.push(v); t.push(`t.${col}=$${params.length}`); }
  if (t.length) where.push(`EXISTS (SELECT 1 FROM cost_entry_targets t WHERE t.company_id=e.company_id AND t.cost_entry_id=e.id AND ${t.join(' AND ')})`);
  const total = Number((await pool.query(`SELECT count(*)::int AS n FROM cost_entries e WHERE ${where.join(' AND ')}`, params)).rows[0].n);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = (await pool.query(`SELECT e.* FROM cost_entries e WHERE ${where.join(' AND ')} ORDER BY e.expense_date DESC, e.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  const map = await targetsOf(pool, user.company_id, rows.map(r => r.id));
  return { data: rows.map(r => present(r, map.get(r.id), true)), pagination: { page, pageSize, total } };
}

module.exports = { create, revise, get, list, CATEGORIES, amounts };

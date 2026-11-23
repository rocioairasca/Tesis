'use strict';
// FIN-01C: explicit, auditable "gastos completos" declarations per lot/sublot + campaign + crop (append-only revisions).
// A declaration is a human statement about a given body of evidence; it is stored with the fingerprint of that evidence and
// stops counting the moment a cost is added/revised (transactional invalidation below + fingerprint check when reading).
const { z } = require('zod');
const { randomUUID } = require('node:crypto');
const stock = require('./stock');
const economic = require('./economicExecution');
const sources = require('./harvestCostSources');
const { keyOf, hasKnown, hasPending, hasEvidence, fingerprintOf, loadCosts, declarationValid, usd, missingRelation } = sources;

const uuid = z.string().uuid();
const schema = z.object({
  action: z.enum(['complete', 'reopen']),
  campaign_id: uuid, crop_id: uuid, lot_id: uuid, sub_lot_id: uuid.nullable().optional(),
  include_children: z.boolean().optional(),
  observation: z.string().trim().max(2000).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
}).strict();
const querySchema = z.object({ campaign_id: uuid, crop_id: uuid.optional(), lot_id: uuid.optional() }).strict();
const parse = (s, v) => { try { return s.parse(v); } catch (e) { e.status = 400; throw e; } };

function authorize(user, edit) {
  if (!economic.allowed(user, edit ? economic.editKeys : economic.readKeys))
    throw stock.fail(edit ? 'Declarar gastos completos requiere edición de Planificaciones e Inventario.' : 'No tenés permisos para consultar costos reales.', 403);
  parse(uuid, user?.company_id); parse(uuid, user?.id);
}
const publicRow = ({ request_hash, idempotency_key, created_txid, evidence_fingerprint, ...row }) => row;
const latest = async (client, k) => (await client.query(
  `SELECT * FROM economic_completeness_declarations WHERE company_id=$1 AND campaign_id=$2 AND lot_id=$3 AND sub_lot_id IS NOT DISTINCT FROM $4 AND crop_id=$5 ORDER BY revision DESC LIMIT 1`,
  [k.company_id, k.campaign_id, k.lot_id, k.sub_lot_id ?? null, k.crop_id])).rows[0] || null;

async function insertDeclaration(client, k, data) {
  const prev = await latest(client, k);
  const row = { id: randomUUID(), company_id: k.company_id, campaign_id: k.campaign_id, lot_id: k.lot_id, sub_lot_id: k.sub_lot_id ?? null, crop_id: k.crop_id,
    state: data.state, revision: prev ? prev.revision + 1 : 1, supersedes_id: prev ? prev.id : null, reason: data.reason ?? null, observation: data.observation ?? null,
    auto_invalidated: !!data.auto, evidence_fingerprint: data.fingerprint ?? null, known_total_usd: data.total ?? null, planning_snapshots: data.snapshots ?? null,
    cost_entries: data.entries ?? null, declared_by: data.actor, idempotency_key: data.key, request_hash: data.hash };
  const keys = Object.keys(row);
  return (await client.query(`INSERT INTO economic_completeness_declarations(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, keys.map(c => row[c]))).rows[0];
}

/**
 * Called INSIDE the transaction of a cost create/revise: every affected key whose current declaration is `complete` gets a new
 * `open` revision (auto_invalidated). Nothing is deleted; the previous declaration stays in the history.
 */
async function invalidate(client, { companyId, actorId, keys, cause }) {
  const exists = (await client.query("SELECT to_regclass('economic_completeness_declarations') AS t")).rows[0].t;
  if (!exists) return [];
  const seen = new Set(), done = [];
  for (const k of keys) {
    const id = keyOf(k.lot_id, k.sub_lot_id, k.campaign_id, k.crop_id);
    if (seen.has(id)) continue; seen.add(id);
    const prev = await latest(client, { company_id: companyId, ...k });
    if (!prev || prev.state !== 'complete') continue;
    done.push(await insertDeclaration(client, { company_id: companyId, ...k }, { state: 'open', auto: true, actor: actorId,
      reason: 'Se registró o modificó un gasto después de la declaración de gastos completos.', key: `auto:${cause}:${id}`,
      hash: stock.fingerprint({ auto: true, cause, id }) }));
  }
  return done;
}

async function current(pool, { user, query = {} }) {
  authorize(user, false);
  const q = parse(querySchema, { campaign_id: query.campaign_id, ...(query.crop_id ? { crop_id: query.crop_id } : {}), ...(query.lot_id ? { lot_id: query.lot_id } : {}) });
  const params = [user.company_id, q.campaign_id], where = ['d.company_id=$1', 'd.campaign_id=$2', 'NOT EXISTS (SELECT 1 FROM economic_completeness_declarations n WHERE n.supersedes_id=d.id)'];
  for (const col of ['crop_id', 'lot_id']) if (q[col]) { params.push(q[col]); where.push(`d.${col}=$${params.length}`); }
  let rows;
  try { rows = (await pool.query(`SELECT d.* FROM economic_completeness_declarations d WHERE ${where.join(' AND ')} ORDER BY d.lot_id, d.sub_lot_id NULLS FIRST`, params)).rows; }
  catch (e) { if (missingRelation(e)) return { data: [] }; throw e; }
  // `state` is the EFFECTIVE state (a `complete` whose evidence changed is `open`); `declared_state` is what was stored, `stale` flags the difference.
  const { byKey } = await loadCosts(pool, user.company_id, { campaign_id: q.campaign_id, ...(q.crop_id ? { crop_id: q.crop_id } : {}), ...(q.lot_id ? { lot_id: q.lot_id } : {}) }, false);
  return { data: rows.map(row => {
    const cost = byKey.get(keyOf(row.lot_id, row.sub_lot_id, row.campaign_id, row.crop_id));
    const valid = declarationValid(row, cost);
    return { ...publicRow(row), declared_state: row.state, state: valid ? 'complete' : 'open', stale: row.state === 'complete' && !valid };
  }) };
}

async function declare(pool, { user, key, body }) {
  authorize(user, true);
  if (typeof key !== 'string' || !key.trim() || key.length > 200) throw stock.fail('Idempotency-Key obligatorio.', 400);
  const data = parse(schema, body || {});
  const hash = stock.fingerprint({ actor: user.id, data });
  if (data.action === 'reopen' && !data.reason?.trim()) throw stock.fail('Indicá el motivo para reabrir los gastos.', 400);
  return stock.transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['completeness:' + user.company_id + ':' + key]);
    const replay = (await client.query('SELECT * FROM economic_completeness_declarations WHERE company_id=$1 AND idempotency_key=$2 ORDER BY lot_id', [user.company_id, key])).rows;
    if (replay.length) {
      if (replay.some(r => r.request_hash !== hash)) throw stock.fail('La clave corresponde a otra declaración.');
      return { data: replay.map(publicRow), replayed: true };
    }
    // Context is validated against the tenant (the key's lot/campaign/crop must belong to the company).
    for (const [table, id] of [['campaigns', data.campaign_id], ['crops', data.crop_id], ['lots', data.lot_id]])
      if (!(await client.query(`SELECT 1 FROM ${table} WHERE id=$1 AND company_id=$2`, [id, user.company_id])).rows.length) throw stock.fail('Destino no encontrado.', 404);
    if (data.sub_lot_id && !(await client.query('SELECT 1 FROM sub_lots WHERE id=$1 AND lot_id=$2 AND company_id=$3', [data.sub_lot_id, data.lot_id, user.company_id])).rows.length)
      throw stock.fail('Sublote no encontrado.', 404);
    const { byKey } = await loadCosts(client, user.company_id, { campaign_id: data.campaign_id, crop_id: data.crop_id, lot_id: data.lot_id }, false);
    const keys = [{ campaign_id: data.campaign_id, lot_id: data.lot_id, sub_lot_id: data.sub_lot_id ?? null, crop_id: data.crop_id }];
    if (!data.sub_lot_id && data.include_children) {
      for (const id of byKey.keys()) {
        const [lot, sub] = id.split('|');
        if (lot === data.lot_id && sub) keys.push({ campaign_id: data.campaign_id, lot_id: lot, sub_lot_id: sub, crop_id: data.crop_id });
      }
    }
    const written = [];
    if (data.action === 'complete') {
      const targets = keys.map(k => ({ k, cost: byKey.get(keyOf(k.lot_id, k.sub_lot_id, k.campaign_id, k.crop_id)) })).filter(t => hasEvidence(t.cost));
      if (!targets.length || !targets.some(t => hasKnown(t.cost))) throw stock.fail('No hay gastos conocidos para declarar como completos.');
      if (targets.some(t => hasPending(t.cost))) throw stock.fail('Hay gastos o líneas pendientes: resolvelos antes de marcar los gastos como completos.');
      for (const t of targets) {
        written.push(await insertDeclaration(client, { company_id: user.company_id, ...t.k }, { state: 'complete', actor: user.id, observation: data.observation, reason: data.reason,
          fingerprint: fingerprintOf(t.cost), total: usd(t.cost.total), snapshots: t.cost.snapshotIds.size, entries: t.cost.knownEntries.size, key, hash }));
      }
    } else {
      for (const k of keys) {
        const prev = await latest(client, { company_id: user.company_id, ...k });
        if (!prev || prev.state !== 'complete') continue;
        written.push(await insertDeclaration(client, { company_id: user.company_id, ...k }, { state: 'open', actor: user.id, reason: data.reason, observation: data.observation, key, hash }));
      }
      if (!written.length) throw stock.fail('No hay una declaración de gastos completos para reabrir.');
    }
    return { data: written.map(publicRow), replayed: false };
  });
}

module.exports = { current, declare, invalidate, latest };

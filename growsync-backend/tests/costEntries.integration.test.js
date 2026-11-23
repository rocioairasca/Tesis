// FIN-01C: additional cost entries + explicit completeness declarations inside "Resultados por lote".
// Isolated PGlite with synthetic data. The two FIN-01C migrations are applied for real (constraints, triggers, RLS).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.HARVEST_TEST_PGLITE || '@electric-sql/pglite');
const results = require('../services/harvestResults');
const costs = require('../services/costEntries');
const completeness = require('../services/economicCompleteness');

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = uid(1), B = uid(2), CAMPAIGN = uid(100), SOY = uid(101), CORN = uid(102);
const LOT = n => uid(200 + n), SUB = n => uid(300 + n), CYCLE = n => uid(400 + n), REC = n => uid(500 + n);
const mk = (id, perms, company = A) => ({ company_id: company, id: uid(id), role: 0, enabled: true, custom_permissions: perms });
const editor = mk(10, ['harvest.view', 'planning.view', 'inventory.view', 'planning.edit', 'inventory.edit']);
const reader = mk(11, ['harvest.view', 'planning.view', 'inventory.view']);
const harvestOnly = mk(12, ['harvest.view']);
const foreign = mk(13, ['harvest.view', 'planning.view', 'inventory.view', 'planning.edit', 'inventory.edit'], B);
let seq = 0;
const key = () => `k-${++seq}`;

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE companies(id uuid PRIMARY KEY);
    CREATE TABLE users(id uuid PRIMARY KEY, company_id uuid, enabled boolean DEFAULT true, full_name text, name text, email text);
    CREATE TABLE campaigns(id uuid PRIMARY KEY, company_id uuid, name text);
    CREATE TABLE crops(id uuid PRIMARY KEY, company_id uuid, name text);
    CREATE TABLE lots(id uuid PRIMARY KEY, company_id uuid, name text, area_ha numeric, area numeric);
    CREATE TABLE sub_lots(id uuid PRIMARY KEY, company_id uuid, lot_id uuid, name text, area_ha numeric);
    CREATE TABLE crop_assignments(id uuid PRIMARY KEY, company_id uuid, campaign_id uuid, lot_id uuid, sub_lot_id uuid, crop_id uuid, area_ha numeric(12,2), end_date date);
    CREATE TABLE harvest_records(id uuid PRIMARY KEY, company_id uuid, lot_id uuid, sub_lot_id uuid, crop_id uuid, campaign_id uuid,
      production_kg numeric(14,2), harvested_area_ha numeric(10,2), enabled boolean NOT NULL DEFAULT true);
    CREATE TABLE harvest_crop_assignments(harvest_id uuid, crop_assignment_id uuid, harvested_area_ha numeric(12,2));
    CREATE TABLE planning(id uuid PRIMARY KEY, company_id uuid, enabled boolean DEFAULT true);
    CREATE TABLE economic_snapshots(id uuid PRIMARY KEY, company_id uuid, planning_id uuid, revision integer, supersedes_id uuid UNIQUE, campaign_id uuid,
      effective_date date, activity_type_snapshot text);
    CREATE TABLE economic_snapshot_lines(id uuid PRIMARY KEY, company_id uuid, snapshot_id uuid, kind text, cost_status text, amount_usd numeric(40,12),
      product_name_snapshot text, quantity numeric(20,6), unit_snapshot text);
    CREATE TABLE economic_snapshot_targets(id uuid PRIMARY KEY, company_id uuid, snapshot_id uuid, lot_id uuid, sub_lot_id uuid, beneficiary_crop_id uuid, allocation_weight numeric(20,12));
  `);
  for (const f of ['20261123_cost_entries.sql', '20261123_economic_completeness.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  for (const c of [A, B]) await db.query('INSERT INTO companies VALUES($1)', [c]);
  for (const [id, c] of [[10, A], [11, A], [12, A], [13, B]]) await db.query("INSERT INTO users VALUES($1,$2,true,$3,null,$4)", [uid(id), c, 'Usuario ' + id, `u${id}@example.test`]);
  await db.query("INSERT INTO campaigns VALUES($1,$2,'Gruesa'),($3,$4,'Otra')", [CAMPAIGN, A, uid(103), B]);
  await db.query("INSERT INTO crops VALUES($1,$2,'Soja'),($3,$2,'Maíz'),($4,$5,'Soja B')", [SOY, A, CORN, uid(104), B]);
  const query = (sql, args = []) => db.query(sql, args);
  const pool = { query, connect: async () => ({ query, release() {} }) };
  let n = 0;
  const api = {
    db, pool,
    lot: (i, name, area, company = A) => db.query('INSERT INTO lots VALUES($1,$2,$3,$4,$4)', [LOT(i), company, name, area]),
    sub: (i, lotN, name, area) => db.query('INSERT INTO sub_lots VALUES($1,$2,$3,$4,$5)', [SUB(i), A, LOT(lotN), name, area]),
    cycle: (i, lotN, { subN = null, crop = SOY, area }) => db.query('INSERT INTO crop_assignments VALUES($1,$2,$3,$4,$5,$6,$7,null)', [CYCLE(i), A, CAMPAIGN, LOT(lotN), subN && SUB(subN), crop, area]),
    record: async (i, lotN, kg, ha, cycleN) => {
      await db.query('INSERT INTO harvest_records(id,company_id,lot_id,sub_lot_id,crop_id,campaign_id,production_kg,harvested_area_ha) VALUES($1,$2,$3,null,$4,$5,$6,$7)', [REC(i), A, LOT(lotN), SOY, CAMPAIGN, kg, ha]);
      await db.query('INSERT INTO harvest_crop_assignments VALUES($1,$2,$3)', [REC(i), CYCLE(cycleN), ha]);
    },
    plan: async (i, lotN, amount, { subN = null, pendingLine = false } = {}) => {
      await db.query('INSERT INTO planning VALUES($1,$2,true)', [uid(600 + i), A]);
      await db.query("INSERT INTO economic_snapshots VALUES($1,$2,$3,1,null,$4,'2027-01-10','Fumigación')", [uid(700 + i), A, uid(600 + i), CAMPAIGN]);
      await db.query("INSERT INTO economic_snapshot_lines VALUES($1,$2,$3,'product','confirmed',$4,'Glifosato',10,'L')", [uid(800 + ++n), A, uid(700 + i), amount]);
      if (pendingLine) await db.query("INSERT INTO economic_snapshot_lines VALUES($1,$2,$3,'labor','pending',null,null,null,null)", [uid(800 + ++n), A, uid(700 + i)]);
      await db.query('INSERT INTO economic_snapshot_targets VALUES($1,$2,$3,$4,$5,$6,$7)', [uid(900 + ++n), A, uid(700 + i), LOT(lotN), subN && SUB(subN), SOY, '1.000000000000']);
    },
  };
  return api;
}
const body = (over = {}, targets = [{ lot_id: LOT(1) }], dest = {}) => ({ campaign_id: CAMPAIGN, category: 'seed', description: 'Semilla', expense_date: '2027-01-05', currency: 'USD', amount: '1000',
  destination: { scope: 'lots', crop_id: SOY, method: 'area_proportional', targets, ...dest }, ...over });
const add = (pool, input, user = editor, k = key()) => costs.create(pool, { user, key: k, body: input });
const rows = (pool, query = {}, user = reader) => results.results(pool, { user, query: { campaign_id: CAMPAIGN, ...query } });
const rowOf = (out, name) => out.data.find(r => r.lot.name === name);
const declare = (pool, over = {}, user = editor) => completeness.declare(pool, { user, key: key(), body: { action: 'complete', campaign_id: CAMPAIGN, crop_id: SOY, lot_id: LOT(1), ...over } });
const rejects = (promise, status) => assert.rejects(promise, e => (status ? e.status === status : true));
const base = async () => { const s = await setup(); await s.lot(1, 'L1', 100); await s.cycle(1, 1, { area: 100 }); return s; };

test('gasto USD confirmado en un lote: suma exacta, estado parcial, sin ≥ engañoso', async () => {
  const s = await base();
  try {
    const out = await add(s.pool, body({ amount: '1234.5' }));
    assert.equal(out.data.amount_usd, '1234.500000000000'); assert.equal(out.data.cost_status, 'confirmed'); assert.equal(out.data.revision, 1);
    assert.equal(out.data.request_hash, undefined); assert.equal(out.data.idempotency_key, undefined);
    const c = rowOf(await rows(s.pool), 'L1').costs;
    assert.deepEqual([c.status, c.known_total_usd, c.other_usd, c.products_usd, c.is_minimum, c.per_ha_usd], ['partial', '1234.500000', '1234.500000', null, true, '12.345000']);
  } finally { await s.db.close(); }
});

test('ARS confirmado con evidencia FX convierte una sola vez; ARS pendiente queda NULL y no suma', async () => {
  const s = await base();
  try {
    const ok = await add(s.pool, body({ currency: 'ARS', amount: '1000000', payment_date: '2027-01-05', fx_rate: '1000', fx_date: '2027-01-05', fx_source: 'BCRA A3500' }));
    assert.equal(ok.data.cost_status, 'confirmed'); assert.equal(Number(ok.data.amount_usd), 1000); assert.equal(ok.data.fx_type, 'divisa_mayorista');
    const pending = await add(s.pool, body({ currency: 'ARS', amount: '500000', description: 'Flete' }));
    assert.equal(pending.data.cost_status, 'pending'); assert.equal(pending.data.amount_usd, null);
    const c = rowOf(await rows(s.pool), 'L1').costs;
    assert.deepEqual([c.known_total_usd, c.pending_entries, c.status], ['1000.000000', 1, 'partial']);
    await rejects(add(s.pool, body({ currency: 'ARS', amount: '10', payment_date: '2027-01-05', fx_rate: '1', fx_date: '2027-01-04', fx_source: 'x' })), 400); // FX date must be the payment date
    await rejects(add(s.pool, body({ currency: 'USD', fx_rate: '1000' })), 400);
  } finally { await s.db.close(); }
});

test('cero confirmado es conocido; solo pendiente no es cero', async () => {
  const s = await base(); await s.lot(2, 'L2', 10); await s.cycle(2, 2, { area: 10 });
  try {
    await add(s.pool, body({ amount: '0' }));
    await add(s.pool, body({ currency: 'ARS', amount: '10' }, [{ lot_id: LOT(2) }]));
    const out = await rows(s.pool);
    assert.deepEqual([rowOf(out, 'L1').costs.status, rowOf(out, 'L1').costs.known_total_usd], ['partial', '0.000000']);
    assert.deepEqual([rowOf(out, 'L2').costs.status, rowOf(out, 'L2').costs.known_total_usd, rowOf(out, 'L2').costs.pending_entries], ['pending', null, 1]);
  } finally { await s.db.close(); }
});

test('varios lotes: area_proportional y manual_percent suman exactamente 1', async () => {
  const s = await base(); await s.lot(2, 'L2', 100); await s.lot(3, 'L3', 100); await s.cycle(2, 2, { area: 100 }); await s.cycle(3, 3, { area: 100 });
  try {
    const targets = [1, 2, 3].map(n => ({ lot_id: LOT(n) }));
    const a = await add(s.pool, body({ amount: '1000' }, targets));
    const sum = a.data.targets.reduce((n, t) => n + BigInt(t.allocation_weight.replace('.', '')), 0n);
    assert.equal(sum, 1000000000000n);
    assert.equal(a.data.targets.every(t => t.allocation_method === 'area_proportional'), true);
    const m = await add(s.pool, body({ amount: '100', category: 'rent' }, [{ lot_id: LOT(1), percent: '33.3333' }, { lot_id: LOT(2), percent: '33.3333' }, { lot_id: LOT(3), percent: '33.3334' }], { method: 'manual_percent' }));
    assert.equal(m.data.targets.reduce((n, t) => n + BigInt(t.allocation_weight.replace('.', '')), 0n), 1000000000000n);
    await rejects(add(s.pool, body({}, [{ lot_id: LOT(1), percent: '60' }, { lot_id: LOT(2), percent: '30' }], { method: 'manual_percent' })), 400);
    const out = await rows(s.pool);
    const total = out.data.reduce((n, r) => n + Number(r.costs.known_total_usd), 0);
    assert.ok(Math.abs(total - 1100) < 0.0001);
  } finally { await s.db.close(); }
});

test('sublote: el gasto del sublote suma al padre y no se reparte a las hijas', async () => {
  const s = await setup(); await s.lot(1, 'L1', 100); await s.sub(1, 1, 'A', 40); await s.sub(2, 1, 'B', 40);
  await s.cycle(1, 1, { subN: 1, area: 40 }); await s.cycle(2, 1, { subN: 2, area: 40 });
  try {
    await add(s.pool, body({ amount: '200' }, [{ lot_id: LOT(1), sub_lot_id: SUB(1) }]));
    await add(s.pool, body({ amount: '60', category: 'freight' }, [{ lot_id: LOT(1) }]));
    const parent = rowOf(await rows(s.pool), 'L1');
    assert.equal(parent.costs.known_total_usd, '260.000000');
    const kids = Object.fromEntries(parent.children.map(c => [c.sub_lot.name, c.costs.known_total_usd]));
    assert.deepEqual(kids, { A: '200.000000', B: null });
  } finally { await s.db.close(); }
});

test('toda la campaña se expande a destinos actuales y un lote posterior no recibe parte', async () => {
  const s = await base(); await s.lot(2, 'L2', 300); await s.cycle(2, 2, { area: 300 });
  try {
    const out = await add(s.pool, body({ amount: '400' }, undefined, { scope: 'campaign', targets: undefined }));
    assert.equal(out.data.targets.length, 2);
    assert.deepEqual(out.data.targets.map(t => t.reference_area_ha), ['100.000000', '300.000000']);
    await s.lot(3, 'L3', 100); await s.cycle(3, 3, { area: 100 });
    const res = await rows(s.pool);
    assert.equal(rowOf(res, 'L1').costs.known_total_usd, '100.000000');
    assert.equal(rowOf(res, 'L2').costs.known_total_usd, '300.000000');
    assert.equal(rowOf(res, 'L3') ? rowOf(res, 'L3').costs.known_total_usd : null, null);
  } finally { await s.db.close(); }
});

test('revisión: la supersedida no suma; anular retira el gasto; historial intacto', async () => {
  const s = await base();
  try {
    const first = (await add(s.pool, body({ amount: '100' }))).data;
    const second = (await costs.revise(s.pool, { user: editor, id: first.id, key: key(), body: { ...body({ amount: '150' }), supersedes_id: first.id, reason: 'Corrección de factura' } })).data;
    assert.equal(second.revision, 2); assert.equal(second.root_id, first.id);
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.known_total_usd, '150.000000');
    await rejects(costs.revise(s.pool, { user: editor, id: first.id, key: key(), body: { ...body({ amount: '1' }), supersedes_id: first.id, reason: 'x' } }), 409); // stale
    await costs.revise(s.pool, { user: editor, id: second.id, key: key(), body: { state: 'void', supersedes_id: second.id, reason: 'Duplicado' } });
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'pending');
    assert.equal((await s.db.query('SELECT count(*)::int n FROM cost_entries')).rows[0].n, 3);
    assert.equal((await costs.get(s.pool, { user: reader, id: first.id })).data.is_current, false);
    await rejects(s.db.query("UPDATE cost_entries SET description='x'"));
    await rejects(s.db.query('DELETE FROM cost_entries'));
  } finally { await s.db.close(); }
});

test('idempotencia: misma clave y mismo cuerpo repite; otro cuerpo da 409; sin clave 400', async () => {
  const s = await base();
  try {
    const k = key(), first = await add(s.pool, body(), editor, k), again = await add(s.pool, body(), editor, k);
    assert.equal(again.replayed, true); assert.equal(again.data.id, first.data.id);
    await rejects(add(s.pool, body({ amount: '2' }), editor, k), 409);
    await rejects(costs.create(s.pool, { user: editor, key: undefined, body: body() }), 400);
    assert.equal((await s.db.query('SELECT count(*)::int n FROM cost_entries')).rows[0].n, 1);
  } finally { await s.db.close(); }
});

test('tenant y permisos: otra empresa no ve ni escribe; solo lectura no registra; harvest.view no ve importes', async () => {
  const s = await base();
  try {
    const entry = (await add(s.pool, body())).data;
    await rejects(costs.get(s.pool, { user: foreign, id: entry.id }), 404);
    assert.equal((await costs.list(s.pool, { user: foreign })).data.length, 0);
    await rejects(add(s.pool, body(), foreign), 404);                                  // lot/campaign of company A are not visible to B
    await rejects(add(s.pool, body(), reader), 403);
    await rejects(costs.list(s.pool, { user: harvestOnly }), 403);
    assert.equal((await costs.list(s.pool, { user: reader, query: { campaign_id: CAMPAIGN } })).data.length, 1);
    const hv = rowOf(await rows(s.pool, {}, harvestOnly), 'L1');
    assert.equal(hv.costs, null);
    await rejects(costs.create(s.pool, { user: editor, key: key(), body: { ...body(), company_id: B } }), 400);   // tenant is never client-controlled
  } finally { await s.db.close(); }
});

test('filtros del listado: categoría, estado, lote y cultivo', async () => {
  const s = await base(); await s.lot(2, 'L2', 10); await s.cycle(2, 2, { area: 10 });
  try {
    await add(s.pool, body());
    await add(s.pool, body({ category: 'freight', currency: 'ARS', amount: '5' }, [{ lot_id: LOT(2) }]));
    const q = query => costs.list(s.pool, { user: reader, query }).then(r => r.data.length);
    assert.deepEqual([await q({ category: 'freight' }), await q({ status: 'pending' }), await q({ lot_id: LOT(1) }), await q({ crop_id: CORN }), await q({ campaign_id: CAMPAIGN })], [1, 1, 1, 0, 2]);
  } finally { await s.db.close(); }
});

test('sin declaración es parcial; completar exige conocido y sin pendientes', async () => {
  const s = await base();
  try {
    await rejects(declare(s.pool), 409);                                               // nothing known
    await add(s.pool, body({ amount: '100' }));
    await add(s.pool, body({ currency: 'ARS', amount: '10', description: 'Pendiente' }));
    await rejects(declare(s.pool), 409);                                               // a pending entry blocks it
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'partial');
  } finally { await s.db.close(); }
});

test('declaración válida: Completo sin ≥, con revisor; costo/tn provisional hasta cerrar la cosecha', async () => {
  const s = await base(); await s.record(1, 1, 30000, 100, 1);
  try {
    await add(s.pool, body({ amount: '3000' }));
    await rejects(declare(s.pool, {}, reader), 403);
    const done = await declare(s.pool, { observation: 'Revisado con el contador' });
    assert.equal(done.data[0].state, 'complete'); assert.equal(done.data[0].evidence_fingerprint, undefined);
    const c = rowOf(await rows(s.pool), 'L1').costs;
    assert.deepEqual([c.status, c.is_minimum, c.per_tn_usd, c.is_provisional], ['complete', false, '100.000000', true]);
    const detail = await results.detail(s.pool, { user: editor, query: { campaign_id: CAMPAIGN, crop_id: SOY, lot_id: LOT(1) } });
    assert.equal(detail.completeness.status, 'complete'); assert.equal(detail.completeness.parts[0].declared_by, 'Usuario 10'); assert.equal(detail.economic_edit, true);
    assert.equal(detail.cost_detail.other_expenses[0].category, 'seed');
    assert.equal((await results.detail(s.pool, { user: reader, query: { campaign_id: CAMPAIGN, crop_id: SOY, lot_id: LOT(1) } })).economic_edit, false);
    const summary = (await rows(s.pool)).summary;
    assert.equal(summary.complete_lots, 1); assert.equal(summary.incomplete_lots, 0);
  } finally { await s.db.close(); }
});

test('un gasto nuevo o revisado invalida la declaración (auditable); reabrir exige motivo', async () => {
  const s = await base();
  try {
    const first = (await add(s.pool, body({ amount: '100' }))).data;
    await declare(s.pool);
    await add(s.pool, body({ amount: '50', category: 'freight' }));
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'partial');
    let history = (await s.db.query('SELECT state, revision, auto_invalidated FROM economic_completeness_declarations ORDER BY revision')).rows;
    assert.deepEqual(history.map(h => [h.state, h.revision, h.auto_invalidated]), [['complete', 1, false], ['open', 2, true]]);
    await declare(s.pool);
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'complete');
    await costs.revise(s.pool, { user: editor, id: first.id, key: key(), body: { ...body({ amount: '120' }), supersedes_id: first.id, reason: 'Ajuste' } });
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'partial');
    await declare(s.pool);
    await rejects(declare(s.pool, { action: 'reopen' }), 400);
    await declare(s.pool, { action: 'reopen', reason: 'Falta una factura' });
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'partial');
    history = (await s.db.query('SELECT count(*)::int n FROM economic_completeness_declarations')).rows;
    assert.equal(history[0].n, 6);                                                   // nothing deleted
    await rejects(s.db.query("UPDATE economic_completeness_declarations SET state='open'"));
  } finally { await s.db.close(); }
});

test('evidencia nueva de Planning vuelve obsoleta la declaración por huella, sin tocar el historial, y ningún GET la muestra Completa', async () => {
  const s = await base(); await s.plan(1, 1, '30');
  try {
    await add(s.pool, body({ amount: '100' })); await declare(s.pool);
    const query = { campaign_id: CAMPAIGN, crop_id: SOY, lot_id: LOT(1) };
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'complete');
    const before = (await s.db.query('SELECT * FROM economic_completeness_declarations')).rows;
    // A Planning revision (supersedes snapshot 1) and a second Planning arrive later, outside any cost-entry flow.
    await s.db.query("INSERT INTO economic_snapshots VALUES($1,$2,$3,2,$4,$5,'2027-01-20','Fumigación')", [uid(750), A, uid(601), uid(701), CAMPAIGN]);
    await s.db.query("INSERT INTO economic_snapshot_lines VALUES($1,$2,$3,'product','confirmed',45,'Glifosato',10,'L')", [uid(850), A, uid(750)]);
    await s.db.query("INSERT INTO economic_snapshot_targets VALUES($1,$2,$3,$4,null,$5,'1.000000000000')", [uid(950), A, uid(750), LOT(1), SOY]);
    const c = rowOf(await rows(s.pool), 'L1').costs;
    assert.deepEqual([c.status, c.known_total_usd, c.is_minimum], ['partial', '145.000000', true]);          // 100 + 45 (revision replaces 30)
    const detail = await results.detail(s.pool, { user: editor, query });
    assert.equal(detail.completeness.status, 'partial');
    assert.equal(detail.completeness.parts[0].valid, false); assert.equal(detail.completeness.parts[0].evidence_changed, true);
    assert.equal(detail.costs.status, 'partial');
    const listed = (await completeness.current(s.pool, { user: reader, query: { campaign_id: CAMPAIGN } })).data[0];
    assert.deepEqual([listed.state, listed.declared_state, listed.stale], ['open', 'complete', true]);      // effective vs stored, clearly separated
    assert.equal(listed.evidence_fingerprint, undefined);
    const after = (await s.db.query('SELECT * FROM economic_completeness_declarations')).rows;
    assert.deepEqual(after, before);                                                                        // history untouched, nothing inserted
    await declare(s.pool);                                                                                  // a new review is required and works
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'complete');
    assert.equal((await completeness.current(s.pool, { user: reader, query: { campaign_id: CAMPAIGN } })).data[0].stale, false);
  } finally { await s.db.close(); }
});

test('un gasto no cambia de campaña por revisión; "toda la campaña" solo por superficie', async () => {
  const s = await base();
  try {
    await s.db.query("INSERT INTO campaigns VALUES($1,$2,'Fina')", [uid(105), A]);
    const e = (await add(s.pool, body())).data;
    await rejects(costs.revise(s.pool, { user: editor, id: e.id, key: key(), body: { ...body({ campaign_id: uid(105) }), supersedes_id: e.id, reason: 'Corrección' } }), 400);
    await rejects(add(s.pool, body({}, undefined, { scope: 'campaign', targets: undefined, method: 'manual_percent' })), 400);
    const ok = await add(s.pool, body({}, undefined, { scope: 'campaign', targets: undefined }));
    assert.equal(ok.data.targets[0].allocation_method, 'area_proportional');
    await costs.revise(s.pool, { user: editor, id: e.id, key: key(), body: { state: 'void', supersedes_id: e.id, reason: 'Campaña equivocada' } });
    assert.equal((await costs.get(s.pool, { user: reader, id: e.id })).data.is_current, false);
  } finally { await s.db.close(); }
});

test('Planning + gasto adicional: sin doble conteo, categorías y resumen global', async () => {
  const s = await base(); await s.plan(1, 1, '500', { pendingLine: true });
  try {
    await add(s.pool, body({ amount: '100', category: 'seed' })); await add(s.pool, body({ amount: '50', category: 'freight' })); await add(s.pool, body({ amount: '25', category: 'freight' }));
    const out = await rows(s.pool), c = rowOf(out, 'L1').costs;
    assert.deepEqual([c.known_total_usd, c.products_usd, c.other_usd, c.pending_lines, c.status, c.is_minimum], ['675.000000', '500.000000', '175.000000', 1, 'partial', true]);
    assert.equal(out.summary.known_cost_usd, '675.000000');
    await rejects(declare(s.pool), 409);                                              // a pending Planning line blocks completion
    const detail = await results.detail(s.pool, { user: reader, query: { campaign_id: CAMPAIGN, crop_id: SOY, lot_id: LOT(1) } });
    const freight = detail.cost_detail.other_expenses.find(g => g.category === 'freight');
    assert.equal(freight.known_usd, '75.000000'); assert.equal(freight.entries.length, 2);
    assert.ok(detail.completeness.blockers.includes('pending_lines'));
  } finally { await s.db.close(); }
});

test('declaración padre con sublotes: crea declaraciones literales y un gasto en una hija invalida solo esa clave y al padre', async () => {
  const s = await setup(); await s.lot(1, 'L1', 100); await s.sub(1, 1, 'A', 40); await s.sub(2, 1, 'B', 40);
  await s.cycle(1, 1, { subN: 1, area: 40 }); await s.cycle(2, 1, { subN: 2, area: 40 });
  try {
    await add(s.pool, body({ amount: '100' }, [{ lot_id: LOT(1), sub_lot_id: SUB(1) }])); await add(s.pool, body({ amount: '60' }, [{ lot_id: LOT(1), sub_lot_id: SUB(2) }]));
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'partial');
    await declare(s.pool, { include_children: true });
    const out = await rows(s.pool), parent = rowOf(out, 'L1');
    assert.deepEqual([parent.costs.status, ...parent.children.map(c => c.costs.status)], ['complete', 'complete', 'complete']);
    await add(s.pool, body({ amount: '10', category: 'drying' }, [{ lot_id: LOT(1), sub_lot_id: SUB(2) }]));
    const after = rowOf(await rows(s.pool), 'L1');
    assert.deepEqual([after.costs.status, ...after.children.map(c => c.costs.status)], ['partial', 'complete', 'partial']);
    await declare(s.pool, { sub_lot_id: SUB(2) });
    assert.equal(rowOf(await rows(s.pool), 'L1').costs.status, 'complete');
  } finally { await s.db.close(); }
});

test('completitud: otra empresa no puede declarar ni consultar; idempotente', async () => {
  const s = await base();
  try {
    await add(s.pool, body());
    await rejects(declare(s.pool, {}, foreign), 404);
    const k = key(), body_ = { action: 'complete', campaign_id: CAMPAIGN, crop_id: SOY, lot_id: LOT(1) };
    const one = await completeness.declare(s.pool, { user: editor, key: k, body: body_ }), two = await completeness.declare(s.pool, { user: editor, key: k, body: body_ });
    assert.equal(two.replayed, true); assert.equal(two.data[0].id, one.data[0].id);
    assert.equal((await completeness.current(s.pool, { user: foreign, query: { campaign_id: CAMPAIGN } })).data.length, 0);
    assert.equal((await completeness.current(s.pool, { user: reader, query: { campaign_id: CAMPAIGN } })).data.length, 1);
  } finally { await s.db.close(); }
});

test('migración: los pesos deben sumar 1 al confirmar y los destinos quedan sellados', async () => {
  const s = await base();
  try {
    await s.db.query('BEGIN');
    await s.db.query(`INSERT INTO cost_entries(id,company_id,root_id,revision,campaign_id,category,description,expense_date,currency,amount_original,amount_usd,cost_status,created_by,idempotency_key,request_hash)
      VALUES($1,$2,$1,1,$3,'seed','x','2027-01-01','USD',1,1,'confirmed',$4,'raw-1',repeat('a',64))`, [uid(950), A, CAMPAIGN, uid(10)]);
    await s.db.query(`INSERT INTO cost_entry_targets(company_id,cost_entry_id,lot_id,beneficiary_crop_id,lot_name_snapshot,crop_name_snapshot,reference_area_ha,allocation_method,allocation_weight)
      VALUES($1,$2,$3,$4,'L1','Soja',10,'area_proportional',0.5)`, [A, uid(950), LOT(1), SOY]);
    await rejects(s.db.query('COMMIT'));
    await s.db.query('ROLLBACK');
    assert.equal((await s.db.query('SELECT count(*)::int n FROM cost_entries')).rows[0].n, 0);
    await rejects(s.db.query(`INSERT INTO cost_entries(id,company_id,root_id,revision,campaign_id,category,description,expense_date,currency,amount_original,amount_usd,cost_status,created_by,idempotency_key,request_hash)
      VALUES($1,$2,$1,1,$3,'seed','x','2027-01-01','USD',1,1,'confirmed',$4,'raw-2',repeat('a',64))`, [uid(951), B, CAMPAIGN, uid(13)]));   // campaign of another company
  } finally { await s.db.close(); }
});

// Isolated PostgreSQL (PGlite) with synthetic data. Never connects to Supabase or reads .env.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PGlite } = require(process.env.HARVEST_TEST_PGLITE || '@electric-sql/pglite');
const results = require('../services/harvestResults');

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = uid(1), B = uid(2), user = { company_id: A, id: uid(9) };
const CAMPAIGN = uid(100), CROP_SOY = uid(101), CROP_CORN = uid(102);
const LOT = n => uid(200 + n), SUB = n => uid(300 + n), CYCLE = n => uid(400 + n), REC = n => uid(500 + n);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE campaigns(id uuid PRIMARY KEY, company_id uuid, name text, start_date date, end_date date);
    CREATE TABLE crops(id uuid PRIMARY KEY, company_id uuid, name text, enabled boolean DEFAULT true);
    CREATE TABLE lots(id uuid PRIMARY KEY, company_id uuid, name text, area_ha numeric, area numeric);
    CREATE TABLE sub_lots(id uuid PRIMARY KEY, company_id uuid, lot_id uuid, name text, area_ha numeric);
    CREATE TABLE crop_assignments(id uuid PRIMARY KEY, company_id uuid, campaign_id uuid, lot_id uuid, sub_lot_id uuid, crop_id uuid,
      area_ha numeric(12,2), end_date date, harvest_closure_source text);
    CREATE TABLE harvest_records(id uuid PRIMARY KEY, company_id uuid, lot_id uuid, sub_lot_id uuid, crop_id uuid, crop text,
      campaign_id uuid, campaign text, harvest_date date, production_kg numeric(14,2), harvested_area_ha numeric(10,2),
      yield_kg_ha numeric(12,2), notes text, created_by uuid, inventory_impact_mode text, historical_import_id uuid,
      registered_retroactively boolean, retroactive_reason text, retroactive_notes text, registration_timezone text,
      enabled boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE harvest_crop_assignments(harvest_id uuid, crop_assignment_id uuid, harvested_area_ha numeric(12,2));
  `);
  for (const company of [A, B]) {
    await db.query("INSERT INTO campaigns VALUES($1,$2,'Gruesa 2026/27','2026-10-01','2027-05-31')", [company === A ? CAMPAIGN : uid(110), company]);
    await db.query("INSERT INTO crops VALUES($1,$2,'Soja'),($3,$2,'Maíz')", [company === A ? CROP_SOY : uid(111), company, company === A ? CROP_CORN : uid(112)]);
  }
  const pool = { query: (sql, args = []) => db.query(sql, args) };
  const lot = (n, name, area, company = A) => db.query('INSERT INTO lots VALUES($1,$2,$3,$4,$4)', [LOT(n), company, name, area]);
  const sub = (n, lotN, name, area, company = A) => db.query('INSERT INTO sub_lots VALUES($1,$2,$3,$4,$5)', [SUB(n), company, LOT(lotN), name, area]);
  const cycle = (n, lotN, { subN = null, crop = CROP_SOY, area, end = null, company = A, campaign = CAMPAIGN }) =>
    db.query('INSERT INTO crop_assignments(id,company_id,campaign_id,lot_id,sub_lot_id,crop_id,area_ha,end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [CYCLE(n), company, campaign, LOT(lotN), subN && SUB(subN), crop, area, end]);
  const record = async (n, lotN, { subN = null, crop = CROP_SOY, campaign = CAMPAIGN, kg, ha, links = [], enabled = true, company = A, cropText = 'soja' }) => {
    await db.query(`INSERT INTO harvest_records(id,company_id,lot_id,sub_lot_id,crop_id,crop,campaign_id,campaign,harvest_date,production_kg,harvested_area_ha,enabled)
      VALUES($1,$2,$3,$4,$5,$6,$7,'2026-2027','2027-04-10',$8,$9,$10)`, [REC(n), company, LOT(lotN), subN && SUB(subN), crop, cropText, campaign, kg, ha, enabled]);
    for (const [cycleN, area] of links) await db.query('INSERT INTO harvest_crop_assignments VALUES($1,$2,$3)', [REC(n), CYCLE(cycleN), area]);
  };
  return { db, pool, lot, sub, cycle, record };
}
const run = (pool, query = {}, who = user) => results.results(pool, { user: who, query });

test('varias cosechas parciales de la misma clave consolidan una sola fila', async () => {
  const { db, pool, lot, cycle, record } = await setup();
  try {
    await lot(1, 'T4', 68.3); await cycle(1, 1, { area: 68.3 });
    await record(1, 1, { kg: 200000, ha: 20, links: [[1, 20]] });
    await record(2, 1, { kg: 250000, ha: 25, links: [[1, 25]] });
    await record(3, 1, { kg: 160000, ha: 23.3, links: [[1, 23.3]] });
    const out = await run(pool);
    assert.equal(out.data.length, 1);
    const row = out.data[0];
    assert.equal(row.lot.name, 'T4'); assert.equal(row.crop.name, 'Soja'); assert.equal(row.campaign.name, 'Gruesa 2026/27');
    assert.equal(row.records_count, 3); assert.equal(row.production_kg, '610000.00'); assert.equal(row.harvested_area_ha, '68.30');
    assert.equal(row.surface_ha, '68.30'); assert.equal(row.surface_source, 'cycles'); assert.equal(row.harvest_status, 'in_progress');
    assert.equal(row.yield_kg_ha, '8931.19');
    assert.equal(out.summary.production_kg, '610000.00'); assert.equal(out.summary.records, 3);
    assert.equal(Object.hasOwn(row, 'costs'), false);
    assert.equal(JSON.stringify(out).includes('cost'), false);
  } finally { await db.close(); }
});

test('rendimiento ponderado: nunca el promedio aritmético de yield_kg_ha', async () => {
  const { db, pool, lot, cycle, record } = await setup();
  try {
    await lot(1, 'T1', 40); await cycle(1, 1, { area: 40 });
    await record(1, 1, { kg: 100000, ha: 10, links: [[1, 10]] }); // 10000 kg/ha
    await record(2, 1, { kg: 30000, ha: 30, links: [[1, 30]] });  //  1000 kg/ha
    const row = (await run(pool)).data[0];
    assert.equal(row.yield_kg_ha, '3250.00'); // 130000 / 40; the arithmetic mean would be 5500
    assert.equal(row.harvest_status, 'in_progress');
  } finally { await db.close(); }
});

test('mismo destino: sin prorrateo innecesario aunque haya varios vínculos', async () => {
  const { db, pool, lot, cycle, record } = await setup();
  try {
    await lot(1, 'T2', 50); await cycle(1, 1, { area: 30 }); await cycle(2, 1, { area: 20 });
    await record(1, 1, { kg: 1001.01, ha: 50, links: [[1, 30], [2, 20]] });
    const row = (await run(pool)).data[0];
    assert.equal(row.production_kg, '1001.01'); assert.equal(row.production_basis.prorated_records, 0);
    assert.equal(row.production_basis.method, null); assert.equal(row.records_count, 1); assert.equal(row.surface_ha, '50.00');
  } finally { await db.close(); }
});

test('destinos distintos: prorrateo por superficie con total exacto y marca explícita', async () => {
  const { db, pool, lot, sub, cycle, record } = await setup();
  try {
    await lot(1, 'T3', 90); await sub(1, 1, 'Norte', 30); await sub(2, 1, 'Sur', 60);
    await cycle(1, 1, { subN: 1, area: 30 }); await cycle(2, 1, { subN: 2, area: 60 });
    await record(1, 1, { kg: 100.01, ha: 15, links: [[1, 5], [2, 10]] });
    const out = await run(pool);
    const parent = out.data[0];
    assert.equal(parent.production_kg, '100.01'); // exact conservation
    const [north, south] = parent.children;
    assert.equal(north.sub_lot.name, 'Norte'); assert.equal(south.sub_lot.name, 'Sur');
    assert.equal(Number(north.production_kg) + Number(south.production_kg), 100.01);
    assert.equal(north.production_kg, '33.34'); assert.equal(south.production_kg, '66.67');
    assert.equal(north.production_basis.method, 'area_proportional'); assert.equal(north.production_basis.prorated_records, 1);
    assert.equal(parent.production_basis.prorated_records, 2); assert.equal(parent.records_count, 1);
    assert.equal(out.summary.records, 1); assert.equal(out.summary.production_kg, '100.01');
    assert.equal(north.harvested_area_ha, '5.00'); assert.equal(south.harvested_area_ha, '10.00');
  } finally { await db.close(); }
});

test('superficie vínculo inválida entre destinos distintos: no se infiere y queda para revisión', async () => {
  const { db, pool, lot, sub, cycle, record } = await setup();
  try {
    await lot(1, 'T3', 90); await sub(1, 1, 'Norte', 30); await sub(2, 1, 'Sur', 60);
    await cycle(1, 1, { subN: 1, area: 30 }); await cycle(2, 1, { subN: 2, area: 60 });
    await record(1, 1, { kg: 500, ha: 15, links: [[1, 0], [2, 15]] });
    const out = await run(pool);
    assert.equal(out.summary.unclassified.records, 1); assert.equal(out.summary.unclassified.reasons.invalid_link_area, 1);
    assert.equal(out.summary.unclassified.production_kg, '500.00'); assert.deepEqual(out.summary.unclassified.record_ids, [REC(1)]);
    assert.equal(out.summary.production_kg, '0.00'); // nothing was guessed into a result
    assert.ok(out.data.every(row => row.production_kg === null));
  } finally { await db.close(); }
});

test('deshabilitadas excluidas; legacy sin campaña o cultivo se reporta aparte sin asignarse', async () => {
  const { db, pool, lot, cycle, record } = await setup();
  try {
    await lot(1, 'T5', 20); await cycle(1, 1, { area: 20 });
    await record(1, 1, { kg: 1000, ha: 10, links: [[1, 10]] });
    await record(2, 1, { kg: 9999, ha: 10, links: [[1, 10]], enabled: false });
    await record(3, 1, { kg: 700, ha: 7, campaign: null });
    await record(4, 1, { kg: 300, ha: 3, crop: null });
    const out = await run(pool);
    assert.equal(out.data[0].production_kg, '1000.00'); assert.equal(out.data[0].records_count, 1);
    assert.equal(out.summary.unclassified.records, 2);
    assert.equal(out.summary.unclassified.reasons.missing_campaign, 1); assert.equal(out.summary.unclassified.reasons.missing_crop, 1);
    assert.equal(out.summary.unclassified.production_kg, '1000.00');
  } finally { await db.close(); }
});

test('sublotes: la fila padre es el total y los costos de nivel lote no existen; hijas expandibles', async () => {
  const { db, pool, lot, sub, cycle, record } = await setup();
  try {
    await lot(1, 'T6', 100); await sub(1, 1, 'A', 40); await sub(2, 1, 'B', 40);
    await cycle(1, 1, { area: 20 }); await cycle(2, 1, { subN: 1, area: 40 }); await cycle(3, 1, { subN: 2, area: 40, end: '2027-05-01' });
    await record(1, 1, { kg: 2000, ha: 20, links: [[1, 20]] });           // lot-level key
    await record(2, 1, { subN: 1, kg: 8000, ha: 40, links: [[2, 40]] });  // sublot A
    const parent = (await run(pool)).data[0];
    assert.equal(parent.level, 'lot'); assert.equal(parent.sub_lot, null);
    assert.equal(parent.production_kg, '10000.00'); assert.equal(parent.harvested_area_ha, '60.00');
    assert.equal(parent.yield_kg_ha, '166.67'); assert.equal(parent.surface_ha, '100.00'); assert.equal(parent.records_count, 2);
    assert.deepEqual(parent.children.map(c => [c.sub_lot.name, c.production_kg, c.harvest_status]), [['A', '8000.00', 'in_progress'], ['B', null, 'closed']]);
    assert.equal(parent.harvest_status, 'in_progress');
    const onlyA = (await run(pool, { sub_lot_id: SUB(1) }));
    assert.equal(onlyA.data.length, 1); assert.equal(onlyA.data[0].level, 'sub_lot'); assert.equal(onlyA.data[0].production_kg, '8000.00');
    assert.equal(onlyA.summary.production_kg, '8000.00');
  } finally { await db.close(); }
});

test('ciclo sin cosecha aparece con producción pendiente (null), sin inventar cero', async () => {
  const { db, pool, lot, cycle } = await setup();
  try {
    await lot(1, 'T7', 30); await cycle(1, 1, { area: 30 });
    const row = (await run(pool)).data[0];
    assert.equal(row.production_kg, null); assert.equal(row.harvested_area_ha, null); assert.equal(row.yield_kg_ha, null);
    assert.equal(row.records_count, 0); assert.equal(row.harvest_status, 'not_started');
  } finally { await db.close(); }
});

test('aislamiento entre empresas: nada de B aparece en A ni se acepta un id ajeno', async () => {
  const { db, pool, lot, cycle, record } = await setup();
  try {
    await lot(1, 'A1', 10); await cycle(1, 1, { area: 10 }); await record(1, 1, { kg: 100, ha: 10, links: [[1, 10]] });
    await lot(2, 'B1', 10, B); await cycle(2, 2, { area: 10, company: B, campaign: uid(110), crop: uid(111) });
    await record(2, 2, { kg: 777, ha: 10, company: B, campaign: uid(110), crop: uid(111), links: [[2, 10]] });
    const mine = await run(pool);
    assert.deepEqual(mine.data.map(r => r.lot.name), ['A1']); assert.equal(mine.summary.production_kg, '100.00');
    const foreign = await run(pool, { lot_id: LOT(2) });
    assert.equal(foreign.data.length, 0); assert.equal(foreign.summary.production_kg, '0.00');
    const theirs = await run(pool, {}, { company_id: B, id: uid(8) });
    assert.deepEqual(theirs.data.map(r => r.lot.name), ['B1']);
    await assert.rejects(run(pool, { lot_id: 'no-es-uuid' }), /inválido/);
    await assert.rejects(run(pool, {}, { company_id: null }), /empresa/);
  } finally { await db.close(); }
});

test('paginación del servidor después de agregar y summary sobre todo el conjunto filtrado', async () => {
  const { db, pool, lot, cycle, record } = await setup();
  try {
    for (let n = 1; n <= 5; n++) {
      await lot(n, `L${n}`, 10); await cycle(n, n, { area: 10 });
      await record(n, n, { kg: n * 1000, ha: 10, links: [[n, 10]] });
    }
    const first = await run(pool, { page: 1, pageSize: 2 });
    assert.deepEqual(first.data.map(r => r.lot.name), ['L1', 'L2']);
    assert.deepEqual(first.pagination, { total: 5, page: 1, pageSize: 2, totalPages: 3 });
    assert.equal(first.summary.production_kg, '15000.00'); assert.equal(first.summary.lots, 5); assert.equal(first.summary.records, 5);
    const last = await run(pool, { page: 3, pageSize: 2 });
    assert.deepEqual(last.data.map(r => r.lot.name), ['L5']); assert.equal(last.summary.production_kg, '15000.00');
    const beyond = await run(pool, { page: 9, pageSize: 2 });
    assert.equal(beyond.pagination.page, 3);
    const searched = await run(pool, { search: 'l4' });
    assert.deepEqual(searched.data.map(r => r.lot.name), ['L4']); assert.equal(searched.summary.production_kg, '4000.00');
  } finally { await db.close(); }
});

test('filtros por campaña (id o nombre), cultivo (id o nombre) y lote', async () => {
  const { db, pool, lot, cycle, record } = await setup();
  try {
    await lot(1, 'M1', 10); await lot(2, 'S1', 10);
    await cycle(1, 1, { area: 10, crop: CROP_CORN }); await cycle(2, 2, { area: 10, crop: CROP_SOY });
    await record(1, 1, { kg: 500, ha: 10, crop: CROP_CORN, cropText: 'maíz', links: [[1, 10]] });
    await record(2, 2, { kg: 300, ha: 10, links: [[2, 10]] });
    assert.deepEqual((await run(pool, { crop: 'maiz' })).data.map(r => r.lot.name), ['M1']);
    assert.deepEqual((await run(pool, { crop_id: CROP_SOY })).data.map(r => r.lot.name), ['S1']);
    assert.equal((await run(pool, { campaign: 'Gruesa 2026/27' })).data.length, 2);
    assert.equal((await run(pool, { campaign: CAMPAIGN })).data.length, 2);
    assert.equal((await run(pool, { campaign: 'Inexistente' })).data.length, 0);
    assert.deepEqual((await run(pool, { lot_id: LOT(2) })).data.map(r => r.lot.name), ['S1']);
  } finally { await db.close(); }
});

test('matemática: reparto exacto por mayor resto y rendimiento redondeado half-up', () => {
  const total = results.cents('100.01');
  const shares = results.distribute(total, [500n, 1000n]);
  assert.equal(shares.reduce((n, v) => n + v, 0n), total);
  assert.deepEqual(shares.map(results.decimal2), ['33.34', '66.67']);
  assert.equal(results.yieldText(results.cents('610000'), results.cents('68.3')), '8931.19');
  assert.equal(results.yieldText(1n, 0n), null);
});

// ---- listHarvestRecords: exact id filters ("Ver los N registros") -----------------------------------------------
async function listHarness() {
  const ctx = await setup();
  await ctx.db.exec('ALTER TABLE harvest_records ADD COLUMN IF NOT EXISTS dummy int');
  const filename = path.join(__dirname, '../controllers/harvestRecords.js');
  const realRequire = createRequire(filename);
  const sandbox = { exports: {}, require: name => (name === '../db/supabaseClient' ? { pool: ctx.pool } : realRequire(name)), console, Date };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const list = async query => {
    let out, err; const res = { status() { return this; }, json(v) { out = v; return v; } };
    await sandbox.exports.listHarvestRecords({ query, user }, res, e => { err = e; });
    if (err) throw err; return out;
  };
  return { ...ctx, list };
}

test('listHarvestRecords: filtros por campaign_id, crop_id y sub_lot_id coinciden con las claves de resultado', async () => {
  const { db, lot, sub, cycle, record, list } = await listHarness();
  try {
    await lot(1, 'T3', 90); await sub(1, 1, 'Norte', 30); await sub(2, 1, 'Sur', 60);
    await cycle(1, 1, { subN: 1, area: 30 }); await cycle(2, 1, { subN: 2, area: 60 });
    await record(1, 1, { kg: 100, ha: 15, links: [[1, 5], [2, 10]] });                 // linked to both sublots
    await record(2, 1, { subN: 1, kg: 50, ha: 5, links: [[1, 5]] });
    await record(3, 1, { subN: 2, kg: 70, ha: 7 });                                     // legacy: no links, own columns
    const ids = async q => (await list({ pageSize: 50, ...q })).data.map(r => r.id).sort();
    assert.deepEqual(await ids({ campaign_id: CAMPAIGN, crop_id: CROP_SOY, sub_lot_id: SUB(1) }), [REC(1), REC(2)].sort());
    assert.deepEqual(await ids({ campaign_id: CAMPAIGN, crop_id: CROP_SOY, sub_lot_id: SUB(2) }), [REC(1), REC(3)].sort());
    assert.deepEqual(await ids({ campaign_id: CAMPAIGN, crop_id: CROP_SOY, lot_id: LOT(1) }), [REC(1), REC(2), REC(3)].sort());
    assert.deepEqual(await ids({ campaign_id: uid(777) }), []);
    assert.equal((await list({ campaign_id: CAMPAIGN, crop_id: CROP_SOY, sub_lot_id: SUB(1) })).pagination.total, 2);
    assert.equal((await list({})).pagination.total, 3); // existing behaviour without filters is untouched
    await assert.rejects(list({ crop_id: 'x' }), /inválido/);
  } finally { await db.close(); }
});

test('listHarvestRecords: los filtros por id no cruzan empresas ni cuentan deshabilitadas', async () => {
  const { db, lot, cycle, record, list } = await listHarness();
  try {
    await lot(1, 'A1', 10); await cycle(1, 1, { area: 10 });
    await record(1, 1, { kg: 10, ha: 10, links: [[1, 10]] });
    await record(2, 1, { kg: 10, ha: 10, links: [[1, 10]], enabled: false });
    await lot(2, 'B1', 10, B); await cycle(2, 2, { area: 10, company: B });
    await record(3, 2, { kg: 10, ha: 10, company: B, links: [[2, 10]] });
    const out = await list({ campaign_id: CAMPAIGN, crop_id: CROP_SOY });
    assert.deepEqual(out.data.map(r => r.id), [REC(1)]);
  } finally { await db.close(); }
});

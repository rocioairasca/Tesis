// FIN-01B: real costs from Planning economic snapshots inside "Resultados por lote".
// Isolated PGlite with synthetic data. The economic tables below mirror the columns of migration 20261105 that the
// read model uses; the migration itself is not applied here (its triggers need a full Planning history fixture).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.HARVEST_TEST_PGLITE || '@electric-sql/pglite');
const results = require('../services/harvestResults');

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = uid(1), B = uid(2);
const CAMPAIGN = uid(100), OTHER_CAMPAIGN = uid(103), SOY = uid(101), CORN = uid(102);
const LOT = n => uid(200 + n), SUB = n => uid(300 + n), CYCLE = n => uid(400 + n), REC = n => uid(500 + n), PLAN = n => uid(600 + n), SNAP = n => uid(700 + n), LINE = n => uid(800 + n);
const econ = { company_id: A, id: uid(9), role: 3 };                                    // role 3 = all permissions
const economicReader = { company_id: A, id: uid(9), role: 0, custom_permissions: ['harvest.view', 'planning.view', 'inventory.view'] };
const harvestOnly = { company_id: A, id: uid(9), role: 0, custom_permissions: ['harvest.view'] };

async function setup() {
  const db = new PGlite();
  await db.exec(`
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
      effective_date date, activity_type_snapshot text, request_hash text DEFAULT 'secret-hash', idempotency_key text DEFAULT 'secret-key', created_txid bigint DEFAULT 99);
    CREATE TABLE economic_snapshot_lines(id uuid PRIMARY KEY, company_id uuid, snapshot_id uuid, kind text, cost_status text, amount_usd numeric(40,12),
      product_name_snapshot text, quantity numeric(20,6), unit_snapshot text);
    CREATE TABLE economic_snapshot_targets(id uuid PRIMARY KEY, company_id uuid, snapshot_id uuid, lot_id uuid, sub_lot_id uuid, beneficiary_crop_id uuid, allocation_weight numeric(20,12));
  `);
  for (const company of [A, B]) {
    const mine = company === A;
    await db.query("INSERT INTO campaigns VALUES($1,$2,'Gruesa 2026/27')", [mine ? CAMPAIGN : uid(110), company]);
    await db.query("INSERT INTO crops VALUES($1,$2,'Soja'),($3,$2,'Maíz')", [mine ? SOY : uid(111), company, mine ? CORN : uid(112)]);
  }
  await db.query("INSERT INTO campaigns VALUES($1,$2,'Fina 2027')", [OTHER_CAMPAIGN, A]);
  const pool = { query: (sql, args = []) => db.query(sql, args) };
  let lineSeq = 0, targetSeq = 0;
  const api = {
    db, pool,
    lot: (n, name, area, company = A) => db.query('INSERT INTO lots VALUES($1,$2,$3,$4,$4)', [LOT(n), company, name, area]),
    sub: (n, lotN, name, area) => db.query('INSERT INTO sub_lots VALUES($1,$2,$3,$4,$5)', [SUB(n), A, LOT(lotN), name, area]),
    cycle: (n, lotN, { subN = null, crop = SOY, area, end = null, campaign = CAMPAIGN }) =>
      db.query('INSERT INTO crop_assignments VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [CYCLE(n), A, campaign, LOT(lotN), subN && SUB(subN), crop, area, end]),
    record: async (n, lotN, { subN = null, crop = SOY, campaign = CAMPAIGN, kg, ha, cycleN }) => {
      await db.query('INSERT INTO harvest_records(id,company_id,lot_id,sub_lot_id,crop_id,campaign_id,production_kg,harvested_area_ha) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [REC(n), A, LOT(lotN), subN && SUB(subN), crop, campaign, kg, ha]);
      if (cycleN) await db.query('INSERT INTO harvest_crop_assignments VALUES($1,$2,$3)', [REC(n), CYCLE(cycleN), ha]);
    },
    // A sealed economic snapshot: lines [{kind, amount (null = pending), name}], targets [{lotN, subN, crop, weight}].
    snapshot: async (n, planningN, { company = A, campaign = CAMPAIGN, revision = 1, supersedes = null, activity = 'Fumigación', date = '2027-01-10', lines = [], targets = [], enabled = true } = {}) => {
      await db.query('INSERT INTO planning VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [PLAN(planningN), company, enabled]);
      await db.query('INSERT INTO economic_snapshots(id,company_id,planning_id,revision,supersedes_id,campaign_id,effective_date,activity_type_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [SNAP(n), company, PLAN(planningN), revision, supersedes && SNAP(supersedes), campaign, date, activity]);
      for (const line of lines) {
        await db.query('INSERT INTO economic_snapshot_lines VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [LINE(++lineSeq), company, SNAP(n), line.kind || 'product', line.amount == null ? 'pending' : 'confirmed', line.amount ?? null, line.kind === 'labor' ? null : (line.name || 'Glifosato'), line.kind === 'labor' ? null : 10, line.kind === 'labor' ? null : 'L']);
      }
      for (const t of targets) {
        await db.query('INSERT INTO economic_snapshot_targets VALUES($1,$2,$3,$4,$5,$6,$7)',
          [uid(900 + ++targetSeq), company, SNAP(n), LOT(t.lotN), t.subN ? SUB(t.subN) : null, t.crop || SOY, t.weight ?? '1.000000000000']);
      }
    },
  };
  return api;
}
const run = (pool, query = {}, user = econ) => results.results(pool, { user, query });
const rowOf = (out, lotName) => out.data.find(r => r.lot.name === lotName);

test('costos de productos, de labor y ambos: se distinguen y se suman exacto', async () => {
  const { db, pool, lot, cycle, snapshot } = await setup();
  try {
    await lot(1, 'P', 10); await lot(2, 'L', 10); await lot(3, 'PL', 10);
    for (const n of [1, 2, 3]) await cycle(n, n, { area: 10 });
    await snapshot(1, 1, { lines: [{ amount: '1000.5' }, { amount: '500' }], targets: [{ lotN: 1 }] });
    await snapshot(2, 2, { lines: [{ kind: 'labor', amount: '300' }], targets: [{ lotN: 2 }] });
    await snapshot(3, 3, { lines: [{ amount: '100' }, { kind: 'labor', amount: '50.25' }], targets: [{ lotN: 3 }] });
    const out = await run(pool);
    assert.deepEqual([rowOf(out, 'P').costs.products_usd, rowOf(out, 'P').costs.labor_usd, rowOf(out, 'P').costs.known_total_usd], ['1500.500000', null, '1500.500000']);
    assert.deepEqual([rowOf(out, 'L').costs.products_usd, rowOf(out, 'L').costs.labor_usd, rowOf(out, 'L').costs.known_total_usd], [null, '300.000000', '300.000000']);
    assert.deepEqual([rowOf(out, 'PL').costs.products_usd, rowOf(out, 'PL').costs.labor_usd, rowOf(out, 'PL').costs.known_total_usd], ['100.000000', '50.250000', '150.250000']);
    assert.ok(out.data.every(r => r.costs.status === 'partial' && r.costs.is_minimum === true)); // never "complete" in FIN-01B
    assert.equal(out.summary.known_cost_usd, '1950.750000');
  } finally { await db.close(); }
});

test('línea pendiente no es cero; cero confirmado sí es conocido', async () => {
  const { db, pool, lot, cycle, snapshot } = await setup();
  try {
    for (const [n, name] of [[1, 'Mixto'], [2, 'Solo pendiente'], [3, 'Cero']]) { await lot(n, name, 10); await cycle(n, n, { area: 10 }); }
    await snapshot(1, 1, { lines: [{ amount: '100' }, { amount: null }], targets: [{ lotN: 1 }] });
    await snapshot(2, 2, { lines: [{ amount: null }, { kind: 'labor', amount: null }], targets: [{ lotN: 2 }] });
    await snapshot(3, 3, { lines: [{ amount: '0' }], targets: [{ lotN: 3 }] });
    const out = await run(pool);
    const mixed = rowOf(out, 'Mixto').costs, pending = rowOf(out, 'Solo pendiente').costs, zero = rowOf(out, 'Cero').costs;
    assert.deepEqual([mixed.status, mixed.known_total_usd, mixed.pending_lines, mixed.is_minimum], ['partial', '100.000000', 1, true]);
    assert.deepEqual([pending.status, pending.known_total_usd, pending.products_usd, pending.labor_usd, pending.per_ha_usd, pending.per_tn_usd, pending.pending_lines, pending.is_minimum],
      ['pending', null, null, null, null, null, 2, false]);
    assert.deepEqual([zero.status, zero.known_total_usd, zero.products_usd, zero.per_ha_usd, zero.is_minimum], ['partial', '0.000000', '0.000000', '0.000000', true]);
    assert.equal(out.summary.lots_without_known_cost, 1); assert.equal(out.summary.incomplete_lots, 3);
  } finally { await db.close(); }
});

test('solo la última revisión de cada Planning cuenta; la supersedida se excluye', async () => {
  const { db, pool, lot, cycle, snapshot } = await setup();
  try {
    await lot(1, 'R', 10); await cycle(1, 1, { area: 10 });
    await snapshot(1, 1, { revision: 1, lines: [{ amount: '100' }, { amount: null }], targets: [{ lotN: 1 }] });
    await snapshot(2, 1, { revision: 2, supersedes: 1, lines: [{ amount: '100' }, { amount: '150' }], targets: [{ lotN: 1 }] });
    const row = rowOf(await run(pool), 'R').costs;
    assert.equal(row.known_total_usd, '250.000000'); // not 100 + 100 + 150
    assert.equal(row.pending_lines, 0);              // the pending line belonged to the superseded revision
  } finally { await db.close(); }
});

test('Planning multilote se reparte exacto con allocation_weight aplicado una sola vez', async () => {
  const { db, pool, lot, cycle, snapshot } = await setup();
  try {
    for (const n of [1, 2, 3]) { await lot(n, `M${n}`, 10); await cycle(n, n, { area: 10 }); }
    await snapshot(1, 1, { lines: [{ amount: '1000' }, { kind: 'labor', amount: '333.333333333333' }],
      targets: [{ lotN: 1, weight: '0.333333333333' }, { lotN: 2, weight: '0.333333333333' }, { lotN: 3, weight: '0.333333333334' }] });
    const out = await run(pool);
    // 1000 x 0.333333333334 = 333.333333334: the 6-decimal presentation rounds it to 333.333333 (the exact total below is still 1000).
    assert.deepEqual(out.data.map(r => r.costs.products_usd), ['333.333333', '333.333333', '333.333333']);
    assert.equal(out.summary.known_cost_usd, '1333.333333'); // exact total, not a sum of rounded rows
    assert.equal(rowOf(out, 'M3').costs.labor_usd, '111.111111');
  } finally { await db.close(); }
});

test('lote + sublote: costo de nivel lote queda en el padre, el de sublote suma al padre, sin doble conteo', async () => {
  const { db, pool, lot, sub, cycle, snapshot } = await setup();
  try {
    await lot(1, 'T6', 100); await sub(1, 1, 'A', 40); await sub(2, 1, 'B', 40);
    await cycle(1, 1, { area: 20 }); await cycle(2, 1, { subN: 1, area: 40 }); await cycle(3, 1, { subN: 2, area: 40 });
    await snapshot(1, 1, { lines: [{ amount: '400' }], targets: [{ lotN: 1 }] });                                   // whole lot
    await snapshot(2, 2, { lines: [{ amount: '100' }, { amount: null }], targets: [{ lotN: 1, subN: 1 }] });         // sublot A
    await snapshot(3, 3, { lines: [{ amount: '60' }, { amount: null }], targets: [{ lotN: 1, subN: 1, weight: '0.5' }, { lotN: 1, subN: 2, weight: '0.5' }] });
    const out = await run(pool);
    const parent = out.data[0];
    const [a, b] = parent.children;
    assert.equal(parent.costs.known_total_usd, '560.000000');    // 400 (lot) + 100 + 30 + 30 = 560 (A: 130, B: 30)
    assert.equal(a.costs.known_total_usd, '130.000000'); assert.equal(b.costs.known_total_usd, '30.000000');
    assert.equal(a.costs.pending_lines, 2); assert.equal(b.costs.pending_lines, 1);
    assert.equal(parent.costs.pending_lines, 2);                // distinct lines: the shared pending line counts once (plus snapshot 2)
    assert.equal(Number(a.costs.known_total_usd) + Number(b.costs.known_total_usd) + 400, Number(parent.costs.known_total_usd)); // children + lot-level = parent
    // The summary never adds parent + children as independent facts: it equals the original evidence once (400 + 100 + 60).
    assert.equal(out.data.length, 1); assert.equal(out.summary.known_cost_usd, '560.000000'); assert.equal(out.summary.results, 1);
    const flat = await run(pool, { sub_lot_id: SUB(1) });                    // children promoted to top level: 100 + 30, no lot-level cost
    assert.equal(flat.summary.known_cost_usd, '130.000000');
    const onlyB = (await run(pool, { sub_lot_id: SUB(2) })).data[0];
    assert.equal(onlyB.costs.known_total_usd, '30.000000'); // the lot-level 400 is never spread over sublots
  } finally { await db.close(); }
});

test('cosechas parciales no multiplican gastos y costo/tn sale del costo conocido y la producción total', async () => {
  const { db, pool, lot, cycle, record, snapshot } = await setup();
  try {
    await lot(1, 'T2', 54.5); await cycle(1, 1, { area: 54.5 });
    for (const [n, kg, ha] of [[1, 100000, 20], [2, 150000, 20], [3, 186000, 14.5]]) await record(n, 1, { kg, ha, cycleN: 1 });
    await snapshot(1, 1, { lines: [{ amount: '3980' }, { kind: 'labor', amount: '1440' }], targets: [{ lotN: 1 }] });
    const open = rowOf(await run(pool), 'T2');
    assert.equal(open.records_count, 3); assert.equal(open.costs.known_total_usd, '5420.000000'); // once, not x3
    assert.equal(open.costs.per_ha_usd, '99.449541');         // 5420 / 54.5 ha (surface of the lot, not of the labors)
    assert.equal(open.costs.per_tn_usd, '12.431193');         // 5420 / 436 t
    assert.deepEqual([open.costs.is_minimum, open.costs.is_provisional, open.harvest_status], [true, true, 'in_progress']);
    await db.query("UPDATE crop_assignments SET end_date = '2027-05-01'");
    const closed = rowOf(await run(pool), 'T2');
    assert.deepEqual([closed.costs.is_minimum, closed.costs.is_provisional, closed.harvest_status], [true, false, 'closed']);
  } finally { await db.close(); }
});

test('una hectárea trabajada cinco veces sigue siendo una hectárea del lote', async () => {
  const { db, pool, lot, cycle, snapshot } = await setup();
  try {
    await lot(1, 'H', 10); await cycle(1, 1, { area: 10 });
    for (let n = 1; n <= 5; n++) await snapshot(n, n, { lines: [{ amount: '20' }], targets: [{ lotN: 1 }] });
    const costs = rowOf(await run(pool), 'H').costs;
    assert.equal(costs.known_total_usd, '100.000000'); assert.equal(costs.per_ha_usd, '10.000000'); // 100 / 10 ha, not 100 / 50 ha
  } finally { await db.close(); }
});

test('sin cosecha: costo/tn null; el lote aparece solo por costos imputados', async () => {
  const { db, pool, lot, snapshot } = await setup();
  try {
    await lot(1, 'SoloCosto', 25);                                           // no cycle, no harvest
    await snapshot(1, 1, { lines: [{ amount: '250' }], targets: [{ lotN: 1 }] });
    const row = (await run(pool)).data[0];
    assert.equal(row.production_kg, null); assert.equal(row.records_count, 0); assert.equal(row.surface_ha, '25.00'); assert.equal(row.surface_source, 'surface_fallback');
    assert.deepEqual([row.costs.known_total_usd, row.costs.per_ha_usd, row.costs.per_tn_usd, row.costs.is_provisional], ['250.000000', '10.000000', null, false]);
  } finally { await db.close(); }
});

test('la clave económica debe coincidir explícitamente: otra campaña u otro cultivo no se asocian', async () => {
  const { db, pool, lot, cycle, record, snapshot } = await setup();
  try {
    await lot(1, 'K', 10); await cycle(1, 1, { area: 10 }); await record(1, 1, { kg: 1000, ha: 10, cycleN: 1 });
    await snapshot(1, 1, { campaign: OTHER_CAMPAIGN, lines: [{ amount: '70' }], targets: [{ lotN: 1 }] });
    await snapshot(2, 2, { lines: [{ amount: '30' }], targets: [{ lotN: 1, crop: CORN }] });
    const out = await run(pool);
    assert.equal(out.data.length, 3);
    const mine = out.data.find(r => r.campaign.id === CAMPAIGN && r.crop.id === SOY);
    assert.equal(mine.costs.status, 'pending'); assert.equal(mine.costs.known_total_usd, null);
    assert.equal(out.data.find(r => r.campaign.id === OTHER_CAMPAIGN).costs.known_total_usd, '70.000000');
    assert.equal(out.data.find(r => r.crop.id === CORN).costs.known_total_usd, '30.000000');
    assert.equal((await run(pool, { campaign: 'Fina 2027' })).data.length, 1);
    assert.equal((await run(pool, { crop_id: CORN })).summary.known_cost_usd, '30.000000');
  } finally { await db.close(); }
});

test('aislamiento entre empresas y destino con peso cero', async () => {
  const { db, pool, lot, cycle, snapshot } = await setup();
  try {
    await lot(1, 'Mia', 10); await cycle(1, 1, { area: 10 }); await lot(2, 'Ajena', 10, B);
    await snapshot(1, 1, { lines: [{ amount: '50' }], targets: [{ lotN: 1 }] });
    await snapshot(2, 2, { company: B, lines: [{ amount: '999' }], targets: [{ lotN: 2 }] });
    await snapshot(4, 4, { lines: [{ amount: '5000' }], targets: [{ lotN: 1, weight: '0' }] });
    const out = await run(pool);
    assert.equal(out.summary.known_cost_usd, '50.000000'); assert.deepEqual(out.data.map(r => r.lot.name), ['Mia']);
    assert.equal((await run(pool, {}, { company_id: B, id: uid(8), role: 3 })).summary.known_cost_usd, '999.000000');
  } finally { await db.close(); }
});

test('permisos: harvest.view solo devuelve producción; planning.view + inventory.view habilita costos', async () => {
  const { db, pool, lot, cycle, snapshot } = await setup();
  try {
    await lot(1, 'X', 10); await cycle(1, 1, { area: 10 });
    await snapshot(1, 1, { lines: [{ amount: '123.45' }], targets: [{ lotN: 1 }] });
    const plain = await run(pool, {}, harvestOnly);
    assert.equal(plain.data.length, 1); assert.equal(plain.data[0].costs, null); assert.equal(plain.summary.cost_access, false);
    assert.equal(JSON.stringify(plain).includes('123.45'), false); assert.equal('known_cost_usd' in plain.summary, false);
    const reader = await run(pool, {}, economicReader);
    assert.equal(reader.summary.cost_access, true); assert.equal(reader.data[0].costs.known_total_usd, '123.450000');
    const half = await run(pool, {}, { ...harvestOnly, custom_permissions: ['harvest.view', 'planning.view'] });
    assert.equal(half.data[0].costs, null);   // both economic permissions are required
    const off = await run(pool, {}, { ...economicReader, enabled: false });
    assert.equal(off.data[0].costs, null);
  } finally { await db.close(); }
});

test('paginación y summary global con costos; la página no cambia los totales', async () => {
  const { db, pool, lot, cycle, snapshot } = await setup();
  try {
    for (let n = 1; n <= 4; n++) { await lot(n, `L${n}`, 10); await cycle(n, n, { area: 10 }); await snapshot(n, n, { lines: [{ amount: String(n * 10) }], targets: [{ lotN: n }] }); }
    const first = await run(pool, { page: 1, pageSize: 2 }), last = await run(pool, { page: 2, pageSize: 2 });
    assert.deepEqual(first.data.map(r => r.costs.known_total_usd), ['10.000000', '20.000000']);
    assert.deepEqual(last.data.map(r => r.costs.known_total_usd), ['30.000000', '40.000000']);
    assert.equal(first.summary.known_cost_usd, '100.000000'); assert.equal(last.summary.known_cost_usd, '100.000000');
    assert.equal(first.summary.incomplete_lots, 4);
    assert.equal(Object.keys(first.summary).some(key => /average|avg|promedio|complete_cost/i.test(key)), false);
  } finally { await db.close(); }
});

test('detalle: desglose por Planning con líneas, sin campos internos, y sin acceso solo producción', async () => {
  const { db, pool, lot, cycle, record, snapshot } = await setup();
  try {
    await lot(1, 'D', 20); await cycle(1, 1, { area: 20 }); await record(1, 1, { kg: 40000, ha: 10, cycleN: 1 });
    await snapshot(1, 1, { activity: 'Siembra', date: '2027-01-05', lines: [{ amount: '200', name: 'Semilla' }, { kind: 'labor', amount: '80' }], targets: [{ lotN: 1 }] });
    await snapshot(2, 2, { activity: 'Fumigación', date: '2027-02-01', lines: [{ amount: '60', name: 'Glifosato' }, { amount: null, name: 'Coadyuvante' }], targets: [{ lotN: 1 }] });
    const query = { lot_id: LOT(1), campaign_id: CAMPAIGN, crop_id: SOY };
    const out = await results.detail(pool, { user: econ, query });
    assert.equal(out.cost_access, true); assert.equal(out.production_kg, '40000.00'); assert.equal(out.records_count, 1);
    assert.deepEqual(out.records_query, { campaign_id: CAMPAIGN, crop_id: SOY, lot_id: LOT(1) });
    assert.equal(out.costs.known_total_usd, '340.000000'); assert.equal(out.costs.pending_lines, 1);
    assert.deepEqual(out.cost_detail.plannings.map(p => [p.activity, p.effective_date, p.known_usd, p.pending_lines]), [['Fumigación', '2027-02-01', '60.000000', 1], ['Siembra', '2027-01-05', '280.000000', 0]]);
    const sowing = out.cost_detail.plannings[1];
    assert.deepEqual([sowing.products_usd, sowing.labor_usd], ['200.000000', '80.000000']);
    assert.ok(sowing.lines.some(l => l.kind === 'labor' && l.amount_usd === '80.000000') && sowing.lines.some(l => l.name === 'Semilla'));
    assert.ok(out.cost_detail.plannings[0].lines.some(l => l.pending === true && l.amount_usd === null));
    assert.match(out.cost_detail.note, /Pueden existir otros gastos aún no imputados/);
    const text = JSON.stringify(out);
    for (const secret of ['request_hash', 'secret-hash', 'idempotency_key', 'secret-key', 'txid', 'created_txid']) assert.equal(text.includes(secret), false, secret);
    const plain = await results.detail(pool, { user: harvestOnly, query });
    assert.equal(plain.cost_access, false); assert.equal(plain.costs, null); assert.equal('cost_detail' in plain, false); assert.equal(plain.production_kg, '40000.00');
    await assert.rejects(results.detail(pool, { user: econ, query: { lot_id: LOT(1) } }), /obligatorio/);
    await assert.rejects(results.detail(pool, { user: econ, query: { ...query, lot_id: LOT(9) } }), /no encontrado/);
  } finally { await db.close(); }
});

test('invariante: la suma de las filas coincide con el total de los snapshots vigentes', async () => {
  const { db, pool, lot, sub, cycle, record, snapshot } = await setup();
  try {
    await lot(1, 'I1', 60); await sub(1, 1, 'N', 30); await sub(2, 1, 'S', 30); await lot(2, 'I2', 20);
    await cycle(1, 1, { subN: 1, area: 30 }); await cycle(2, 1, { subN: 2, area: 30 }); await cycle(3, 2, { area: 20 });
    for (let n = 1; n <= 3; n++) await record(n, 1, { subN: n === 3 ? 2 : 1, kg: 1000 * n, ha: 5, cycleN: n === 3 ? 2 : 1 });
    await snapshot(1, 1, { lines: [{ amount: '777.777777' }, { kind: 'labor', amount: '10.5' }], targets: [{ lotN: 1, subN: 1, weight: '0.6' }, { lotN: 1, subN: 2, weight: '0.4' }] });
    await snapshot(2, 2, { lines: [{ amount: '12.345678' }], targets: [{ lotN: 2 }] });
    await snapshot(3, 2, { revision: 2, supersedes: 2, lines: [{ amount: '12.345678' }, { amount: '1' }], targets: [{ lotN: 2 }] });
    const out = await run(pool);
    const expected = 777.777777 + 10.5 + 12.345678 + 1;
    assert.ok(Math.abs(Number(out.summary.known_cost_usd) - expected) < 1e-6);
    const parent = rowOf(out, 'I1');
    assert.ok(Math.abs(parent.children.reduce((n, c) => n + Number(c.costs.known_total_usd), 0) - Number(parent.costs.known_total_usd)) < 1e-5);
    assert.equal(out.summary.records, 3);
  } finally { await db.close(); }
});

test('Planning deshabilitada después de ejecutarse: su costo sigue contando una sola vez y el total no cambia', async () => {
  const { db, pool, lot, sub, cycle, record, snapshot } = await setup();
  try {
    await lot(1, 'DIS', 40); await sub(1, 1, 'A', 20); await cycle(1, 1, { area: 40 }); await cycle(2, 1, { subN: 1, area: 20 });
    await record(1, 1, { kg: 80000, ha: 10, cycleN: 1 });
    await snapshot(1, 1, { activity: 'Siembra', lines: [{ amount: '900' }, { kind: 'labor', amount: '100' }], targets: [{ lotN: 1 }] });            // confirmed, will be disabled
    await snapshot(2, 2, { activity: 'Fumigación', lines: [{ amount: '60' }], targets: [{ lotN: 1, subN: 1 }] });                              // stays enabled
    const query = { lot_id: LOT(1), campaign_id: CAMPAIGN, crop_id: SOY };
    const before = await run(pool), detailBefore = await results.detail(pool, { user: econ, query });
    assert.equal(before.summary.known_cost_usd, '1060.000000'); assert.equal(before.data[0].costs.known_total_usd, '1060.000000');
    assert.equal(detailBefore.cost_detail.plannings.every(p => p.planning_enabled === true), true);

    await db.query('UPDATE planning SET enabled = false WHERE id = $1', [PLAN(1)]);   // soft-disable: visibility, not an economic reversal

    const after = await run(pool), detailAfter = await results.detail(pool, { user: econ, query });
    assert.equal(after.summary.known_cost_usd, '1060.000000');                         // total unchanged
    assert.equal(after.data[0].costs.known_total_usd, '1060.000000');                  // counted exactly once (not 0, not 2120)
    assert.equal(after.data[0].costs.products_usd, '960.000000'); assert.equal(after.data[0].costs.labor_usd, '100.000000');
    assert.deepEqual(after.data[0].costs, before.data[0].costs);                       // every figure identical
    assert.equal(detailAfter.costs.known_total_usd, '1060.000000');
    const sowing = detailAfter.cost_detail.plannings.find(p => p.activity === 'Siembra'), spray = detailAfter.cost_detail.plannings.find(p => p.activity === 'Fumigación');
    assert.equal(sowing.planning_enabled, false); assert.equal(sowing.known_usd, '1000.000000'); // the detail informs it is currently disabled
    assert.equal(spray.planning_enabled, true);
    assert.equal(detailAfter.cost_detail.plannings.length, 2);
    // Disabling even the other Planning changes nothing either; only an explicit economic void (future) may retire a cost.
    await db.query('UPDATE planning SET enabled = false');
    assert.equal((await run(pool)).summary.known_cost_usd, '1060.000000');
  } finally { await db.close(); }
});

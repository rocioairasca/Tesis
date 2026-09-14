// Isolated PostgreSQL (PGlite), never connects to Supabase. No project dependency changes.
// Set HARVEST_TEST_PGLITE to the absolute path of a temporary @electric-sql/pglite install.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PGlite } = require(process.env.HARVEST_TEST_PGLITE || '@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260908_add_partial_harvests.sql'), 'utf8');
const precision = fs.readFileSync(path.join(__dirname, '../migrations/20260908_normalize_harvest_area_precision.sql'), 'utf8');
const company = '00000000-0000-0000-0000-000000000001';
const actor = '00000000-0000-0000-0000-000000000002';
const lot = '00000000-0000-0000-0000-000000000003';
const crop = '00000000-0000-0000-0000-000000000004';
const campaign = '00000000-0000-0000-0000-000000000005';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE companies(id uuid PRIMARY KEY);
    CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE campaigns(id uuid PRIMARY KEY,company_id uuid,name text,start_date date,end_date date,status text);
    CREATE TABLE crops(id uuid PRIMARY KEY,company_id uuid,name text,enabled boolean DEFAULT true);
    CREATE TABLE lots(id uuid PRIMARY KEY,company_id uuid,name text,area_ha numeric,area numeric,geom numeric,enabled boolean DEFAULT true);
    CREATE TABLE lot_layouts(id uuid PRIMARY KEY,company_id uuid,lot_id uuid,status text);
    CREATE TABLE sub_lots(id uuid PRIMARY KEY,company_id uuid,lot_id uuid,layout_id uuid,name text,area_ha numeric,geom numeric,enabled boolean DEFAULT true);
    CREATE TABLE crop_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies,
      campaign_id uuid,lot_id uuid,sub_lot_id uuid,crop_id uuid,start_date date NOT NULL,end_date date,
      area_ha numeric(12,4) NOT NULL CHECK(area_ha>0),source_planning_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE harvest_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies,
      lot_id uuid,sub_lot_id uuid,crop_id uuid,crop text,campaign_id uuid,campaign text NOT NULL CHECK(campaign ~ '^[0-9]{4}-[0-9]{4}$'),harvest_date date,
      production_kg numeric(14,2),harvested_area_ha numeric(10,2) CHECK(harvested_area_ha>0),
      yield_kg_ha numeric(12,2) GENERATED ALWAYS AS(round(production_kg/harvested_area_ha,2)) STORED,
      notes text,created_by uuid,enabled boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE harvest_crop_assignments(harvest_id uuid REFERENCES harvest_records ON DELETE RESTRICT,
      crop_assignment_id uuid REFERENCES crop_assignments ON DELETE RESTRICT,created_at timestamptz DEFAULT now(),PRIMARY KEY(harvest_id,crop_assignment_id));
    CREATE UNIQUE INDEX harvest_crop_assignments_assignment_unique ON harvest_crop_assignments(crop_assignment_id);
    INSERT INTO companies VALUES('${company}'); INSERT INTO users VALUES('${actor}');
    INSERT INTO campaigns VALUES('${campaign}','${company}','Campaña','2026-01-01',NULL,'active');
    INSERT INTO crops VALUES('${crop}','${company}','Soja',true);
    INSERT INTO lots VALUES('${lot}','${company}','Lote',68.29,68.29,1,true);
  `);
  // Spatial fixture models a single whole lot; production geometry is not touched.
  await db.exec(`CREATE DOMAIN geography AS numeric;
    CREATE FUNCTION st_makevalid(numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS 'SELECT $1';
    CREATE FUNCTION st_collectionextract(numeric,integer) RETURNS numeric LANGUAGE sql IMMUTABLE AS 'SELECT $1';
    CREATE FUNCTION st_intersection(numeric,numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS 'SELECT 100';
    CREATE FUNCTION st_difference(numeric,numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS 'SELECT 0';
    CREATE FUNCTION st_area(numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS 'SELECT $1';`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20260909_harvest_registration_trace.sql'), 'utf8'));
  const pool = { query: (sql, args = []) => db.query(sql, args), connect: async () => ({ query: (sql, args = []) => db.query(sql, args), release() {} }) };
  const filename = path.join(__dirname, '../controllers/harvestRecords.js');
  const realRequire = createRequire(filename);
  const sandbox = { exports: {}, require: (name) => name === '../db/supabaseClient' ? { pool } : realRequire(name), console, Date };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const call = async (method, body = {}, params = {}) => {
    let result, error;
    const res = { status() { return this; }, json(value) { result = value; return value; } };
    await sandbox.exports[method]({ body, params, query: body, user: { company_id: company, id: actor } }, res, (e) => { error = e; });
    if (error) throw error;
    return result;
  };
  const addCycle = async (area = '68.29', endDate = null) => (await db.query(`INSERT INTO crop_assignments(company_id,campaign_id,lot_id,crop_id,start_date,end_date,area_ha)
    VALUES($1,$2,$3,$4,'2026-01-01',$5,$6) RETURNING *`, [company,campaign,lot,crop,endDate,area])).rows[0];
  const harvest = (area, date) => call('createHarvestRecord', { registered_retroactively: true, retroactive_reason: 'pending_record', lot_id: lot, crop_id: crop, harvest_date: date, harvested_area_ha: area, production_kg: 100 });
  return { db, call, addCycle, harvest };
}

test('campañas: nombre real, orden por fecha, IDs separados y filtros compatibles', async()=>{
 const {db,call}=await setup();
 try {
  const second='00000000-0000-0000-0000-000000000006';
  const third='00000000-0000-0000-0000-000000000007';
  await db.query("UPDATE campaigns SET name='Gruesa', start_date='2025-10-01', end_date='2026-05-31' WHERE id=$1",[campaign]);
  await db.query("INSERT INTO campaigns(id,company_id,name,start_date,end_date) VALUES($1,$2,'Especial','2026-10-01','2027-05-31'),($3,$2,'Gruesa','2027-10-01','2028-05-31')",[second,company,third]);
  for(const [id,amount] of [[campaign,120000],[second,180000],[third,10000]]) {
   await db.query("INSERT INTO harvest_records(company_id,lot_id,crop_id,crop,campaign_id,campaign,harvest_date,production_kg,harvested_area_ha) VALUES($1,$2,$3,'soja',$4,'2026-2027','2026-12-01',$5,10)",[company,lot,crop,id,amount]);
  }
  const rows=await call('getHarvestStatsByCampaign');
  assert.equal(rows.length,3);
  assert.equal(JSON.stringify(rows.map(r=>[r.campaign_id,r.campaign])),JSON.stringify([[campaign,'Gruesa'],[second,'Especial'],[third,'Gruesa']]));
  assert.equal(Number(rows[0].production_kg),120000);
  const filters=await call('getHarvestStatsFilters');
  assert.equal(filters.campaign_details[0].campaign_id,third);
  assert.equal(filters.campaigns[1],'Especial');
  const byCrop=await call('getHarvestStatsByCrop',{campaign:second});
  assert.equal(Number(byCrop[0].production_kg),180000);
  await db.query("UPDATE campaigns SET name='   ' WHERE id=$1",[second]);
  const fallback=await call('getHarvestStatsByCampaign');
  assert.equal(fallback.find(r=>r.campaign_id===second).campaign,'2026/27');
  assert.equal((await db.query('SELECT name FROM campaigns WHERE id=$1',[second])).rows[0].name,'   ');
 } finally {await db.close();}
});

test('migration, sequential partials, excess rollback, disable/enable and update recalculate', async () => {
  const { db, call, addCycle, harvest } = await setup();
  try {
    await db.exec(migration);
    const cycle = await addCycle('68.2926');
    assert.equal(cycle.area_ha, '68.2900');
    const first = await harvest('20', '2026-06-10');
    await harvest('30', '2026-06-15');
    assert.equal((await db.query('SELECT end_date FROM crop_assignments')).rows[0].end_date, null);
    await assert.rejects(harvest('20', '2026-06-20'), /pendiente/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM harvest_records')).rows[0].n, 2);
    const last = await harvest('18.29', '2026-06-20');
    assert.equal((await db.query('SELECT harvest_closure_source FROM crop_assignments')).rows[0].harvest_closure_source, 'automatic');
    await call('disableHarvestRecord', {}, { id: last.id });
    assert.equal((await db.query('SELECT end_date FROM crop_assignments')).rows[0].end_date, null);
    await call('enableHarvestRecord', {}, { id: last.id });
    await call('updateHarvestRecord', { harvested_area_ha: '19', production_kg: 100 }, { id: first.id });
    assert.equal((await db.query('SELECT end_date FROM crop_assignments')).rows[0].end_date, null);
    await assert.rejects(call('updateHarvestRecord', { harvested_area_ha: '21', production_kg: 100 }, { id: first.id }), /pendiente/);
    await db.exec(precision);
    assert.equal((await db.query("SELECT numeric_scale FROM information_schema.columns WHERE table_name='crop_assignments' AND column_name='area_ha'")).rows[0].numeric_scale, 2);
  } finally { await db.close(); }
});

test('out of order closes on 20 June; reopening with later cycle rolls back', async () => {
  const { db, call, addCycle, harvest } = await setup();
  try {
    await db.exec(migration); await addCycle();
    const first = await harvest('20', '2026-06-20');
    await harvest('30', '2026-06-10'); await harvest('18.29', '2026-06-15');
    assert.equal((await db.query('SELECT end_date::text FROM crop_assignments')).rows[0].end_date, '2026-06-20');
    await db.query(`INSERT INTO crop_assignments(company_id,campaign_id,lot_id,crop_id,start_date,area_ha) VALUES($1,$2,$3,$4,'2026-07-01',68.29)`, [company,campaign,lot,crop]);
    await assert.rejects(call('disableHarvestRecord', {}, { id: first.id }), /superpone/);
    assert.equal((await db.query('SELECT enabled FROM harvest_records WHERE id=$1', [first.id])).rows[0].enabled, true);
  } finally { await db.close(); }
});

test('manual finalization stores reason, actor and 8.29 pending snapshot; new harvest rejected', async () => {
  const { db, call, addCycle, harvest } = await setup();
  try {
    await db.exec(migration); const cycle = await addCycle();
    await harvest('60', '2026-06-10');
    await assert.rejects(call('finalizeHarvestCycle', { finalized_date: '2026-06-09', reason: 'weather' }, { assignmentId: cycle.id }), /anterior/);
    const closure = await call('finalizeHarvestCycle', { finalized_date: '2026-06-20', reason: 'weather' }, { assignmentId: cycle.id });
    assert.equal(closure.total_area_ha, '68.29'); assert.equal(closure.harvested_area_ha, '60.00');
    assert.equal(closure.remaining_area_ha, '8.29'); assert.equal(closure.created_by, actor);
    assert.equal((await db.query('SELECT harvest_closure_source FROM crop_assignments')).rows[0].harvest_closure_source, 'manual');
    await assert.rejects(harvest('8.29', '2026-06-15'), /finalizado/);
  } finally { await db.close(); }
});

test('legacy closures and quantities preserved; unsafe precision migration aborts', async () => {
  const { db, call, addCycle } = await setup();
  try {
    const cycle = await addCycle('19.8314', '2026-05-01');
    const { rows: [record] } = await db.query(`INSERT INTO harvest_records(company_id,lot_id,crop_id,crop,campaign_id,campaign,harvest_date,harvested_area_ha,production_kg)
      VALUES($1,$2,$3,'soja',$4,'2026-2026','2026-05-01',20,100) RETURNING id`, [company,lot,crop,campaign]);
    await db.query('INSERT INTO harvest_crop_assignments(harvest_id,crop_assignment_id) VALUES($1,$2)', [record.id,cycle.id]);
    await db.exec(migration);
    assert.equal((await db.query('SELECT harvested_area_ha FROM harvest_crop_assignments')).rows[0].harvested_area_ha, '20.00');
    await assert.rejects(call('disableHarvestRecord', {}, { id: record.id }), /legacy/);
    await call('updateHarvestRecord', { harvested_area_ha: '20', production_kg: 110 }, { id: record.id });
    await assert.rejects(db.exec(precision), /STOP/);
    await db.exec('ROLLBACK');
    const row = (await db.query('SELECT end_date::text,area_ha,harvest_closure_source FROM crop_assignments')).rows[0];
    assert.equal(row.end_date, '2026-05-01'); assert.equal(row.area_ha, '19.8314'); assert.equal(row.harvest_closure_source, 'legacy');
  } finally { await db.close(); }
});

test('reactivation rejects when another journey consumed the available area', async () => {
  const { db, call, addCycle, harvest } = await setup();
  try {
    await db.exec(migration); await addCycle();
    const first = await harvest('20', '2026-06-10');
    await call('disableHarvestRecord', {}, { id: first.id });
    await harvest('68.29', '2026-06-20');
    await assert.rejects(call('enableHarvestRecord', {}, { id: first.id }), /pendiente/);
    assert.equal((await db.query('SELECT enabled FROM harvest_records WHERE id=$1',[first.id])).rows[0].enabled, false);
  } finally { await db.close(); }
});

test('multiple assignments require a known allocation; each cycle counts only its share', async () => {
  const { db, call } = await setup();
  try {
    await db.exec(migration);
    const { rows: cycles } = await db.query(`INSERT INTO crop_assignments(company_id,campaign_id,lot_id,crop_id,start_date,area_ha)
      VALUES($1,$2,$3,$4,'2026-01-01',30),($1,$2,$3,$4,'2026-01-01',38.29) RETURNING *`, [company,campaign,lot,crop]);
    const body = { registered_retroactively: true, retroactive_reason: 'pending_record', lot_id: lot, crop_id: crop, harvest_date: '2026-06-10', production_kg: 100, harvested_area_ha: '20' };
    await assert.rejects(call('createHarvestRecord', body), /varios ciclos/);
    await call('createHarvestRecord', { ...body, allocations: cycles.map((a) => ({ crop_assignment_id: a.id, harvested_area_ha: '10' })) });
    assert.equal((await db.query('SELECT sum(harvested_area_ha)::text AS total FROM harvest_crop_assignments')).rows[0].total, '20.00');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crop_assignments WHERE end_date IS NULL')).rows[0].n, 2);
    await call('createHarvestRecord', { ...body, harvest_date: '2026-06-20', harvested_area_ha: '48.29' });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM crop_assignments WHERE harvest_closure_source='automatic'")).rows[0].n, 2);
  } finally { await db.close(); }
});

test('migration refuses ambiguous legacy allocation without changing schema or amounts', async () => {
  const { db, addCycle } = await setup();
  try {
    const a = await addCycle(), b = await addCycle();
    const { rows: [hr] } = await db.query(`INSERT INTO harvest_records(company_id,campaign,harvested_area_ha,production_kg) VALUES($1,'2026-2026',20,100) RETURNING id`,[company]);
    await db.query('INSERT INTO harvest_crop_assignments(harvest_id,crop_assignment_id) VALUES($1,$2),($1,$3)', [hr.id,a.id,b.id]);
    await assert.rejects(db.exec(migration), /multiple assignments/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='harvest_crop_assignments' AND column_name='harvested_area_ha'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('manual closure snapshot remains immutable after correcting or disabling a journey', async () => {
  const { db, call, addCycle, harvest } = await setup();
  try {
    await db.exec(migration); const cycle = await addCycle();
    const record = await harvest('60', '2026-06-10');
    await call('finalizeHarvestCycle', { finalized_date: '2026-06-20', reason: 'weather' }, { assignmentId: cycle.id });
    await call('updateHarvestRecord', { harvested_area_ha: '59', production_kg: 100 }, { id: record.id });
    await call('disableHarvestRecord', {}, { id: record.id });
    const row = (await db.query('SELECT remaining_area_ha FROM harvest_cycle_closures')).rows[0];
    assert.equal(row.remaining_area_ha, '8.29');
    assert.equal((await db.query('SELECT end_date::text FROM crop_assignments')).rows[0].end_date, '2026-06-20');
    await assert.rejects(db.query('UPDATE crop_assignments SET end_date=NULL,harvest_closure_source=NULL WHERE id=$1', [cycle.id]), /explicit harvest operation/);
  } finally { await db.close(); }
});


test('V1 registration persists provenance, rejects invalid requests and preserves unknown legacy', async () => {
  const { db, call, addCycle, harvest } = await setup();
  try {
    await db.exec(migration); const cycle = await addCycle();
    const base = { lot_id: lot, crop_id: crop, harvest_date: '2026-06-10', production_kg: 100, harvested_area_ha: '20', registered_retroactively: true };
    await assert.rejects(call('createHarvestRecord', base), /motivo/);
    await assert.rejects(call('createHarvestRecord', { ...base, retroactive_reason: 'other' }), /Otro/);
    await assert.rejects(call('createHarvestRecord', { ...base, harvest_date: '2099-01-01', retroactive_reason: 'pending_record' }), /futuras/);
    await assert.rejects(call('createHarvestRecord', { ...base, harvest_date: '2025-12-31', retroactive_reason: 'pending_record' }), /anterior/);
    const saved = await call('createHarvestRecord', { ...base, retroactive_reason: 'other', retroactive_notes: 'Cuaderno anterior' });
    assert.equal(saved.registered_retroactively,true); assert.equal(saved.retroactive_notes,'Cuaderno anterior'); assert.equal(saved.created_by,actor); assert.ok(saved.created_at);
    await assert.rejects(call('updateHarvestRecord', { harvested_area_ha: 20, production_kg: 100, registered_retroactively: false }, { id: saved.id }), /procedencia/);
    await harvest('10', '2026-06-15');
    await assert.rejects(call('finalizeHarvestCycle', { finalized_date: '2026-06-20' }, { assignmentId: cycle.id }), /motivo/);
    await call('finalizeHarvestCycle', { finalized_date: '2026-06-20', reason: 'weather' }, { assignmentId: cycle.id });
    await assert.rejects(call('finalizeHarvestCycle', { finalized_date: '2026-06-20', reason: 'weather' }, { assignmentId: cycle.id }), /cerrado/);
    // Exercise the real history controller. Unrelated Planning/usage sources are empty fixtures.
    const historyFile = path.join(__dirname, '../controllers/lots/history.js');
    const historyClient = { query: async (sql,args) => {
      if (sql.includes('FROM planning p') || sql.includes('FROM usage_records ur') || sql.includes('FROM crop_assignments ca')) return { rows: [] };
      if (sql.includes('l.id AS lot_id') && sql.includes('sl.id AS sub_lot_id')) return { rows: [{lot_id:lot,lot_name:'Lote'}] };
      return db.query(sql,args);
    }, release() {} };
    const historySandbox = {exports:{}, console, Date, require: () => ({pool:{connect:async()=>historyClient}})};
    vm.runInNewContext(fs.readFileSync(historyFile,'utf8'),historySandbox);
    let history, historyError;
    await historySandbox.exports.getLotHistory({user:{company_id:company},params:{lotId:lot},query:{}}, {json:r=>{history=r.data;}}, e=>{historyError=e;});
    if(historyError) throw historyError;
    assert.equal(history.filter(e=>e.type==='harvest').length,2);
    assert.equal(history.filter(e=>e.type==='harvest_closure').length,1);
    assert.equal(history.find(e=>e.type==='harvest_closure').details.created_by,actor);
    assert.ok(history.filter(e=>e.type==='harvest').every(e=>e.registered_retroactively===true));
    const rows = (await db.query('SELECT registered_retroactively,retroactive_reason FROM harvest_records')).rows;
    assert.equal(rows.length,2); assert.ok(rows.some(r => r.retroactive_reason === 'other'));
    const closure = (await db.query('SELECT * FROM harvest_cycle_closures')).rows[0];
    assert.equal(Number(closure.remaining_area_ha),38.29); assert.equal(closure.created_by,actor);
    await db.query("INSERT INTO harvest_records(company_id,lot_id,crop,campaign,harvest_date,production_kg,harvested_area_ha) VALUES($1,$2,'soja','2026-2026','2026-01-02',100,1)", [company,lot]);
    const legacy = (await db.query('SELECT registered_retroactively FROM harvest_records WHERE crop_id IS NULL')).rows[0];
    assert.equal(legacy.registered_retroactively,null);
  } finally { await db.close(); }
});


test('V1 current harvest uses local today and stores explicit false provenance', async () => {
  const {db,call,addCycle} = await setup();
  try {
    await db.exec(migration); await addCycle();
    const today = require('../services/harvestRegistration').localToday();
    const record = await call('createHarvestRecord', {lot_id:lot,crop_id:crop,harvest_date:today,harvested_area_ha:1,production_kg:100,registered_retroactively:false});
    assert.equal(record.registered_retroactively,false); assert.equal(record.retroactive_reason,null); assert.equal(record.created_by,actor);
  } finally {await db.close();}
});

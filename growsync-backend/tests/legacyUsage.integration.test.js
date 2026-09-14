// Isolated SQL only: no .env, server, production connection or migrations.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {PGlite} = require(process.env.INVENTORY_TEST_PGLITE || '@electric-sql/pglite');
const legacy = require('../services/legacyUsage');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE products(id uuid PRIMARY KEY, company_id uuid, unit text, enabled boolean DEFAULT true, available_quantity numeric);
    CREATE TABLE usage_records(id uuid PRIMARY KEY, company_id uuid, product_id uuid REFERENCES products(id), amount_used numeric,
      unit text, enabled boolean DEFAULT true, source_planning_id uuid, date date, total_area numeric, previous_crop text,
      current_crop text, user_id uuid, crop_id uuid);
    CREATE TABLE lots(id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE users(id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE usage_lots(usage_id uuid REFERENCES usage_records(id), lot_id uuid REFERENCES lots(id));
    CREATE TABLE crop_assignments(company_id uuid,lot_id uuid,sub_lot_id uuid,crop_id uuid,start_date date,end_date date);`);
});
after(async () => db.close());
async function fixture() {
  const companyId=randomUUID(), usageId=randomUUID(), p=randomUUID(), q=randomUUID(), l=randomUUID(), m=randomUUID();
  await db.query('INSERT INTO products(id,company_id,unit,available_quantity) VALUES ($1,$3,\'kg\',5),($2,$3,\'L\',3)',[p,q,companyId]);
  await db.query('INSERT INTO usage_records(id,company_id,product_id,amount_used,unit,date) VALUES ($1,$2,$3,2,\'kg\',\'2026-09-14\')',[usageId,companyId,p]);
  await db.query('INSERT INTO lots VALUES ($1,$3),($2,$3)',[l,m,companyId]);
  await db.query('INSERT INTO usage_lots VALUES ($1,$2)',[usageId,l]);
  // PGlite is single-session. Queue connections instead of interleaving BEGINs.
  let tail=Promise.resolve();
  const statements=[];
  const pool={async connect(){const prior=tail;let release;tail=new Promise(r=>{release=r;});await prior;
    return {release, async query(sql,params){statements.push(sql);return db.query(sql,params);}};}};
  const run=(body={},enabled,override=pool)=>legacy.mutate(override,{companyId,usageId,body,enabled});
  const snapshot=async()=>({
    products:(await db.query('SELECT * FROM products WHERE company_id=$1 ORDER BY id',[companyId])).rows,
    usage:(await db.query('SELECT * FROM usage_records WHERE id=$1',[usageId])).rows,
    lots:(await db.query('SELECT * FROM usage_lots WHERE usage_id=$1 ORDER BY lot_id',[usageId])).rows,
  });
  const failing=(pattern)=>({async connect(){const c=await pool.connect();return {...c,async query(sql,params){
    if(pattern.test(sql)) throw new Error('Injected persistence failure');return c.query(sql,params);
  }};}});
  return {companyId,usageId,p,q,l,m,pool,run,snapshot,failing,statements};
}
test('Q01: stock=5, usage=2, edit to 20 rejects 409 and rolls back all state',async()=>{
  const x=await fixture(), before=await x.snapshot();
  await assert.rejects(x.run({amount_used:20}),{status:409,message:'Stock insuficiente'});
  assert.deepEqual(await x.snapshot(),before);
  assert.ok(x.statements.some(s=>s.includes('usage_records')&&s.includes('FOR UPDATE')));
  assert.ok(x.statements.some(s=>s.includes('ORDER BY id FOR UPDATE')));
});
test('Q01: insufficient replacement product cannot leave refund behind',async()=>{
  const x=await fixture(), before=await x.snapshot();
  await assert.rejects(x.run({product_id:x.q,unit:'L',amount_used:20,lot_ids:[x.m]}),{status:409});
  assert.deepEqual(await x.snapshot(),before);
});
for (const [name,body] of [['unit mismatch',x=>({unit:'L'})],['foreign lot',()=>({lot_ids:[randomUUID()]})],
  ['foreign product',()=>({product_id:randomUUID()})],['foreign responsible',()=>({user_id:randomUUID()})],['invalid amount',()=>({amount_used:0})]]) {
  test(`Q01: ${name} leaves complete state unchanged`,async()=>{
    const x=await fixture(), before=await x.snapshot();await assert.rejects(x.run(body(x)));assert.deepEqual(await x.snapshot(),before);
  });
}
for (const pattern of [/UPDATE products/, /DELETE FROM usage_lots/, /INSERT INTO usage_lots/, /UPDATE usage_records/, /SELECT DISTINCT crop_id/]) {
  test(`Q01: rollback after injected ${pattern}`,async()=>{
    const x=await fixture(), before=await x.snapshot();
    await assert.rejects(x.run({amount_used:1,lot_ids:[x.m]},undefined,x.failing(pattern)),/Injected/);
    assert.deepEqual(await x.snapshot(),before);
  });
}
test('Q01: product + unit + quantity + lots commit together; identical retry has zero delta',async()=>{
  const x=await fixture(), body={product_id:x.q,unit:'L',amount_used:1.25,lot_ids:[x.m],date:'2026-09-13'};
  await x.run(body);const state=await x.snapshot();await x.run(body);assert.deepEqual(await x.snapshot(),state);
  assert.equal(state.products.find(p=>p.id===x.p).available_quantity,'7.000000');
  assert.equal(state.products.find(p=>p.id===x.q).available_quantity,'1.750000');
  assert.equal(state.usage[0].unit,'L');assert.equal(state.lots[0].lot_id,x.m);
});
for(const enabled of [false,true]) {
  test(`Q02: ${enabled?'restore':'disable'} persistence failure and retries leave exact state`,async()=>{
    const x=await fixture();if(enabled) await x.run({},false);
    const before=await x.snapshot();
    for(let i=0;i<2;i++) await assert.rejects(x.run({},enabled,x.failing(/UPDATE usage_records/)),/Injected/);
    assert.deepEqual(await x.snapshot(),before);
    await x.run({},enabled);const committed=await x.snapshot();
    const replay=await x.run({},enabled);assert.equal(replay.replayed,true);assert.deepEqual(await x.snapshot(),committed);
    assert.equal(committed.products.find(p=>p.id===x.p).available_quantity,enabled?'5.000000':'7.000000');
  });
}
test('Q02: restore with insufficient stock rolls back enabled and quantity',async()=>{
  const x=await fixture();await x.run({},false);await db.query('UPDATE products SET available_quantity=1 WHERE id=$1',[x.p]);
  const before=await x.snapshot();await assert.rejects(x.run({},true),{status:409});assert.deepEqual(await x.snapshot(),before);
});
test('Q02: simultaneous double submit is serialized, one transition and one replay',async()=>{
  const x=await fixture();const results=await Promise.all([x.run({},false),x.run({},false)]);
  assert.equal(results.filter(r=>r.replayed).length,1);
  assert.equal((await x.snapshot()).products.find(p=>p.id===x.p).available_quantity,'7.000000');
  await Promise.all([x.run({},true),x.run({},true)]);
  assert.equal((await x.snapshot()).products.find(p=>p.id===x.p).available_quantity,'5.000000');
});
test('Q03: another company cannot edit, disable or restore a Usage',async()=>{
  const x=await fixture(),before=await x.snapshot();
  for(const enabled of [undefined,false,true]) await assert.rejects(legacy.mutate(x.pool,{companyId:randomUUID(),usageId:x.usageId,body:{amount_used:1},enabled}),{status:404});
  assert.deepEqual(await x.snapshot(),before);
});
test('automatic Usage remains protected; disabled Usage cannot be edited',async()=>{
  const x=await fixture();await x.run({},false);await assert.rejects(x.run({amount_used:1}),{status:409});
  await db.query('UPDATE usage_records SET source_planning_id=$2 WHERE id=$1',[x.usageId,randomUUID()]);
  for(const enabled of [undefined,true,false]) await assert.rejects(x.run({},enabled),{status:409});
});

function controller(pool, overrides={}) {
  const file=path.resolve(__dirname,'../controllers/usage/usage.js'), actual=createRequire(file), module={exports:{}};
  const stock=require('../services/stock');
  const deps={'../../db/supabaseClient':{pool,from(){throw Error('Notification unavailable');}},
    '../notifications':{createNotification:async()=>{}},'../../services/stock':{...stock,isEnabled:()=>false},...overrides};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,console:{error(){}},
    require:id=>Object.hasOwn(deps,id)?deps[id]:actual(id)},{filename:file});return module.exports;
}
async function request(ctrl,method,x,body={}) {
  const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await ctrl[method]({user:{company_id:x.companyId,id:randomUUID()},params:{id:x.usageId},body},res);return res;
}
test('Q01 original probe through controller: 409, usage 2 and stock 5',async t=>{
  const x=await fixture(),before=await x.snapshot();const res=await request(controller(x.pool),'editUsage',x,{amount_used:20});
  assert.equal(res.code,409);assert.equal(res.body.message,'Stock insuficiente');assert.deepEqual(await x.snapshot(),before);
  t.diagnostic(JSON.stringify({case:'LEGACY_EDIT_INSUFFICIENT',status:res.code,usage:2,stock:5}));
});
test('Q02 original probe through controller: two storage failures never reintegrate stock',async t=>{
  const x=await fixture(),before=await x.snapshot(),ctrl=controller(x.failing(/UPDATE usage_records/));
  for(let i=0;i<2;i++) assert.equal((await request(ctrl,'disableUsage',x)).code,500);
  assert.deepEqual(await x.snapshot(),before);
  t.diagnostic(JSON.stringify({case:'LEGACY_DISABLE_RETRY_AFTER_FAILURE',usageEnabled:true,stock:5}));
});
test('post-commit notification failure does not turn a committed mutation into a failed request',async()=>{
  const x=await fixture();await db.query('UPDATE products SET available_quantity=6 WHERE id=$1',[x.p]);
  const res=await request(controller(x.pool),'editUsage',x,{amount_used:4});assert.equal(res.code,200);
  const state=await x.snapshot();assert.equal(state.products.find(p=>p.id===x.p).available_quantity,'4.000000');
  assert.equal(state.usage[0].amount_used,'4.000000');
});
test('V1 dispatch and edit/enable rejection remain unchanged',async()=>{
  const x=await fixture();let disables=0;
  const ctrl=controller(x.pool,{'../../services/stock':{...require('../services/stock'),isEnabled:()=>true},
    '../../services/stockUsage':{disableManualUsage:async()=>{disables++;return {ok:true};}}});
  const before=await x.snapshot();
  assert.equal((await request(ctrl,'editUsage',x,{amount_used:1})).code,409);
  assert.equal((await request(ctrl,'enableUsage',x)).code,409);
  assert.equal((await request(ctrl,'disableUsage',x)).code,200);assert.equal(disables,1);
  assert.deepEqual(await x.snapshot(),before);
});

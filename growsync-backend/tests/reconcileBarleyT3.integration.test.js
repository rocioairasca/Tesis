// Disposable embedded PostgreSQL; no .env, Supabase or production connections.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const service=require('../services/reconcileBarleyT3'),{CASE,WARNING}=service;
const {snapshot}=require('../services/reconcileSowing');
let db,pool,tables;
const corn=randomUUID(),soy=randomUUID(),responsible=randomUUID(),otherPlan=randomUUID();
before(async()=>{
  db=new PGlite();await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const file of ['./historySchema.fixture.sql','../migrations/20260916_historical_no_stock.sql',
    '../migrations/20261004_adopt_existing_history.sql','../migrations/20261006_productive_state_declarations.sql',
    '../migrations/20261007_planning_effective_area.sql'])await db.exec(fs.readFileSync(require.resolve(file),'utf8'));
  await db.exec(`CREATE FUNCTION test_updated() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE TRIGGER trg_planning_updated_at BEFORE UPDATE ON planning FOR EACH ROW EXECUTE FUNCTION test_updated();`);
  tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  pool={async connect(){return {query:(sql,args)=>db.query(sql,args),release(){}};}};
});
after(()=>db?.close());
async function put(table,row){
  const keys=Object.keys(row);
  await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k,i)=>'$'+(i+1)+(row[k]&&typeof row[k]==='object'?'::text::jsonb':'')).join(',')})`,
    keys.map(k=>row[k]&&typeof row[k]==='object'?JSON.stringify(row[k]):row[k]));
}
const all=()=>snapshot(db,tables);
const conflict=promise=>assert.rejects(promise,e=>e.status===409);
async function fixture(){
  await db.exec('ALTER TABLE productive_state_declarations DISABLE TRIGGER USER');
  await db.exec('TRUNCATE '+tables.map(t=>'"'+t+'"').join(',')+' CASCADE');
  await db.exec('ALTER TABLE productive_state_declarations ENABLE TRIGGER USER');
  await put('companies',{id:CASE.company,name:'Don Santiago SRL'});
  for(const id of [CASE.actor,responsible])await put('users',{id,company_id:CASE.company,email:id+'@example.test',role:3});
  for(const [id,name] of [[CASE.crop,'Cebada'],[corn,'Maíz'],[soy,'Soja']])await put('crops',{id,company_id:CASE.company,name});
  await put('campaigns',{id:CASE.campaign,company_id:CASE.company,name:'Fina 2026 (Trigo, Cebada)',start_date:'2026-01-01',end_date:'2026-12-31'});
  for(const [id,name,area] of [[CASE.fromLot,'T4',68.713],[CASE.toLot,'T3',46.0932]])await put('lots',{id,company_id:CASE.company,name,area,area_ha:area});
  await put('products',{id:CASE.product,company_id:CASE.company,name:'Fertilizante siembra trigo',unit:'kg',total_quantity:5000,available_quantity:5000});
  await put('products',{id:randomUUID(),company_id:CASE.company,name:'Otro fertilizante',unit:'kg',total_quantity:10,available_quantity:10});
  await put('planning',{id:CASE.planning,company_id:CASE.company,title:'Siembra Cebada',activity_type:'siembra',status:'completado',
    campaign_id:CASE.campaign,start_at:'2026-06-04T03:00:00Z',end_at:'2026-06-06T03:00:00Z',responsible_user:responsible,description:'Preservar',created_by:CASE.actor});
  await put('planning_lots',{planning_id:CASE.planning,lot_id:CASE.fromLot,sub_lot_id:null,area_ha:'68.7130'});
  await put('planning_products',{id:CASE.planningProduct,planning_id:CASE.planning,product_id:CASE.product,amount:2391,unit:'kg'});
  await put('planning',{id:CASE.laterPlanning,company_id:CASE.company,activity_type:'fumigacion',crop_id:CASE.crop,status:'completado',
    start_at:'2026-08-28T00:00:00Z',end_at:'2026-08-28T00:00:00Z',effective_date:'2026-08-28',responsible_user:responsible});
  await put('planning_lots',{planning_id:CASE.laterPlanning,lot_id:CASE.toLot,sub_lot_id:null,area_ha:46.0932});
  await put('planning',{id:otherPlan,company_id:CASE.company,activity_type:'siembra',status:'pendiente',
    start_at:'2026-11-01T03:00:00Z',end_at:'2026-11-02T03:00:00Z',responsible_user:responsible});
  for(const [lot,crop,start,end] of [[CASE.fromLot,corn,'2026-01-05','2026-08-07'],[CASE.toLot,soy,'2026-01-01','2026-05-01']])
    await put('crop_assignments',{id:randomUUID(),company_id:CASE.company,lot_id:lot,crop_id:crop,campaign_id:CASE.campaign,start_date:start,end_date:end,area_ha:10,harvest_closure_source:'legacy'});
  const batch=randomUUID();
  await put('stock_batches',{id:batch,company_id:CASE.company,product_id:CASE.product,initial_quantity:100,available_quantity:100,unit:'kg',origin:'purchase',created_by:CASE.actor,received_date:'2026-09-24'});
  await put('stock_movements',{id:randomUUID(),company_id:CASE.company,product_id:CASE.product,batch_id:batch,movement_type:'receipt',quantity:100,unit:'kg',operation_id:randomUUID(),idempotency_key:'fixture',request_hash:'a'.repeat(64),created_by:CASE.actor});
  const harvest=randomUUID(),assignment=(await db.query('SELECT id FROM crop_assignments WHERE lot_id=$1',[CASE.fromLot])).rows[0].id;
  await put('harvest_records',{id:harvest,company_id:CASE.company,lot_id:CASE.fromLot,crop:'Maíz',crop_id:corn,campaign:'2025-2026',campaign_id:CASE.campaign,harvest_date:'2026-08-07',production_kg:100,harvested_area_ha:10,created_by:CASE.actor});
  await put('harvest_crop_assignments',{harvest_id:harvest,crop_assignment_id:assignment,harvested_area_ha:10});
  for(const [lot,kind,crop] of [[CASE.toLot,'growing_crop',CASE.crop],[CASE.fromLot,'stubble',corn]])
    await put('productive_state_declarations',{id:randomUUID(),company_id:CASE.company,actor_id:CASE.actor,lot_id:lot,sub_lot_id:null,layout_id:null,
      kind,crop_id:crop,observed_on:'2026-10-06',source:'fixture',evidence:'Estado operativo confirmado',reason:'fixture',coverage:null});
  const input={companyId:CASE.company,actorId:CASE.actor};
  return {input,prepare:()=>service.prepare(pool,input),confirm:(preview,patch={})=>service.confirm(pool,{...input,fingerprint:preview.fingerprint,key:'barley-test',confirmed:true,...patch})};
}
test('prepare read-only: T4/null -> T3/Cebada, preserves historical 68.7130, stable fingerprint',async()=>{
  const x=await fixture(),before=await all(),p=await x.prepare();
  assert.equal(p.persisted,false);assert.equal(p.before.lot.name,'T4');assert.equal(p.before.crop,null);
  assert.equal(p.after.lot.name,'T3');assert.equal(p.after.crop.name,'Cebada');
  assert.equal(p.before.area_ha,'68.7130');assert.equal(p.after.area_ha,'68.7130');assert.equal(p.warning,WARNING);
  assert.ok(p.schema_review.incoming_fks.length);assert.ok(p.schema_review.relevant_triggers.length);
  assert.equal((await x.prepare()).fingerprint,p.fingerprint);assert.deepEqual(await all(),before);
});
test('confirm changes only crop and lot; all inventory/harvest/cycle/declaration/other planning rows unchanged',async()=>{
  const x=await fixture(),before=await all(),p=await x.prepare(),result=await x.confirm(p),after=await all();
  for(const table of tables.filter(t=>!['planning','planning_lots','historical_imports','historical_events'].includes(t)))assert.deepEqual(after[table],before[table],table);
  const original=JSON.parse(before.planning.find(s=>JSON.parse(s).id===CASE.planning));
  const saved=JSON.parse(after.planning.find(s=>JSON.parse(s).id===CASE.planning));
  const {crop_id,updated_at,...protectedFields}=saved;
  const {crop_id:oldCrop,updated_at:oldUpdated,...oldFields}=original;
  assert.equal(crop_id,CASE.crop);assert.deepEqual(protectedFields,oldFields);
  assert.deepEqual(after.planning.filter(s=>JSON.parse(s).id!==CASE.planning),before.planning.filter(s=>JSON.parse(s).id!==CASE.planning));
  const oldSelection=JSON.parse(before.planning_lots.find(s=>JSON.parse(s).planning_id===CASE.planning));
  const newSelection=JSON.parse(after.planning_lots.find(s=>JSON.parse(s).planning_id===CASE.planning));
  assert.deepEqual(newSelection,{...oldSelection,lot_id:CASE.toLot});
  assert.deepEqual(after.planning_lots.filter(s=>JSON.parse(s).planning_id!==CASE.planning),before.planning_lots.filter(s=>JSON.parse(s).planning_id!==CASE.planning));
  for(const field of ['crop_assignments_created','usages_created','completions_created','stock_movements_created'])assert.equal(result[field],0);
  assert.equal(after.historical_events.length,before.historical_events.length+1);
  const event=JSON.parse(after.historical_events.at(-1)),meta=event.after_data.reconciliation;
  assert.equal(meta.historical_area_ha,'68.7130');assert.equal(meta.structural_area_used,false);assert.equal(meta.crop_assignment_created,false);
  assert.equal(meta.warning,WARNING);assert.equal(meta.fingerprint,p.fingerprint);assert.equal(meta.actor_id,CASE.actor);
  assert.equal(meta.import_id,result.import_id);assert.equal(meta.idempotency_key,'barley-test');assert.ok(meta.reason);assert.ok(meta.evidence);
  assert.deepEqual(event.before_data.planning,original);assert.deepEqual(event.after_data.planning,saved);
  assert.equal(event.before_data.planning_lots[0].lot_id,CASE.fromLot);assert.equal(event.after_data.planning_lots[0].lot_id,CASE.toLot);
});
test('idempotent replay is read-only; changed fingerprint under same key conflicts',async()=>{
  const x=await fixture(),p=await x.prepare(),r=await x.confirm(p),before=await all();
  assert.deepEqual(await x.confirm(p),{...r,replayed:true});assert.deepEqual(await all(),before);
  await conflict(x.confirm(p,{fingerprint:'b'.repeat(64)}));assert.deepEqual(await all(),before);
});
for(const field of ['fingerprint','key','confirmed'])test('mandatory confirmation field '+field,async()=>{
  const x=await fixture(),p=await x.prepare(),before=await all();await assert.rejects(x.confirm(p,{[field]:undefined}),e=>e.status===400);assert.deepEqual(await all(),before);
});
for(const viaProduct of [false,true])test('new usage blocks confirm via '+(viaProduct?'product':'planning'),async()=>{
  const x=await fixture(),p=await x.prepare();
  await put('usage_records',{id:randomUUID(),company_id:CASE.company,product_id:CASE.product,date:'2026-06-04',amount_used:1,unit:'kg',
    source_planning_id:viaProduct?null:CASE.planning,source_planning_product_id:viaProduct?CASE.planningProduct:null});
  const before=await all();await conflict(x.confirm(p));assert.deepEqual(await all(),before);
});
test('new completion blocks confirm',async()=>{
  const x=await fixture(),p=await x.prepare();await put('planning_product_completions',{planning_id:CASE.planning,planning_product_id:CASE.planningProduct,actual_amount:2391});
  const before=await all();await conflict(x.confirm(p));assert.deepEqual(await all(),before);
});
test('new source assignment blocks confirm',async()=>{
  const x=await fixture(),p=await x.prepare();await put('crop_assignments',{id:randomUUID(),company_id:CASE.company,lot_id:CASE.toLot,crop_id:CASE.crop,campaign_id:CASE.campaign,start_date:'2026-06-04',source_planning_id:CASE.planning,area_ha:1});
  const before=await all();await conflict(x.confirm(p));assert.deepEqual(await all(),before);
});
for(const [name,sql] of [
  ['amount','UPDATE planning_products SET amount=2392'],['unit',"UPDATE planning_products SET unit='L'"],
  ['product',"UPDATE planning_products SET product_id=(SELECT id FROM products WHERE name='Otro fertilizante')"],['catalog name',"UPDATE products SET name='Semilla'"],
  ['area','UPDATE planning_lots SET area_ha=46.0932 WHERE planning_id=$1'],['effective area','UPDATE planning_lots SET effective_area_ha=1 WHERE planning_id=$1'],
  ['start date',"UPDATE planning SET start_at='2026-06-05T03:00:00Z' WHERE id=$1"],
  ['end date',"UPDATE planning SET end_at='2026-06-07T03:00:00Z' WHERE id=$1"],
  ['campaign','UPDATE planning SET campaign_id=NULL WHERE id=$1'],['status',"UPDATE planning SET status='pendiente' WHERE id=$1"],
  ['mode',"UPDATE planning SET inventory_impact_mode='HISTORICAL_NO_STOCK' WHERE id=$1"],
  ['T3 disabled','UPDATE lots SET enabled=false WHERE id=$1'],
  ['maize evidence',"UPDATE crop_assignments SET end_date='2026-08-08' WHERE lot_id=$1"],
  ['fumigation evidence',"UPDATE planning SET crop_id=NULL WHERE id=$1"],
  ['unrelated concurrent change',"UPDATE planning SET description='concurrent' WHERE id=$1"],
])test('precondition/fingerprint blocks changed '+name,async()=>{
  const x=await fixture(),p=await x.prepare();
  if(name==='mode')await db.exec('ALTER TABLE planning DISABLE TRIGGER protect_inventory_impact_mode');
  try{
    const target={'T3 disabled':CASE.toLot,'maize evidence':CASE.fromLot,'fumigation evidence':CASE.laterPlanning,'unrelated concurrent change':otherPlan}[name]||CASE.planning;
    await db.query(sql,sql.includes('$1')?[target]:[]);
    const before=await all();await conflict(x.confirm(p));assert.deepEqual(await all(),before);
  }finally{if(name==='mode')await db.exec('ALTER TABLE planning ENABLE TRIGGER protect_inventory_impact_mode');}
});
for(const [name,patch,sql] of [
  ['company',{companyId:randomUUID()},null],['actor',{actorId:responsible},null],
  ['disabled',{},'UPDATE users SET enabled=false WHERE id=$1'],['role',{},'UPDATE users SET role=2 WHERE id=$1'],
  ['history permission',{},`UPDATE users SET custom_permissions='["planning.edit"]'::jsonb WHERE id=$1`],
  ['planning permission',{},`UPDATE users SET custom_permissions='["history.import"]'::jsonb WHERE id=$1`],
])test('authorization blocks '+name,async()=>{
  const x=await fixture(),p=await x.prepare();if(sql)await db.query(sql,[CASE.actor]);
  const before=await all();await assert.rejects(x.confirm(p,patch),e=>e.status===403);assert.deepEqual(await all(),before);
});
test('unknown incoming FK blocks even if empty',async t=>{
  await fixture();await db.exec('CREATE TABLE unknown_barley_relation(id uuid,planning_id uuid REFERENCES planning(id))');
  t.after(()=>db.exec('DROP TABLE unknown_barley_relation'));
  await conflict(service.prepare(pool,{companyId:CASE.company,actorId:CASE.actor}));
});
test('unknown relation without FK blocks when it contains graph identifiers',async t=>{
  await fixture();await db.exec('CREATE TABLE unknown_barley_relation(value jsonb)');
  t.after(()=>db.exec('DROP TABLE unknown_barley_relation'));
  await db.query('INSERT INTO unknown_barley_relation VALUES($1::text::jsonb)',[JSON.stringify({planning:CASE.planning})]);
  await conflict(service.prepare(pool,{companyId:CASE.company,actorId:CASE.actor}));
});
for(const [table,body,deferred] of [
  ['planning',"UPDATE products SET available_quantity=available_quantity+1;",false],
  ['planning',"NEW.description='unauthorized';",false],
  ['planning_lots',"NEW.area_ha=46.0932;",false],
  ['historical_events',"UPDATE lots SET area_ha=1;",false],
  ['historical_events',"NEW.after_data='{}'::jsonb;",false],
  ['historical_imports',"NEW.imported_by='"+responsible+"'::uuid;",false],
  ['planning',"UPDATE products SET total_quantity=total_quantity+1;",true],
])test('unauthorized trigger delta rolls back '+table+' '+body,async t=>{
  const x=await fixture();
  await db.exec(`CREATE FUNCTION barley_attack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$;`);
  const operation=['historical_events','historical_imports'].includes(table)?'INSERT':'UPDATE';
  await db.exec(deferred?`CREATE CONSTRAINT TRIGGER barley_attack AFTER ${operation} ON ${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION barley_attack()`:
    `CREATE TRIGGER barley_attack BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION barley_attack()`);
  t.after(()=>db.exec(`DROP TRIGGER barley_attack ON ${table}; DROP FUNCTION barley_attack();`));
  const p=await x.prepare(),before=await all();await conflict(x.confirm(p));assert.deepEqual(await all(),before);
});
test('prepare is enforced read-only even if an SQL helper attempts a write',async()=>{
  const x=await fixture(),before=await all();let attempted=false;
  const badPool={async connect(){return {release(){},async query(sql,args){if(sql.startsWith('SELECT c.relname,c.relkind')&&!attempted){attempted=true;await db.query("UPDATE lots SET name='unexpected'");}return db.query(sql,args);}};}};
  await assert.rejects(service.prepare(badPool,x.input),/read.only/i);assert.deepEqual(await all(),before);
});
test('HTTP fixed payload, mandatory key, permissions, replay and private route mounting',async t=>{
  const x=await fixture(),express=require('express'),app=express();let user={id:CASE.actor,company_id:CASE.company,role:3};
  app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});
  app.use('/api/history/reconcile-barley-t3',require('../routes/reconcileBarleyT3')(pool));
  app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/api/history/reconcile-barley-t3/';
  const post=(op,body,key)=>fetch(url+op,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
  assert.equal((await post('prepare',{planning_id:CASE.planning})).status,400);
  const preview=await post('prepare',{});assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');
  const p=await preview.json(),body={fingerprint:p.fingerprint,confirmed:true};
  assert.equal((await post('confirm',body)).status,400);assert.equal((await post('confirm',body,'http')).status,201);assert.equal((await post('confirm',body,'http')).status,200);
  user={...user,custom_permissions:['history.import']};assert.equal((await post('prepare',{})).status,403);
  const index=fs.readFileSync(require.resolve('../index'),'utf8'),history=fs.readFileSync(require.resolve('../routes/history'),'utf8');
  assert.match(index,/privateMiddlewares\s*=\s*\[\s*checkJwt,\s*userData,\s*requireTenant,?\s*\]/);
  assert.match(index,/app.use\('\/api\/history', \.\.\.privateMiddlewares/);
  assert.ok(history.includes("router.use('/reconcile-barley-t3', require('./reconcileBarleyT3')(pool))"));
});

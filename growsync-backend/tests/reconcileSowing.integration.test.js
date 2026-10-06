// Disposable embedded PostgreSQL only: never loads .env or the Supabase client.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const service=require('../services/reconcileSowing');
const {COMPANY,CROP,CAMPAIGN,CASES}=service;
let db,pool,tables;
const read=table=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../audit/don-santiago-pre-reset/20260916T175923749Z/data',table+'.json'),'utf8'));
const quote=s=>'"'+s.replaceAll('"','""')+'"';
before(async()=>{
  db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['./historySchema.fixture.sql','../migrations/20260916_historical_no_stock.sql','../migrations/20261004_adopt_existing_history.sql','../migrations/20260830_add_source_planning_to_crop_assignments.sql'])
    await db.exec(fs.readFileSync(require.resolve(f),'utf8'));
  const captured=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../audit/historical-adoption-schema-readonly.json'),'utf8'));
  for(const trigger of captured.triggers.filter(t=>t.tgname==='trg_planning_updated_at'||t.tgname==='crop_assignments_set_updated_at')){
    await db.exec(trigger.function_definition);await db.exec(trigger.definition);
  }
  tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  pool={async connect(){return {query:(s,a)=>db.query(s,a),release(){}};}};
});
after(async()=>db?.close());
async function insert(table,row){
  const entries=Object.entries(row).filter(([k])=>!['date_range','yield_kg_ha'].includes(k));
  await db.query(`INSERT INTO ${quote(table)} (${entries.map(([k])=>quote(k)).join(',')}) VALUES (${entries.map((_,i)=>'$'+(i+1)).join(',')})`,entries.map(([,v])=>v));
}
async function snapshot(){
  const result={};for(const t of tables) result[t]=(await db.query(`SELECT to_jsonb(x)::text value FROM ${quote(t)} x ORDER BY to_jsonb(x)::text`)).rows.map(r=>r.value);
  return result;
}
async function fixture(){
  await db.exec('TRUNCATE '+tables.map(quote).join(',')+' CASCADE');
  const ids=Object.keys(CASES),plans=read('planning').filter(p=>ids.includes(p.id)),actorId=plans[0].responsible_user;
  await insert('companies',{id:COMPANY,name:'Synthetic support fixture'});
  for(const id of new Set(plans.flatMap(p=>[p.responsible_user,p.created_by])))
    await insert('users',{id,company_id:COMPANY,email:id+'@example.test',role:3,enabled:true});
  for(const crop of read('crops')) await insert('crops',crop);
  for(const campaign of read('campaigns')) await insert('campaigns',campaign);
  for(const lot of read('lots').filter(l=>Object.values(CASES).some(c=>c.lot===l.id)))
    await insert('lots',{id:lot.id,name:lot.name,area:lot.area,area_ha:lot.area_ha,company_id:COMPANY});
  const importId=randomUUID();
  await insert('historical_imports',{id:importId,company_id:COMPANY,idempotency_key:'fixture',request_hash:'fixture',imported_by:actorId,source:'synthetic-adopted-backup',payload:{}});
  for(const p of plans) await insert('planning',{...p,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:importId});
  const selections=read('planning_lots').filter(p=>ids.includes(p.planning_id));
  for(const row of selections) await insert('planning_lots',row);
  const products=read('planning_products').filter(p=>ids.includes(p.planning_id));
  for(const p of read('products').filter(p=>products.some(pp=>pp.product_id===p.id)))await insert('products',p);
  for(const row of products)await insert('planning_products',row);
  const usages=read('usage_records').filter(p=>ids.includes(p.source_planning_id));
  for(const row of usages)await insert('usage_records',{...row,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:importId});
  for(const row of read('usage_lots').filter(l=>usages.some(u=>u.id===l.usage_id)))await insert('usage_lots',row);
  for(const row of read('planning_product_completions').filter(p=>ids.includes(p.planning_id)))await insert('planning_product_completions',row);
  const productId=products[0].product_id,batchId=randomUUID();
  await insert('stock_batches',{id:batchId,company_id:COMPANY,product_id:productId,initial_quantity:100,available_quantity:100,unit:'kg',origin:'purchase',created_by:actorId,received_date:'2026-09-24'});
  await insert('stock_movements',{id:randomUUID(),company_id:COMPANY,product_id:productId,batch_id:batchId,movement_type:'receipt',quantity:100,unit:'kg',operation_id:randomUUID(),idempotency_key:'fixture-receipt',request_hash:'a'.repeat(64),created_by:actorId});
  const input={companyId:COMPANY,actorId,planningIds:ids};
  return {input,ids,importId,actorId,productId,prepare:()=>service.prepare(pool,input),
    confirm:(preview,extra={})=>service.confirm(pool,{...input,fingerprint:preview.fingerprint,key:'support-test',confirmed:true,...extra})};
}
const rejectsConflict=promise=>assert.rejects(promise,e=>e.status===409);
async function cycle(x,{id=randomUUID(),lot=CASES[x.ids[0]].lot,start='2026-01-01',end=null,sub=null,source=null}={}){
  await insert('crop_assignments',{id,company_id:COMPANY,campaign_id:CAMPAIGN,lot_id:lot,sub_lot_id:sub,crop_id:CROP,start_date:start,end_date:end,
    source_planning_id:source,harvest_closure_source:end?'legacy':null,area_ha:1,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:x.importId});
  return id;
}
test('prepare de los cuatro Trigos es read-only, estable, sin eventos ni imports nuevos',async()=>{
  const x=await fixture(),before=await snapshot(),preview=await x.prepare();
  assert.equal(preview.persisted,false);assert.equal(preview.can_confirm,true);assert.equal(preview.items.length,4);
  assert.match(preview.fingerprint,/^[a-f0-9]{64}$/);assert.deepEqual(await snapshot(),before);
  assert.equal((await x.prepare()).fingerprint,preview.fingerprint);
  assert.equal((await service.prepare(pool,{...x.input,planningIds:[...x.ids].reverse()})).fingerprint,preview.fingerprint);
  for(const item of preview.items){assert.equal(item.start_date,CASES[item.planning_id].date);assert.equal(item.graph.usages.length,2);}
});
test('confirm completo: cuatro assignments, área estructural independiente, fechas y procedencia; inventario/grafo intactos',async()=>{
  const x=await fixture();
  // Historical worked area differs on purpose; it must not become the cycle area.
  await db.query('UPDATE planning_lots SET area_ha=12.3456 WHERE planning_id=$1',[x.ids[0]]);
  const before=await snapshot(),preview=await x.prepare(),result=await x.confirm(preview),after=await snapshot();
  assert.equal(result.items.length,4);assert.equal(result.stock_unchanged,true);
  for(const table of tables.filter(t=>!['planning','crop_assignments','historical_events','historical_imports'].includes(t)))
    assert.deepEqual(after[table],before[table],table);
  for(const info of result.items){
    const p=(await db.query('SELECT * FROM planning WHERE id=$1',[info.planning_id])).rows[0];
    assert.equal(p.crop_id,CROP);
    const old=JSON.parse(before.planning.find(s=>JSON.parse(s).id===p.id));
    const persisted=(await db.query("SELECT (to_jsonb(p)-ARRAY['crop_id','updated_at'])::text value FROM planning p WHERE id=$1",[p.id])).rows[0].value;
    assert.deepEqual(JSON.parse(persisted),Object.fromEntries(Object.entries(old).filter(([k])=>!['crop_id','updated_at'].includes(k))));
    const a=(await db.query('SELECT to_jsonb(a) value FROM crop_assignments a WHERE id=$1',[info.assignment_id])).rows[0].value;
    assert.equal(a.source_planning_id,p.id);assert.equal(a.start_date,CASES[p.id].date);assert.equal(a.end_date,null);
    assert.equal(a.lot_id,CASES[p.id].lot);assert.equal(a.sub_lot_id,null);assert.equal(a.crop_id,CROP);assert.equal(a.campaign_id,CAMPAIGN);
    assert.equal(a.company_id,COMPANY);assert.equal(a.inventory_impact_mode,'HISTORICAL_NO_STOCK');assert.equal(a.historical_import_id,x.importId);
    const structural=(await db.query('SELECT round(area_ha,2)::text a FROM lots WHERE id=$1',[a.lot_id])).rows[0].a;
    assert.equal(Number(a.area_ha),Number(structural));
    const event=(await db.query('SELECT * FROM historical_events WHERE entity_id=$1',[p.id])).rows[0];
    assert.equal(event.actor_id,x.actorId);assert.equal(event.company_id,COMPANY);
    assert.equal(event.after_data.reconciliation.operation,'reconcile-sowing');
    assert.equal(event.after_data.reconciliation.evidence,'primer día del período confirmado como inicio real de siembra');
    assert.equal(event.after_data.reconciliation.fingerprint,preview.fingerprint);
    assert.equal(event.after_data.reconciliation.idempotency_import_id,result.import_id);
  }
  const once=await snapshot();assert.deepEqual(await x.confirm(preview),{...result,replayed:true});assert.deepEqual(await snapshot(),once);
  await rejectsConflict(x.confirm(preview,{planningIds:[x.ids[0]]}));
  await rejectsConflict(x.confirm(preview,{fingerprint:'a'.repeat(64)}));
  await rejectsConflict(x.prepare());
});
test('fingerprint viejo por cambio de cantidades o estructura aborta todo',async()=>{
  const x=await fixture(),preview=await x.prepare();
  await db.query('UPDATE planning_products SET amount=amount+1 WHERE planning_id=$1',[x.ids[0]]);
  const before=await snapshot();await rejectsConflict(x.confirm(preview));assert.deepEqual(await snapshot(),before);
});
test('cambios de esquema/triggers vencen fingerprint',async t=>{
  const x=await fixture(),preview=await x.prepare();
  await db.exec('CREATE TABLE support_schema_change(id integer)');t.after(()=>db.exec('DROP TABLE support_schema_change'));
  const before=await snapshot();await rejectsConflict(x.confirm(preview));assert.deepEqual(await snapshot(),before);
});
test('assignment de origen ya existente bloquea aunque sea anterior',async()=>{
  const x=await fixture();await cycle(x,{source:x.ids[0],end:'2026-01-02'});await rejectsConflict(x.prepare());
});
test('crop_id no NULL bloquea',async()=>{
  const x=await fixture();await db.query('UPDATE planning SET crop_id=$1 WHERE id=$2',[CROP,x.ids[0]]);await rejectsConflict(x.prepare());
});
for(const [label,changes] of [
  ['tipo',"activity_type='fumigacion'"],['estado',"status='pendiente'"],['habilitación','enabled=false'],
  ['fecha efectiva',"effective_date='2026-05-24'"],['período',"start_at='2026-05-22T00:00:00-03:00'"],['procedencia','historical_import_id=NULL'],
])test('precondición inválida: '+label,async()=>{
  const x=await fixture();
  // Fixture-only modification; production impact-mode protections remain installed.
  if(label==='procedencia')await db.exec('ALTER TABLE planning DISABLE TRIGGER protect_inventory_impact_mode');
  try{await db.query('UPDATE planning SET '+changes+' WHERE id=$1',['bc06146e-086e-4a10-8dec-fcaa3d5d71f1']);}
  finally{if(label==='procedencia')await db.exec('ALTER TABLE planning ENABLE TRIGGER protect_inventory_impact_mode');}
  await rejectsConflict(x.prepare());
});
test('campaña incorrecta y modo NORMAL bloquean sin adopción automática',async()=>{
  const x=await fixture();await db.query('UPDATE planning SET campaign_id=$1 WHERE id=$2',[read('campaigns')[0].id,x.ids[0]]);await rejectsConflict(x.prepare());
  await fixture();await db.exec('ALTER TABLE planning DISABLE TRIGGER protect_inventory_impact_mode');
  try{await db.query("UPDATE planning SET inventory_impact_mode='NORMAL' WHERE id=$1",[x.ids[0]]);}finally{await db.exec('ALTER TABLE planning ENABLE TRIGGER protect_inventory_impact_mode');}
  await rejectsConflict(x.prepare());
});
for(const [label,opts] of [['abierto',{}],['cerrado después',{end:'2026-06-01'}],['inicio futuro',{start:'2027-01-01'}]])
  test('bloquea ciclo superpuesto '+label,async()=>{const x=await fixture();await cycle(x,opts);await rejectsConflict(x.prepare());});
test('ciclo previo finalizado antes de siembra es conservado exactamente',async()=>{
  const x=await fixture(),id=await cycle(x,{end:'2026-05-01'}),before=(await db.query('SELECT to_jsonb(a)::text value FROM crop_assignments a WHERE id=$1',[id])).rows[0].value;
  await x.confirm(await x.prepare());assert.equal((await db.query('SELECT to_jsonb(a)::text value FROM crop_assignments a WHERE id=$1',[id])).rows[0].value,before);
});
test('ciclo sobre sublote bloquea la ventana whole-lot sin inferencias espaciales',async()=>{
  const x=await fixture(),lot=CASES[x.ids[0]].lot,layout=randomUUID(),sub=randomUUID();
  await insert('lot_layouts',{id:layout,company_id:COMPANY,lot_id:lot,version:1,parent_geom_snapshot:'opaque',parent_area_ha_snapshot:10});
  await insert('sub_lots',{id:sub,company_id:COMPANY,lot_id:lot,layout_id:layout,code:'A',name:'A',geom:'opaque',area_ha:1});
  await cycle(x,{sub});await rejectsConflict(x.prepare());
});
test('cosecha posterior inesperada bloquea',async()=>{
  const x=await fixture();await insert('harvest_records',{id:randomUUID(),company_id:COMPANY,lot_id:CASES[x.ids[0]].lot,crop:'Trigo',campaign:'2025-2026',crop_id:CROP,campaign_id:CAMPAIGN,
    harvest_date:'2026-08-01',production_kg:100,harvested_area_ha:1,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:x.importId});
  await rejectsConflict(x.prepare());
});
test('tenant ajeno y Planning movida a otra empresa rechazados',async()=>{
  const x=await fixture(),company=randomUUID(),actor=randomUUID();await insert('companies',{id:company,name:'Other'});
  await insert('users',{id:actor,company_id:company,email:'other@example.test',role:3});
  await assert.rejects(service.prepare(pool,{...x.input,companyId:company,actorId:actor}),e=>e.status===403);
  await db.query('UPDATE planning SET company_id=$1 WHERE id=$2',[company,x.ids[0]]);
  await assert.rejects(x.prepare(),e=>e.status===404);
});
for(const [label,sql] of [['no Admin','role=2'],['permisos reemplazados',"custom_permissions='[\"history.import\"]'::jsonb"],['deshabilitado','enabled=false']])
  test('rechaza actor '+label,async()=>{const x=await fixture();await db.query('UPDATE users SET '+sql+' WHERE id=$1',[x.actorId]);await assert.rejects(x.prepare(),e=>e.status===403);});
for(const [id,label] of [['74842b24-19cd-4f88-bf4b-3f43dedd7837','T2'],['c843269e-50a5-4ea5-b63d-4c5587e5b48d','T3']])
  test(label+' bloqueado en prepare y confirm',async()=>{
    const x=await fixture(),preview=await x.prepare();
    for(const op of ['prepare','confirm'])await assert.rejects(service[op](pool,{...x.input,planningIds:[...x.ids.slice(0,1),id],fingerprint:preview.fingerprint,key:'x',confirmed:true}),e=>e.status===409&&e.message.includes(label));
  });
test('fingerprint/key/confirmación son obligatorios; no acepta duplicados ni IDs arbitrarios',async()=>{
  const x=await fixture(),preview=await x.prepare();
  for(const extra of [{fingerprint:undefined},{key:undefined},{confirmed:false}])await assert.rejects(x.confirm(preview,extra),e=>e.status===400);
  await rejectsConflict(service.prepare(pool,{...x.input,planningIds:[x.ids[0],x.ids[0]]}));
  await rejectsConflict(service.prepare(pool,{...x.input,planningIds:[randomUUID()]}));
});
for(const [label,body,timing] of [
  ['inventario',"UPDATE products SET available_quantity=available_quantity+1; RETURN NEW;",'AFTER INSERT'],
  ['usos',"UPDATE usage_records SET amount_used=amount_used+1; RETURN NEW;",'AFTER INSERT'],
  ['productos históricos',"UPDATE planning_products SET amount=amount+1; RETURN NEW;",'AFTER INSERT'],
  ['completions',"UPDATE planning_product_completions SET actual_amount=actual_amount+1; RETURN NEW;",'AFTER INSERT'],
  ['área operativa',"UPDATE planning_lots SET area_ha=area_ha+1; RETURN NEW;",'AFTER INSERT'],
  ['Planning',"UPDATE planning SET title='unexpected'; RETURN NEW;",'AFTER INSERT'],
  ['área ciclo',"NEW.area_ha=1; RETURN NEW;",'BEFORE INSERT'],
  ['error al crear último ciclo',"IF NEW.lot_id='a7df5a3f-9b62-4347-b576-be736896470d'::uuid THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW;",'BEFORE INSERT'],
])test('rollback total ante '+label,async t=>{
  const x=await fixture();
  await db.exec(`CREATE FUNCTION support_adversary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} END $$;
    CREATE TRIGGER support_adversary ${timing} ON crop_assignments FOR EACH ROW EXECUTE FUNCTION support_adversary();`);
  t.after(()=>db.exec('DROP FUNCTION support_adversary() CASCADE'));
  const preview=await x.prepare(),before=await snapshot();await assert.rejects(x.confirm(preview));assert.deepEqual(await snapshot(),before);
});
test('efecto tardío de auditoría revierte también eventos e idempotencia',async t=>{
  const x=await fixture();await db.exec(`CREATE FUNCTION support_audit_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE products SET available_quantity=available_quantity+1; RETURN NEW; END $$;
    CREATE TRIGGER support_audit_effect AFTER INSERT ON historical_events FOR EACH ROW EXECUTE FUNCTION support_audit_effect();`);
  t.after(()=>db.exec('DROP FUNCTION support_audit_effect() CASCADE'));
  const preview=await x.prepare(),before=await snapshot();await rejectsConflict(x.confirm(preview));assert.deepEqual(await snapshot(),before);
});
test('prepare usa transacción READ ONLY a nivel DB, aun con wrapper que intenta escribir',async()=>{
  const x=await fixture();let attempted=false;
  const attackingPool={async connect(){return {release(){},async query(sql,args){
    if(sql.startsWith('SELECT c.relname,c.relkind')&&!attempted){attempted=true;await db.query("UPDATE planning SET title='write in prepare'");}
    return db.query(sql,args);
  }};}};
  const before=await snapshot();await assert.rejects(service.prepare(attackingPool,x.input),/read.only/i);assert.deepEqual(await snapshot(),before);
});
test('HTTP rutas reales: payload estricto, tenant de sesión, prepare/confirm y conflictos',async t=>{
  const x=await fixture(),express=require('express'),app=express();app.use(express.json());
  app.use((req,res,next)=>{req.user={id:x.actorId,company_id:COMPANY,role:3};next();});
  app.use('/api/history/reconcile-sowing',require('../routes/reconcileSowing')(pool));
  app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/api/history/reconcile-sowing/';
  const post=(route,body,headers={})=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post('prepare',{planning_ids:x.ids,company_id:randomUUID()})).status,400);
  const response=await post('prepare',{planning_ids:x.ids});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const preview=await response.json();
  assert.equal((await post('confirm',{planning_ids:x.ids,fingerprint:preview.fingerprint,confirmed:true})).status,400);
  assert.equal((await post('confirm',{planning_ids:x.ids,fingerprint:preview.fingerprint,confirmed:true},{'Idempotency-Key':'http-test'})).status,201);
  assert.equal((await post('confirm',{planning_ids:x.ids,fingerprint:preview.fingerprint,confirmed:true},{'Idempotency-Key':'http-test'})).status,200);
  assert.equal((await post('prepare',{planning_ids:['74842b24-19cd-4f88-bf4b-3f43dedd7837']})).status,409);
});



test('área estructural modificada después de prepare vence fingerprint',async()=>{
  const x=await fixture(),preview=await x.prepare();
  await db.query('UPDATE lots SET area_ha=area_ha+1 WHERE id=$1',[CASES[x.ids[0]].lot]);
  const before=await snapshot();await rejectsConflict(x.confirm(preview));assert.deepEqual(await snapshot(),before);
});
test('precisión numeric(12,4) y trigger instalado de redondeo: fuente 92.6495, persistida 92.6500',async t=>{
  const x=await fixture();
  await db.exec(`ALTER TABLE crop_assignments ALTER COLUMN area_ha TYPE numeric(12,4);
    CREATE FUNCTION support_round_area() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.area_ha=round(NEW.area_ha,2); RETURN NEW; END $$;
    CREATE TRIGGER normalize_new_harvest_cycle_area BEFORE INSERT ON crop_assignments FOR EACH ROW EXECUTE FUNCTION support_round_area();`);
  t.after(async()=>{await db.exec('DROP FUNCTION support_round_area() CASCADE; ALTER TABLE crop_assignments ALTER COLUMN area_ha TYPE numeric(12,2)');});
  const preview=await x.prepare(),item=preview.items.find(i=>i.planning_id==='bc06146e-086e-4a10-8dec-fcaa3d5d71f1');
  assert.equal(item.structural_area_source,'92.6495');assert.equal(item.structural_area_persisted,'92.65');
  const result=await x.confirm(preview);assert.equal(result.items.find(i=>i.planning_id===item.planning_id).structural_area_persisted,'92.6500');
});
test('trigger diferido: snapshot final fuerza ejecución y revierte efecto tardío',async t=>{
  const x=await fixture();await db.exec(`CREATE FUNCTION support_deferred_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE products SET available_quantity=available_quantity+1; RETURN NEW; END $$;
    CREATE CONSTRAINT TRIGGER support_deferred_effect AFTER INSERT ON crop_assignments DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION support_deferred_effect();`);
  t.after(()=>db.exec('DROP FUNCTION support_deferred_effect() CASCADE'));
  const preview=await x.prepare(),before=await snapshot();await rejectsConflict(x.confirm(preview));assert.deepEqual(await snapshot(),before);
});
test('datos de otra empresa tampoco pueden cambiar por un trigger',async t=>{
  const x=await fixture(),other=randomUUID();await insert('companies',{id:other,name:'Other protected company'});
  await db.exec(`CREATE FUNCTION support_other_tenant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE companies SET name='unexpected' WHERE id='${other}'::uuid; RETURN NEW; END $$;
    CREATE TRIGGER support_other_tenant AFTER INSERT ON crop_assignments FOR EACH ROW EXECUTE FUNCTION support_other_tenant();`);
  t.after(()=>db.exec('DROP FUNCTION support_other_tenant() CASCADE'));
  const preview=await x.prepare(),before=await snapshot();await rejectsConflict(x.confirm(preview));assert.deepEqual(await snapshot(),before);
});
test('no altera eventos históricos existentes',async()=>{
  const x=await fixture();await insert('historical_events',{id:randomUUID(),company_id:COMPANY,actor_id:x.actorId,entity_table:'planning',entity_id:x.ids[0],before_data:{original:true},after_data:{adopted:true}});
  const before=(await db.query("SELECT to_jsonb(e)::text value FROM historical_events e WHERE after_data ? 'adopted'")).rows[0].value;
  await x.confirm(await x.prepare());assert.equal((await db.query("SELECT to_jsonb(e)::text value FROM historical_events e WHERE after_data ? 'adopted'")).rows[0].value,before);
});
test('protecciones históricas deshabilitadas bloquean prepare',async t=>{
  const x=await fixture();await db.exec('ALTER TABLE historical_events DISABLE TRIGGER protect_historical_events');
  t.after(()=>db.exec('ALTER TABLE historical_events ENABLE TRIGGER protect_historical_events'));
  await rejectsConflict(x.prepare());
});
test('effective_area_ha histórica es preservada exactamente',async t=>{
  const x=await fixture();await db.exec('ALTER TABLE planning_lots ADD COLUMN effective_area_ha numeric(12,4)');
  t.after(()=>db.exec('ALTER TABLE planning_lots DROP COLUMN effective_area_ha'));
  await db.exec('UPDATE planning_lots SET effective_area_ha=1.2345');
  const before=(await snapshot()).planning_lots;await x.confirm(await x.prepare());assert.deepEqual((await snapshot()).planning_lots,before);
});


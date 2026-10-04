// Disposable PostgreSQL only. No .env, Supabase client or external database.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const adoption=require('../services/historicalAdoption');
const mutation=require('../services/historicalMutation');
let db,pool;
before(async()=>{
  db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(fs.readFileSync(require.resolve('./historySchema.fixture.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../migrations/20260916_historical_no_stock.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../migrations/20261004_adopt_existing_history.sql'),'utf8'));
  // Match the real cycle timestamp trigger; adoption must preserve its timestamp.
  await db.exec(`CREATE FUNCTION set_crop_assignments_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now(); RETURN NEW; END$$;
    CREATE TRIGGER crop_assignments_set_updated_at BEFORE UPDATE ON crop_assignments FOR EACH ROW EXECUTE FUNCTION set_crop_assignments_updated_at();`);
  let tail=Promise.resolve();
  pool={async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;
    return {release,query:(sql,args)=>db.query(sql,args)};}};
});
after(async()=>db?.close());
async function fixture(activity='fumigacion',relations=true){
  const companyId=randomUUID(),actorId=randomUUID(),planningId=randomUUID(),productId=randomUUID(),lotId=randomUUID(),ppId=randomUUID(),usageId=randomUUID(),cropId=randomUUID(),campaignId=randomUUID(),cycleId=randomUUID();
  await db.query("INSERT INTO companies(id,name,inventory_control_start_date) VALUES($1,'Synthetic','2026-09-24')",[companyId]);
  await db.query("INSERT INTO users(id,company_id,email,role,enabled) VALUES($1,$2,$3,3,true)",[actorId,companyId,actorId+'@example.test']);
  await db.query("INSERT INTO products(id,company_id,name,unit,total_quantity,available_quantity) VALUES($1,$2,'Test','kg',10,10)",[productId,companyId]);
  await db.query("INSERT INTO lots(id,company_id,name,area) VALUES($1,$2,'Lote A',2)",[lotId,companyId]);
  await db.query("INSERT INTO crops(id,company_id,name) VALUES($1,$2,'Cultivo')",[cropId,companyId]);
  await db.query("INSERT INTO campaigns(id,company_id,name,start_date) VALUES($1,$2,'Campaña','2020-01-01')",[campaignId,companyId]);
  await db.query(`INSERT INTO planning(id,company_id,activity_type,status,responsible_user,start_at,end_at,effective_date,crop_id,campaign_id)
    VALUES($1,$2,$3,'completado',$4,'2020-01-01','2020-01-02','2020-01-01',$5,$6)`,[planningId,companyId,activity,actorId,cropId,campaignId]);
  if(relations){
    await db.query('INSERT INTO planning_lots(planning_id,lot_id,area_ha) VALUES($1,$2,1.5)',[planningId,lotId]);
    await db.query("INSERT INTO planning_products(id,planning_id,product_id,amount,unit) VALUES($1,$2,$3,3,'kg')",[ppId,planningId,productId]);
    await db.query(`INSERT INTO usage_records(id,company_id,product_id,amount_used,unit,date,user_id,source_planning_id,source_planning_product_id)
      VALUES($1,$2,$3,2,'kg','2020-01-01',$4,$5,$6)`,[usageId,companyId,productId,actorId,planningId,ppId]);
    await db.query('INSERT INTO usage_lots(usage_id,lot_id) VALUES($1,$2)',[usageId,lotId]);
    await db.query('INSERT INTO planning_product_completions(planning_id,planning_product_id,usage_id,actual_amount) VALUES($1,$2,$3,2)',[planningId,ppId,usageId]);
    if(activity==='siembra')await db.query(`INSERT INTO crop_assignments(id,company_id,campaign_id,lot_id,crop_id,start_date,area_ha,source_planning_id)
      VALUES($1,$2,$3,$4,$5,'2020-01-01',1.5,$6)`,[cycleId,companyId,campaignId,lotId,cropId,planningId]);
  }
  const inventoryBatch=randomUUID();
  await db.query(`INSERT INTO stock_batches(id,company_id,product_id,initial_quantity,available_quantity,unit,origin,created_by,received_date)
    VALUES($1,$2,$3,10,10,'kg','purchase',$4,'2026-09-24')`,[inventoryBatch,companyId,productId,actorId]);
  await db.query(`INSERT INTO stock_movements(company_id,product_id,batch_id,movement_type,quantity,unit,operation_id,idempotency_key,request_hash,created_by)
    VALUES($1,$2,$3,'receipt',10,'kg',$4,'receipt',repeat('a',64),$5)`,[companyId,productId,inventoryBatch,randomUUID(),actorId]);
  const input={companyId,actorId,planningIds:[planningId],key:randomUUID(),confirmed:true};
  const prepare=()=>adoption.prepare(pool,input),confirm=()=>adoption.confirm(pool,input);
  const stockSnapshot=async()=> (await db.query('SELECT history_internal.inventory_snapshot($1) AS s',[companyId])).rows[0].s;
  return {...input,input,planningId,productId,ppId,usageId,lotId,cycleId,cropId,campaignId,prepare,confirm,stockSnapshot};
}
for(const activity of ['siembra','fumigacion','fertilizacion'])test(`${activity}: preserva grafo, IDs, fechas, cantidades, superficies, inventario y permite corrección histórica`,async()=>{
  const x=await fixture(activity),preview=await x.prepare(),before=await x.stockSnapshot();
  assert.equal(preview.persisted,false);assert.equal(preview.can_confirm,true);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_events WHERE company_id=$1',[x.companyId])).rows[0].n,0);
  const original=preview.items[0].graph;
  const result=await x.confirm();assert.equal(result.stock_unchanged,true);assert.equal(result.stock_movements_created,0);
  for(const t of ['planning','usage_records','crop_assignments'])for(const r of original[t]){
    const row=(await db.query(`SELECT to_jsonb(x) r FROM ${t} x WHERE id=$1`,[r.id])).rows[0].r;
    assert.equal(row.inventory_impact_mode,'HISTORICAL_NO_STOCK');assert.equal(row.historical_import_id,result.import_id);
    delete row.inventory_impact_mode;delete row.historical_import_id;
    const old={...r};delete old.inventory_impact_mode;delete old.historical_import_id;assert.deepEqual(row,old);
  }
  for(const t of ['planning_lots','planning_products','planning_product_completions']){
    const rows=(await db.query(`SELECT to_jsonb(x) r FROM ${t} x WHERE planning_id=$1`,[x.planningId])).rows.map(x=>x.r);
    assert.deepEqual(rows,original[t]);
  }
  assert.deepEqual((await db.query('SELECT to_jsonb(x) r FROM usage_lots x WHERE usage_id=$1',[x.usageId])).rows.map(x=>x.r),original.usage_lots);
  assert.deepEqual(await x.stockSnapshot(),before);
  const event=(await db.query('SELECT * FROM historical_events WHERE entity_id=$1',[x.planningId])).rows[0];
  assert.equal(event.actor_id,x.actorId);assert.equal(event.after_data.confirmed_no_stock,true);assert.equal(event.after_data.inventory_control_start_date,'2026-09-24');
  assert.deepEqual(await x.confirm(),{...result,replayed:true});
  await assert.rejects(adoption.confirm(pool,{...x.input,planningIds:[randomUUID()]}),e=>e.status===409);
  assert.equal((await x.prepare()).can_confirm,false);
  await assert.rejects(db.query("UPDATE planning SET inventory_impact_mode='NORMAL' WHERE id=$1",[x.planningId]),/immutable/);
  await mutation.mutate(pool,{companyId:x.companyId,actorId:x.actorId,table:'planning',id:x.planningId,
    body:{title:'Corregido',products:[{planning_product_id:x.ppId,amount:'4',actual_amount:'3'}]}});
  assert.deepEqual(await x.stockSnapshot(),before);
});
for(const date of ['2026-09-24','2026-09-25'])test(`rechaza fecha ${date}, sin escrituras`,async()=>{
  const x=await fixture();await db.query('UPDATE planning SET effective_date=$2 WHERE id=$1',[x.planningId,date]);
  assert.equal((await x.prepare()).can_confirm,false);assert.equal((await x.confirm()).conflict,true);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_imports WHERE company_id=$1',[x.companyId])).rows[0].n,0);
});
test('sin relaciones conserva ausencia; fecha fallback respeta día argentino',async()=>{
  const x=await fixture('siembra',false);
  await db.query("UPDATE planning SET effective_date=NULL,end_at='2026-09-24T02:00:00Z' WHERE id=$1",[x.planningId]);
  const p=await x.prepare();assert.equal(p.items[0].effective_date,'2026-09-23');assert.equal(p.can_confirm,true);
  await x.confirm();assert.equal((await db.query('SELECT count(*)::int n FROM usage_records WHERE source_planning_id=$1',[x.planningId])).rows[0].n,0);
});
test('tenant ajeno, permisos efectivos, no Admin y confirmación explícita',async()=>{
  const x=await fixture(),foreign=await fixture();
  const p=await adoption.prepare(pool,{...x.input,planningIds:[foreign.planningId]});assert.equal(p.can_confirm,false);assert.equal(p.items[0].graph,null);
  for(const permissions of [[],['planning.edit'],['history.import']]){
    await db.query('UPDATE users SET custom_permissions=$2::text::jsonb WHERE id=$1',[x.actorId,JSON.stringify(permissions)]);
    await assert.rejects(x.prepare(),e=>e.status===403);await assert.rejects(x.confirm(),e=>e.status===403);
  }
  await db.query("UPDATE users SET role=0,custom_permissions='[\"planning.edit\",\"history.import\"]' WHERE id=$1",[x.actorId]);
  await assert.rejects(x.confirm(),e=>e.status===403);
  await assert.rejects(adoption.confirm(pool,{...foreign.input,confirmed:false}),e=>e.status===400);
});
test('movimiento V1 directo o indirecto bloquea incluso después de un preview válido',async()=>{
  const x=await fixture();assert.equal((await x.prepare()).can_confirm,true);
  const b=randomUUID();await db.query(`INSERT INTO stock_batches(id,company_id,product_id,initial_quantity,available_quantity,unit,origin,created_by)
    VALUES($1,$2,$3,10,8,'kg','adjustment',$4)`,[b,x.companyId,x.productId,x.actorId]);
  await db.query(`INSERT INTO stock_movements(company_id,product_id,batch_id,movement_type,quantity,unit,usage_id,operation_id,idempotency_key,request_hash,created_by)
    VALUES($1,$2,$3,'consumption',-2,'kg',$4,$5,'test',repeat('a',64),$6)`,[x.companyId,x.productId,b,x.usageId,randomUUID(),x.actorId]);
  const before=await x.stockSnapshot();assert.equal((await x.confirm()).conflict,true);assert.deepEqual(await x.stockSnapshot(),before);
  await db.query("UPDATE stock_movements SET movement_type='adjustment_out',usage_id=NULL,operation_id=$2 WHERE company_id=$1 AND movement_type='consumption'",[x.companyId,x.planningId]);
  assert.equal((await x.prepare()).can_confirm,false);
});
test('inconsistencias entre completion y uso o tenant de lote bloquean sin exponer filas ajenas',async()=>{
  const x=await fixture();await db.query('UPDATE planning_product_completions SET actual_amount=99 WHERE planning_id=$1',[x.planningId]);
  assert.equal((await x.prepare()).can_confirm,false);
  await db.query('UPDATE planning_product_completions SET actual_amount=2 WHERE planning_id=$1',[x.planningId]);
  const other=await fixture();await db.query('UPDATE planning_lots SET lot_id=$2 WHERE planning_id=$1',[x.planningId,other.lotId]);
  const p=await x.prepare();assert.equal(p.can_confirm,false);assert.equal(p.items[0].graph,null);
});
test('vía ordinaria y flag de sesión no permiten cambiar modo; funciones privadas inaccesibles',async()=>{
  const x=await fixture();
  await assert.rejects(db.query("UPDATE planning SET inventory_impact_mode='HISTORICAL_NO_STOCK' WHERE id=$1",[x.planningId]),/immutable/);
  await db.exec("SET app.history_adoption='true'");
  await assert.rejects(db.query("UPDATE planning SET inventory_impact_mode='HISTORICAL_NO_STOCK' WHERE id=$1",[x.planningId]),/immutable/);
  await db.exec('SET ROLE authenticated');
  try {await assert.rejects(db.query('SELECT public.confirm_history_adoption($1,$2,$3::uuid[],$4,true)',[x.companyId,x.actorId,[x.planningId],x.key]),/permission denied/);}
  finally{await db.exec('RESET ROLE');}
  assert.equal((await db.query('SELECT count(*)::int n FROM history_internal.adoption_permits')).rows[0].n,0);
});
test('lote de adopción atómico si un registro se vuelve inelegible',async()=>{
  const x=await fixture(),bad=randomUUID();
  const r=await adoption.confirm(pool,{...x.input,planningIds:[x.planningId,bad]});assert.equal(r.conflict,true);
  assert.equal((await db.query('SELECT inventory_impact_mode FROM planning WHERE id=$1',[x.planningId])).rows[0].inventory_impact_mode,'NORMAL');
});
test('preview obsoleto revalida corte, estado y permisos; todo permanece NORMAL',async()=>{
  for(const change of ['cutoff','status','permission']) {
    const x=await fixture();assert.equal((await x.prepare()).can_confirm,true);
    if(change==='cutoff')await db.query("UPDATE companies SET inventory_control_start_date='2020-01-01' WHERE id=$1",[x.companyId]);
    if(change==='status')await db.query("UPDATE planning SET status='pendiente' WHERE id=$1",[x.planningId]);
    if(change==='permission')await db.query("UPDATE users SET custom_permissions='[]' WHERE id=$1",[x.actorId]);
    if(change==='permission')await assert.rejects(x.confirm(),e=>e.status===403);
    else assert.equal((await x.confirm()).conflict,true);
    assert.equal((await db.query('SELECT inventory_impact_mode FROM usage_records WHERE id=$1',[x.usageId])).rows[0].inventory_impact_mode,'NORMAL');
  }
});
test('ciclo con cierre o cosecha vinculada exige revisión, sin modificar otras entidades',async()=>{
  const x=await fixture('siembra');
  await db.query(`INSERT INTO harvest_cycle_closures(company_id,crop_assignment_id,finalized_date,reason,created_by,total_area_ha,harvested_area_ha,remaining_area_ha)
    VALUES($1,$2,'2020-02-01','weather',$3,1.5,0,1.5)`,[x.companyId,x.cycleId,x.actorId]);
  const preview=await x.prepare();assert.equal(preview.can_confirm,false);assert.match(preview.items[0].blockers.join(' '),/cosechas o cierres/);
  assert.equal((await x.confirm()).conflict,true);
});
test('rollback total ante efecto secundario en inventario, auditoría o relaciones',async()=>{
  const x=await fixture('siembra'),before=await x.stockSnapshot();
  await db.exec(`CREATE FUNCTION sabotage_adoption() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.inventory_impact_mode='HISTORICAL_NO_STOCK' THEN
      UPDATE products SET available_quantity=available_quantity+1 WHERE company_id=NEW.company_id;
    END IF; RETURN NEW; END$$;
    CREATE TRIGGER sabotage_adoption AFTER UPDATE ON usage_records FOR EACH ROW EXECUTE FUNCTION sabotage_adoption();`);
  try {await assert.rejects(x.confirm(),e=>e.status===409 && /inventario/.test(e.message));}
  finally {await db.exec('DROP TRIGGER sabotage_adoption ON usage_records; DROP FUNCTION sabotage_adoption();');}
  assert.deepEqual(await x.stockSnapshot(),before);
  for(const t of ['planning','usage_records','crop_assignments'])assert.equal((await db.query(`SELECT inventory_impact_mode FROM ${t} WHERE company_id=$1`,[x.companyId])).rows[0].inventory_impact_mode,'NORMAL');
  for(const t of ['historical_imports','historical_events'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${t} WHERE company_id=$1`,[x.companyId])).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM history_internal.adoption_permits')).rows[0].n,0);
});
test('reintentos concurrentes conservan un único evento y una única importación',async()=>{
  const x=await fixture();const results=await Promise.all([x.confirm(),x.confirm()]);
  assert.equal(results[0].import_id,results[1].import_id);assert.equal(results[1].replayed,true);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_events WHERE entity_id=$1',[x.planningId])).rows[0].n,1);
});

test('endpoints reales: autenticación, permisos, tenant del actor y PATCH histórico',async t=>{
  const express=require('express'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
  const load=(file,overrides)=>{const filename=path.resolve(__dirname,'..',file),actual=createRequire(filename),module={exports:{}};
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:n=>Object.hasOwn(overrides,n)?overrides[n]:actual(n)},{filename});return module.exports;};
  const router=load('routes/history.js',{'../db/supabaseClient':{pool}});
  const middleware=load('middleware/historicalOperations.js',{'../db/supabaseClient':{pool}});
  const app=express();app.use(express.json());
  app.use(async(req,res,next)=>{
    if(!req.headers['x-test-actor'])return res.sendStatus(401);
    req.user=(await db.query('SELECT * FROM users WHERE id=$1',[req.headers['x-test-actor']])).rows[0];
    if(!req.user)return res.sendStatus(403);next();
  });
  app.use('/api/history',router);
  app.patch('/api/planning/:id',require('../middleware/requirePermission')('planning.edit'),middleware.historical('planning'),()=>{throw new Error('Ordinary completion must not run');});
  app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const x=await fixture(),other=await fixture();
  const request=(suffix,body,actor=x.actorId,method='POST')=>fetch(`http://127.0.0.1:${server.address().port}/api/${suffix}`,{
    method,headers:{'Content-Type':'application/json','Idempotency-Key':x.key,...(actor?{'x-test-actor':actor}:{})},body:JSON.stringify(body)});
  assert.equal((await request('history/adopt-existing/prepare',{planning_ids:[x.planningId]},null)).status,401);
  for(const p of [['planning.edit'],['history.import']]){
    await db.query('UPDATE users SET custom_permissions=$2::text::jsonb WHERE id=$1',[x.actorId,JSON.stringify(p)]);
    assert.equal((await request('history/adopt-existing/prepare',{planning_ids:[x.planningId]})).status,403);
  }
  await db.query('UPDATE users SET custom_permissions=NULL WHERE id=$1',[x.actorId]);
  const bad=await request('history/adopt-existing/confirm',{planning_ids:[other.planningId],company_id:other.companyId,confirmed_no_stock:true});
  assert.equal(bad.status,409);
  assert.equal((await request('history/adopt-existing/confirm',{planning_ids:[x.planningId],confirmed_no_stock:true})).status,200);
  assert.equal((await request(`planning/${x.planningId}`,{title:'PATCH histórico'},x.actorId,'PATCH')).status,200);
  assert.equal((await db.query('SELECT title FROM planning WHERE id=$1',[x.planningId])).rows[0].title,'PATCH histórico');
  assert.equal((await request(`planning/${x.planningId}`,{inventory_impact_mode:'NORMAL'},x.actorId,'PATCH')).status,409);
});
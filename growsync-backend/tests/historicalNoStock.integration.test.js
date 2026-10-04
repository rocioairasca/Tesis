// Embedded PostgreSQL only: never loads .env or the production DB client.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const history=require('../services/historicalImport');
const mutation=require('../services/historicalMutation');
const completion=require('../services/planningCompletion');
const stock=require('../services/stock');
const {HISTORICAL}=require('../services/inventoryImpact');
// Use postgres.js's installed serializers without creating a client or opening a socket.
// For these explicit casts, ::jsonb binds OID 3802; ::text::jsonb binds OID 25.
const {types:postgresTypes}=require(path.join(path.dirname(require.resolve('postgres')),'types.js'));
function serializeExplicitJsonParameters(sql,args=[]){
  const values=[...args];
  for(const [,position,textCast] of sql.matchAll(/\$(\d+)::(text::)?jsonb\b/g)){
    const index=Number(position)-1;
    if(values[index]!=null) values[index]=(textCast?postgresTypes.string:postgresTypes.json).serialize(args[index]);
  }
  return values;
}
async function database(t,migrate=true,postgresJson=false){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(fs.readFileSync(path.join(__dirname,'historySchema.fixture.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../migrations/20261007_planning_effective_area.sql'),'utf8'));
  if(migrate) await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20260916_historical_no_stock.sql'),'utf8'));
  let tail=Promise.resolve();const queries=[];
  const pool={async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;
    return {release,query(sql,args){queries.push(sql);return db.query(sql,postgresJson?serializeExplicitJsonParameters(sql,args):args)}};}};
  return {db,pool,queries};
}
async function fixture(t,v1=false,postgresJson=false){
  const x=await database(t,true,postgresJson),companyId=randomUUID(),actorId=randomUUID(),productId=randomUUID(),lotId=randomUUID();
  const {db}=x;
  await db.query("INSERT INTO companies(id,name) VALUES($1,'Test')",[companyId]);
  await db.query("INSERT INTO users(id,company_id,email,role,enabled) VALUES($1,$2,$3,3,true)",[actorId,companyId,actorId+'@example.test']);
  await db.query("INSERT INTO products(id,company_id,name,unit,total_quantity,available_quantity) VALUES($1,$2,'Test','kg',10,10)",[productId,companyId]);
  await db.query("INSERT INTO lots(id,company_id,name,area) VALUES($1,$2,'Test',2)",[lotId,companyId]);
  const planningId=randomUUID(),ppId=randomUUID(),usageId=randomUUID();
  const records={planning:[{id:planningId,title:'Original',description:'Preservar\n texto',company_id:companyId,activity_type:'fumigacion',status:'completado',responsible_user:actorId,created_by:actorId,start_at:'2020-01-01T00:00:00Z',end_at:'2020-01-01T00:00:00Z',effective_date:'2020-01-01'}],
    planning_lots:[{planning_id:planningId,lot_id:lotId,sub_lot_id:null,area_ha:2}],
    planning_products:[{id:ppId,planning_id:planningId,product_id:productId,amount:30,unit:'kg'}],
    usage_records:[{id:usageId,company_id:companyId,product_id:productId,amount_used:30,unit:'kg',date:'2020-01-01',user_id:actorId,created_by:actorId,source_planning_id:planningId,source_planning_product_id:ppId}],
    usage_lots:[{usage_id:usageId,lot_id:lotId,sub_lot_id:null}],
    planning_product_completions:[{planning_id:planningId,planning_product_id:ppId,usage_id:usageId,actual_amount:30}]};
  if(v1){await stock.transaction(x.pool,c=>stock.receiveStock(c,{companyId,actorId,productId,unit:'kg',quantity:10,origin:'purchase',received_date:'2020-01-01',key:randomUUID()}));}


  const args={companyId,actorId,key:randomUUID(),source:'test',confirmedNoStock:true,records};
  const snapshot=async()=>Object.fromEntries(await Promise.all(['products','stock_batches','stock_movements','notifications'].map(async table=>[table,(await db.query('SELECT * FROM '+table+' ORDER BY id')).rows])));
  const edit=(body={},enabled,table='planning',id=planningId)=>mutation.mutate(x.pool,{companyId,actorId,table,id,body,enabled});
  return {...x,...args,args,planningId,ppId,usageId,productId,lotId,snapshot,edit};
}
test('postgres.js JSON serializers persist historical manifests/results and audit snapshots as objects with nested arrays',async t=>{
  const x=await fixture(t,true,true),beforeStock=await x.snapshot();
  // Control: prove this harness reproduces double encoding for the original cast.
  for(const value of [{text:'Línea "uno"\nárea',items:[1,null]},[1,{nested:true}]]){
    const {rows:[types]}=await stock.transaction(x.pool,c=>c.query(
      'SELECT jsonb_typeof($1::jsonb) AS original, jsonb_typeof($2::text::jsonb) AS fixed',
      [JSON.stringify(value),JSON.stringify(value)]));
    assert.equal(types.original,'string');
    assert.equal(types.fixed,Array.isArray(value)?'array':'object');
  }
  const result=await history.importHistory(x.pool,x.args);
  const {rows:[saved]}=await x.db.query(`SELECT payload,result,jsonb_typeof(payload) AS payload_type,
    jsonb_typeof(result) AS result_type,jsonb_typeof(payload->'planning') AS planning_type,
    jsonb_typeof(result->'counts') AS counts_type FROM historical_imports WHERE id=$1`,[result.import_id]);
  assert.equal(saved.payload_type,'object');
  assert.equal(saved.result_type,'object');
  assert.equal(saved.planning_type,'array');
  assert.equal(saved.counts_type,'object');
  assert.deepEqual(saved.payload,x.records);
  assert.deepEqual(saved.result,result);
  assert.deepEqual(await history.importHistory(x.pool,x.args),{...result,replayed:true});
  const body={title:'Corrección "área"',description:'Primera línea\nSegunda \\ línea',
    products:[{planning_product_id:x.ppId,amount:'35',actual_amount:'32'}],
    lot_selections:[{lot_id:x.lotId,sub_lot_id:null,area_ha:1.5}]};
  await x.edit(body);
  const {rows:[event]}=await x.db.query(`SELECT before_data,after_data,
    jsonb_typeof(before_data) AS before_type,jsonb_typeof(after_data) AS after_type,
    jsonb_typeof(before_data->'products') AS products_type,
    jsonb_typeof(before_data->'lots') AS lots_type,jsonb_typeof(before_data->'usages') AS usages_type,
    jsonb_typeof(after_data->'request') AS request_type,
    jsonb_typeof(after_data->'request'->'products') AS request_products_type,
    jsonb_typeof(after_data->'request'->'lot_selections') AS request_lots_type
    FROM historical_events WHERE entity_id=$1`,[x.planningId]);
  for(const key of ['before_type','after_type','request_type']) assert.equal(event[key],'object');
  for(const key of ['products_type','lots_type','usages_type','request_products_type','request_lots_type']) assert.equal(event[key],'array');
  assert.equal(event.before_data.title,x.records.planning[0].title);
  assert.equal(event.before_data.description,x.records.planning[0].description);
  assert.equal(event.after_data.title,body.title);
  assert.equal(event.after_data.description,body.description);
  assert.deepEqual(event.after_data.request,body);
  assert.deepEqual(await x.snapshot(),beforeStock);
});
for(const v1 of [false,true])test(`historical import/edit/disable/restore leaves every stock column and alert unchanged (${v1?'con partidas':'sin partidas'})`,async t=>{
  const x=await fixture(t,v1),before=await x.snapshot();
  const result=await history.importHistory(x.pool,x.args);
  assert.equal(result.counts.usage_records,1);
  assert.deepEqual(await x.snapshot(),before);
  if(v1){
    const batch=before.stock_batches[0];
    await assert.rejects(x.db.query(`INSERT INTO stock_movements(company_id,product_id,batch_id,movement_type,quantity,unit,usage_id,operation_id,idempotency_key,request_hash,created_by)
      VALUES($1,$2,$3,'consumption',-1,'kg',$4,$5,'forbidden',$6,$7)`,[x.companyId,x.productId,batch.id,x.usageId,randomUUID(),'a'.repeat(64),x.actorId]),/Historical usage cannot/);
  }
  await x.edit({title:'Corregido',description:'Texto exacto\nsegunda línea',effective_date:'2020-01-02',start_at:'2020-01-02T00:00:00Z',end_at:'2020-01-02T00:00:00Z',products:[{planning_product_id:x.ppId,actual_amount:'300',amount:'350'}],lot_selections:[{lot_id:x.lotId,sub_lot_id:null,area_ha:1.5}]});
  assert.equal((await x.db.query('SELECT amount_used FROM usage_records WHERE id=$1',[x.usageId])).rows[0].amount_used,'300');
  assert.equal(Number((await x.db.query('SELECT amount FROM planning_products WHERE id=$1',[x.ppId])).rows[0].amount),350);
  assert.equal(Number((await x.db.query('SELECT actual_amount FROM planning_product_completions WHERE planning_product_id=$1',[x.ppId])).rows[0].actual_amount),300);
  assert.equal(Number((await x.db.query('SELECT area_ha FROM planning_lots WHERE planning_id=$1',[x.planningId])).rows[0].area_ha),1.5);
  assert.equal((await x.db.query('SELECT inventory_impact_mode FROM planning WHERE id=$1',[x.planningId])).rows[0].inventory_impact_mode,HISTORICAL);
  assert.deepEqual(await x.snapshot(),before);
  await x.edit({},false);assert.equal((await x.db.query('SELECT enabled FROM usage_records WHERE id=$1',[x.usageId])).rows[0].enabled,false);
  await x.edit({},true);await x.edit({},true);
  assert.deepEqual(await x.snapshot(),before);
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_events')).rows[0].n,4);
  const repeated=await history.importHistory(x.pool,x.args);assert.equal(repeated.replayed,true);
  for(const table of ['planning','usage_records','planning_products','planning_product_completions'])assert.equal((await x.db.query('SELECT count(*)::int n FROM '+table)).rows[0].n,1);
  await assert.rejects(x.edit({inventory_impact_mode:'NORMAL'}),/inmutable/);
  await assert.rejects(x.db.query("UPDATE planning SET inventory_impact_mode='NORMAL' WHERE id=$1",[x.planningId]),/immutable/);
  await assert.rejects(stock.transaction(x.pool,c=>stock.consumeStock(c,{companyId:x.companyId,actorId:x.actorId,productId:x.productId,usageId:x.usageId,unit:'kg',quantity:1,key:randomUUID()})),/antecedente/);
  assert.deepEqual(await x.snapshot(),before);
});
test('historical correction requires history.import and rejects ordinary product payloads atomically',async t=>{
  const x=await fixture(t,true);
  await history.importHistory(x.pool,x.args);
  const before=await x.snapshot();
  await x.db.query('UPDATE users SET custom_permissions=$2 WHERE id=$1',[x.actorId,JSON.stringify(['planning.edit'])]);
  await assert.rejects(x.edit({products:[{planning_product_id:x.ppId,amount:5,actual_amount:4}]}),{status:403});
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_events')).rows[0].n,0);
  await x.db.query('UPDATE users SET custom_permissions=$2 WHERE id=$1',[x.actorId,JSON.stringify(['planning.edit','history.import'])]);
  await assert.rejects(x.edit({products:[{product_id:x.productId,unit:'kg',amount:5}]}),/producto inválida/);
  await assert.rejects(x.edit({status:'pendiente'}),/Campo no editable/);
  await assert.rejects(x.edit({products:[{planning_product_id:randomUUID(),actual_amount:4}]}),/producto registrado/);
  assert.equal(Number((await x.db.query('SELECT amount FROM planning_products WHERE id=$1',[x.ppId])).rows[0].amount),30);
  assert.deepEqual(await x.snapshot(),before);
});
test('NORMAL edit falls through historical mutation without changing data or requiring history.import',async t=>{
  const x=await fixture(t);
  await x.db.query("INSERT INTO planning(id,company_id,activity_type,status,start_at,end_at,responsible_user) VALUES($1,$2,'fumigacion','pendiente','2020-01-01','2020-01-01',$3)",[x.planningId,x.companyId,x.actorId]);
  await x.db.query('UPDATE users SET custom_permissions=$2 WHERE id=$1',[x.actorId,JSON.stringify(['planning.edit'])]);
  assert.equal(await x.edit({status:'en_progreso',products:[{product_id:x.productId,amount:2,unit:'kg'}]}),null);
  assert.equal((await x.db.query('SELECT status FROM planning WHERE id=$1',[x.planningId])).rows[0].status,'pendiente');
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_events')).rows[0].n,0);
});
test('all Planning read projections retain IDs and optional actual amounts via LEFT JOIN',async t=>{
  const x=await fixture(t);
  await history.importHistory(x.pool,x.args);
  const controller=fs.readFileSync(path.join(__dirname,'../controllers/planning.js'),'utf8');
  const projections=[...controller.matchAll(/SELECT json_agg\(json_build_object\('id', pp.id,[\s\S]*?WHERE pp.planning_id = b.id/g)];
  assert.equal(projections.length,3);
  for(const [projection] of projections){
    const read=()=>x.db.query(`SELECT (${projection}) AS products FROM planning b WHERE b.id=$1`,[x.planningId]);
    const [product]=(await read()).rows[0].products;
    assert.equal(product.planning_product_id,x.ppId);
    assert.equal(product.id,x.ppId);
    assert.equal(product.product_id,x.productId);
    assert.equal(product.actual_amount,30);
    assert.equal(product.usage_id,x.usageId);
  }
  await x.db.query('DELETE FROM planning_product_completions WHERE planning_product_id=$1',[x.ppId]);
  for(const [projection] of projections){
    const [product]=(await x.db.query(`SELECT (${projection}) AS products FROM planning b WHERE b.id=$1`,[x.planningId])).rows[0].products;
    assert.equal(product.id,x.ppId);
    assert.equal(product.actual_amount,null);
    assert.equal(product.usage_id,null);
  }
});
for(const v1 of [false,true])for(const historical of [false,true])test(`completion ${historical?'HISTORICAL':'NORMAL'} / ${v1?'con partidas':'sin partidas'}`,async t=>{
  const x=await fixture(t,v1);const mode=historical?HISTORICAL:'NORMAL';
  await x.db.query(`INSERT INTO planning(id,company_id,activity_type,status,start_at,end_at,responsible_user,inventory_impact_mode)
    VALUES($1,$2,'fumigacion','pendiente','2020-01-01','2020-01-01',$3,$4)`,[x.planningId,x.companyId,x.actorId,mode]);
  await x.db.query('INSERT INTO planning_products(id,planning_id,product_id,amount,unit) VALUES($1,$2,$3,3,\'kg\')',[x.ppId,x.planningId,x.productId]);
  const before=await x.snapshot();
  const run = () => stock.transaction(x.pool,client=>completion.applyPlanningProductUsage(client,{companyId:x.companyId,actorId:x.actorId,
    planning:{id:x.planningId,inventory_impact_mode:mode,responsible_user:x.actorId},selections:[{lot_id:x.lotId,area_ha:2}],
    plannedProducts:[{id:x.ppId,product_id:x.productId,unit:'kg',amount:3}],effectiveDate:'2020-01-01'}));
  if(!historical && !v1){
    await assert.rejects(run,e=>e.status===409 && /stock.*insuficiente/i.test(e.message));
    assert.deepEqual(await x.snapshot(),before);
    assert.equal((await x.db.query('SELECT count(*)::int n FROM planning_product_completions')).rows[0].n,0);
    return;
  }
  await run();
  const after=await x.snapshot();
  if(historical)assert.deepEqual(after,before);
  else if(v1){assert.equal(after.stock_batches[0].available_quantity,'7.000000');assert.equal(after.stock_movements.length,before.stock_movements.length+1);}
  else assert.equal(after.products[0].available_quantity,'7');
  assert.equal((await x.db.query('SELECT count(*)::int n FROM planning_product_completions')).rows[0].n,1);
  assert.equal((await x.db.query('SELECT inventory_impact_mode FROM usage_records')).rows[0].inventory_impact_mode,mode);
});
test('permission, tenant, conflicting retry and partial failure roll back the whole manifest',async t=>{
  const x=await fixture(t);
  await x.db.query('UPDATE users SET role=1 WHERE id=$1',[x.actorId]);
  await assert.rejects(history.importHistory(x.pool,x.args),{status:403});
  await x.db.query('UPDATE users SET custom_permissions=$2 WHERE id=$1',[x.actorId,JSON.stringify(['history.import'])]);
  const foreign=structuredClone(x.args);foreign.records.usage_records[0].company_id=randomUUID();
  await assert.rejects(history.importHistory(x.pool,foreign),{status:403});
  assert.equal((await x.db.query('SELECT count(*)::int n FROM planning')).rows[0].n,0);
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_imports')).rows[0].n,0);
  await history.importHistory(x.pool,x.args);
  await assert.rejects(history.importHistory(x.pool,{...x.args,source:'different'}),/otro contenido/);
  await assert.rejects(history.importHistory(x.pool,{...x.args,key:randomUUID()}));
  assert.equal((await x.db.query('SELECT count(*)::int n FROM usage_records')).rows[0].n,1);
});
test('manual historical Usage supports edits and toggles with V1 enabled',async t=>{
  const x=await fixture(t,true);x.args.records={usage_records:[{...x.records.usage_records[0],source_planning_id:null,source_planning_product_id:null}],usage_lots:x.records.usage_lots};
  const before=await x.snapshot();await history.importHistory(x.pool,x.args);
  await x.edit({amount_used:99,date:'2020-02-01',lot_selections:[{lot_id:x.lotId}]},undefined,'usage_records',x.usageId);
  await x.edit({},false,'usage_records',x.usageId);await x.edit({},true,'usage_records',x.usageId);
  assert.deepEqual(await x.snapshot(),before);
});
test('concurrent import retries produce one graph and one audit import',async t=>{
  const x=await fixture(t);const results=await Promise.all([history.importHistory(x.pool,x.args),history.importHistory(x.pool,x.args)]);
  assert.equal(results.filter(r=>r.replayed).length,1);
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_imports')).rows[0].n,1);
});
test('initial stock preparation uses explicit quantities and does not persist balances',async t=>{
  const x=await fixture(t,true),before=await x.snapshot();
  const prepare=require('../services/stockInitialPlan').prepare;
  const args={companyId:x.companyId,actorId:x.actorId,date:'2020-01-01',entries:[{product_id:x.productId,quantity:'2.75',unit:'kg',expiration_date:'2030-01-01'}]};
  await assert.rejects(prepare(x.pool,args),/inicio de control/);
  await x.db.query("UPDATE companies SET inventory_control_start_date='2020-01-01' WHERE id=$1",[x.companyId]);
  const result=await prepare(x.pool,args);
  assert.equal(result.kind,'STOCK_INITIAL');assert.equal(result.persisted,false);assert.equal(result.entries[0].quantity,'2.750000');
  assert.deepEqual(await x.snapshot(),before);
});
test('migration preserves existing operational values and leaves company start date unconfigured',async t=>{
  const {db}=await database(t,false),companyId=randomUUID(),actorId=randomUUID(),id=randomUUID();
  await db.query("INSERT INTO companies(id,name) VALUES($1,'Existing')",[companyId]);
  await db.query('INSERT INTO users(id,company_id,email) VALUES($1,$2,$3)',[actorId,companyId,actorId+'@example.test']);
  await db.query("INSERT INTO planning(id,company_id,activity_type,status,start_at,end_at,responsible_user,registered_retroactively) VALUES($1,$2,'fumigacion','completado','2020-01-01','2020-01-01',$3,true)",[id,companyId,actorId]);
  const before=(await db.query('SELECT * FROM planning WHERE id=$1',[id])).rows[0];
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20260916_historical_no_stock.sql'),'utf8'));
  const {inventory_impact_mode,historical_import_id,...after}=(await db.query('SELECT * FROM planning WHERE id=$1',[id])).rows[0];
  assert.equal(inventory_impact_mode,'NORMAL');assert.equal(historical_import_id,null);assert.deepEqual(after,before);
  assert.equal((await db.query('SELECT inventory_control_start_date FROM companies WHERE id=$1',[companyId])).rows[0].inventory_control_start_date,null);
  await assert.rejects(db.query("UPDATE planning SET inventory_impact_mode='HISTORICAL_NO_STOCK' WHERE id=$1",[id]),/immutable/);
});
// Optional local acceptance fixture. The backup is read only; all writes are in WASM memory.
test('backup acceptance: 24 Planning / 24 Usage / 25 products / 24 completions / 10 harvests / 12 assignments',
  {skip:!process.env.HISTORICAL_BACKUP_DIR},async t=>{
  const x=await database(t),dir=process.env.HISTORICAL_BACKUP_DIR;
  const data=table=>JSON.parse(fs.readFileSync(path.join(dir,'data',table+'.json'),'utf8'));
  const companyId=data('companies')[0].id,actorId=data('users').find(u=>u.role===3)?.id||data('users')[0].id;
  for(const table of ['companies','users','products','crops','campaigns','lots','lot_layouts','sub_lots'])for(const row of data(table)){
    const entries=Object.entries(row);await x.db.query('INSERT INTO '+table+' ('+entries.map(([k])=>k).join(',')+') VALUES('+entries.map((_,i)=>'$'+(i+1)).join(',')+')',entries.map(([,v])=>v));
  }
  await x.db.query('UPDATE users SET custom_permissions=$2 WHERE id=$1',[actorId,JSON.stringify(['history.import'])]);
  const real=data('harvest_records').filter(h=>h.harvest_date>='2026-08-31');assert.equal(real.length,1);
  const link=data('harvest_crop_assignments').find(h=>h.harvest_id===real[0].id);
  const assignment=data('crop_assignments').find(a=>a.id===link.crop_assignment_id);
  const keepPlanning=assignment.source_planning_id;
  const records=Object.fromEntries(history.TABLES.map(table=>[table,data(table).filter(row=>{
    if(table==='planning')return row.id!==keepPlanning;
    if(table==='planning_lots')return row.planning_id!==keepPlanning;
    if(table==='crop_assignments')return row.id!==assignment.id;
    if(table==='harvest_records')return row.id!==real[0].id;
    if(table==='harvest_crop_assignments')return row.harvest_id!==real[0].id;
    return true;
  })]));
  // Seed the protected chain unchanged, as the reset plan requires.
  for(const [table,rows] of [['planning',data('planning').filter(p=>p.id===keepPlanning)],['planning_lots',data('planning_lots').filter(p=>p.planning_id===keepPlanning)],['crop_assignments',[assignment]],['harvest_records',real],['harvest_crop_assignments',[link]]]){
    const {rows:cols}=await x.db.query("SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND is_generated='NEVER'",[table]);
    for(const row of rows){const entries=Object.entries(row).filter(([k])=>cols.some(c=>c.column_name===k));await x.db.query('INSERT INTO '+table+' ('+entries.map(([k])=>k).join(',')+') VALUES('+entries.map((_,i)=>'$'+(i+1)).join(',')+')',entries.map(([,v])=>v));}
  }
  const snapshot=async()=>Object.fromEntries(await Promise.all(['products','stock_batches','stock_movements','notifications','lots','lot_layouts','sub_lots'].map(async table=>[table,(await x.db.query('SELECT row_to_json(t)::text value FROM '+table+' t ORDER BY id')).rows])));
  const before=await snapshot();
  const args={companyId,actorId,key:'backup-acceptance',source:'local verified backup',confirmedNoStock:true,records};
  const result=await history.importHistory(x.pool,args);
  assert.deepEqual(result.counts,{planning:24,planning_lots:24,planning_products:25,usage_records:24,usage_lots:14,planning_product_completions:24,crop_assignments:12,harvest_records:10,harvest_crop_assignments:10});
  assert.deepEqual(await snapshot(),before);
  assert.equal((await history.importHistory(x.pool,args)).replayed,true);
  assert.equal((await x.db.query('SELECT count(*)::int n FROM planning')).rows[0].n,25);
  assert.equal((await x.db.query('SELECT inventory_impact_mode FROM harvest_records WHERE id=$1',[real[0].id])).rows[0].inventory_impact_mode,'NORMAL');
  const oldHarvest=records.harvest_records[0];
  await mutation.mutate(x.pool,{companyId,actorId,table:'harvest_records',id:oldHarvest.id,body:{notes:'Revisión histórica'}});
  for(const enabled of [false,true]) await mutation.mutate(x.pool,{companyId,actorId,table:'harvest_records',id:oldHarvest.id,enabled});
  assert.deepEqual(await snapshot(),before);
  await assert.rejects(x.db.query("UPDATE crop_assignments SET end_date=end_date+1 WHERE id=$1",[records.crop_assignments[0].id]),/cannot be recalculated/);
  for(const expected of records.planning){const {rows}=await x.db.query('SELECT title,description FROM planning WHERE id=$1',[expected.id]);assert.equal(rows[0].title,expected.title);assert.equal(rows[0].description,expected.description);}
});

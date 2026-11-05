const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),{randomUUID:uuid}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const econ=require('../services/economicExecution'),stock=require('../services/stock'),valuations=require('../services/stockBatchValuations');
const math=require('../../shared/costEstimate.cjs'),helper=require('./economicExecution.fixture');
let db,pool,controller,queries=[],failEconomic=false,inTransaction=false;
before(async()=>{
 db=new PGlite();await helper.schema(db);
 const client={release(){},async query(sql,args){
   queries.push(sql);
   if(sql==='BEGIN')inTransaction=true;
   if(sql.startsWith('INSERT INTO economic_')){
     assert(inTransaction,'snapshot must join execution transaction');
     if(failEconomic){failEconomic=false;throw Error('Synthetic economic failure');}
   }
   const result=await db.query(sql,args);
   if(['COMMIT','ROLLBACK'].includes(sql))inTransaction=false;
   return result;
 }};
 pool={...client,connect:async()=>client};controller=helper.controller(pool);
});
after(()=>db?.close());
async function put(table,row){const keys=Object.keys(row);return (await db.query('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',Object.values(row))).rows[0];}
async function fixture({amount='186',context='growing_crop',activity='fumigacion',area='93'}={}){
 const company=uuid(),actor=uuid(),crop=uuid(),campaign=uuid(),lot=uuid(),product=uuid(),planning=uuid();
 await put('companies',{id:company,name:'Synthetic economic company'});
 await put('users',{id:actor,company_id:company,email:actor+'@example.test',full_name:'Actor',role:3});
 await put('crops',{id:crop,company_id:company,name:'Maíz'});
 await put('campaigns',{id:campaign,company_id:company,name:'2026',start_date:'2026-01-01',end_date:'2026-12-31'});
 await put('lots',{id:lot,company_id:company,name:'Lote',area:100,area_ha:100});
 await put('products',{id:product,company_id:company,name:'Glifosato',unit:'L',enabled:true});
 await put('planning',{id:planning,company_id:company,activity_type:activity,field_context:context,crop_id:crop,campaign_id:campaign,responsible_user:actor,
  status:'pendiente',start_at:'2026-11-05T00:00:00Z',end_at:'2026-11-05T00:00:00Z'});
 await put('planning_lots',{planning_id:planning,lot_id:lot,area_ha:'100',effective_area_ha:area});
 const pp=await put('planning_products',{planning_id:planning,product_id:product,amount,unit:'L'});
 const user={id:actor,company_id:company,role:3,enabled:true};
 const value=async(batchId,price,supersedes_id=null)=>(await valuations.create(pool,{user,productId:product,batchId,key:uuid(),
  body:{status:price==null?'pending':'confirmed',currency:'USD',unit_cost_original:price,supersedes_id,reason:supersedes_id?'Factura posterior':null}})).valuation;
 const batch=async(qty,price,extra={})=>{
  const b=await put('stock_batches',{company_id:company,product_id:product,initial_quantity:qty,available_quantity:qty,unit:'L',origin:'purchase',received_date:'2026-10-01',created_by:actor,...extra});
  if(price!==undefined)await value(b.id,price);return b.id;
 };
 const call=async(method,body={},requestUser=user)=>{
  let response;
  await controller[method]({user:requestUser,params:{id:planning},body},{status(){return this;},json(data){response=data;return this;}},error=>{throw error;});
  return response;
 };
 const complete=async(economic,extra={})=>call(activity==='fumigacion'?'completeWork':'completeActivity',{effective_date:'2026-11-05',economic,...extra});
 const current=async()=>(await econ.current(pool,{user,planningId:planning})).current;
 const revise=async(body,key=uuid())=>econ.revise(pool,{user,planningId:planning,key,body});
 return {company,actor,crop,campaign,lot,product,planning,pp:pp.id,user,batch,value,call,complete,current,revise};
}
const noLabor={labor:{status:'not_applicable'}};
test('real completion: valued movement, operational dimensions, actual quantities and same transaction',async()=>{
 const x=await fixture();await x.batch('200','3.8');queries=[];
 await x.complete(noLabor,{actual_products:[{planning_product_id:x.pp,actual_amount:'100',unit:'L'}]});
 const r=await x.current();assert.equal(r.total_cost_usd,'380.000000');assert.equal(r.snapshot.campaign_id,x.campaign);
 assert.equal(r.lines[0].quantity,'100.000000');assert.equal(r.lines[0].unit_snapshot,'L');
 assert.equal(r.snapshot.phase,'actual');assert.equal(r.targets[0].beneficiary_crop_id,x.crop);
 assert(queries.indexOf('COMMIT')>queries.findIndex(q=>q.startsWith('INSERT INTO economic_snapshot_lines')));
});
test('two actual batches retain independent evidence and prices',async()=>{
 const x=await fixture(),a=await x.batch('80','3.5',{expiration_date:'2026-12-01'}),b=await x.batch('200','3.9');
 await x.complete(noLabor);const r=await x.current();
 assert.equal(r.lines.length,2);assert.deepEqual(new Set(r.lines.map(l=>l.batch_id)),new Set([a,b]));
 assert.equal(r.total_cost_usd,'693.400000');assert(r.lines.every(l=>l.stock_movement_id&&l.usage_id&&l.batch_valuation_id));
});
test('actual dated movements, never a current FEFO estimate or planned quantity',async()=>{
 const x=await fixture(),a=await x.batch('200','2',{expiration_date:'2026-11-02'});await x.batch('200','9');
 const estimate=require('../services/planningCostEstimate'),original=estimate.estimate;
 estimate.estimate=()=>{throw Error('Must not simulate FEFO');};
 try {await x.complete(noLabor,{effective_date:'2026-11-01'});}finally{estimate.estimate=original;}
 const r=await x.current();assert.equal(r.lines[0].batch_id,a);assert.equal(r.total_cost_usd,'372.000000');
});
for(const mode of ['missing','pending'])test(mode+' valuation does not block execution or invent zero',async()=>{
 const x=await fixture();await x.batch('200',mode==='pending'?null:undefined,{unit_price:'999',currency:'USD',exchange_rate:'1000'});
 await x.complete();const r=await x.current();assert.equal(r.snapshot.economic_status,'pending');
 assert.equal(r.lines.find(l=>l.kind==='product').amount_usd,null);assert.equal(r.total_cost_usd,null);assert.equal(r.cost_per_ha_usd,null);
 assert.equal((await db.query('SELECT status FROM planning WHERE id=$1',[x.planning])).rows[0].status,'completado');
});
test('economic insert failure rolls back usage, movement, completion, status and stock',async()=>{
 const x=await fixture(),b=await x.batch('200','3');failEconomic=true;
 await assert.rejects(x.complete(),/Synthetic economic failure/);
 assert.equal((await db.query('SELECT available_quantity::text FROM stock_batches WHERE id=$1',[b])).rows[0].available_quantity,'200.000000');
 for(const table of ['usage_records','economic_snapshots'])assert.equal((await db.query('SELECT count(*)::int n FROM '+table+' WHERE company_id=$1',[x.company])).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM planning_product_completions WHERE planning_id=$1',[x.planning])).rows[0].n,0);
 assert.equal((await db.query('SELECT status FROM planning WHERE id=$1',[x.planning])).rows[0].status,'pendiente');
});
test('sealed root, lines and targets reject update/delete/truncate and late appends',async()=>{
 const x=await fixture();await x.batch('200','1');await x.complete(noLabor);const r=await x.current();
 for(const table of ['economic_snapshots','economic_snapshot_lines','economic_snapshot_targets']){
  await assert.rejects(db.query('UPDATE '+table+' SET company_id=company_id'),/immutable/);
  await assert.rejects(db.query('DELETE FROM '+table),/immutable/);
  await assert.rejects(db.exec('TRUNCATE '+table+' CASCADE'),/immutable/);
 }
 const l=r.lines[0],{id,...copy}=l;
 await assert.rejects(put('economic_snapshot_lines',copy),/sealed/);
});
test('late invoice only changes explicit new revision; original and confirmed lines remain frozen',async()=>{
 const x=await fixture(),a=await x.batch('100','2',{expiration_date:'2026-12-01'}),b=await x.batch('100');
 await x.complete(noLabor);const first=await x.current(),old=JSON.stringify(first);
 const va=(await valuations.current(pool,{user:x.user,productId:x.product,batchId:a})).current;
 await x.value(a,'99',va.id);await x.value(b,'4');
 assert.equal(JSON.stringify(await x.current()),old);
 await x.revise({supersedes_id:first.snapshot.id,reason:'Factura recibida'});
 const r=await x.current();assert.equal(r.snapshot.revision,2);assert.equal(r.snapshot.supersedes_id,first.snapshot.id);
 assert.equal(r.total_cost_usd,'544.000000');assert.equal(r.lines.find(l=>l.batch_id===a).unit_cost_usd,'2.000000');
 const history=await econ.history(pool,{user:x.user,planningId:x.planning});assert.equal(JSON.stringify(history.data[1]),old);
});
test('USD labor is exact rate times operative area',async()=>{
 const x=await fixture();await x.batch('200','1');await x.complete({labor:{status:'confirmed',currency:'USD',rate_original:'6'}});
 const r=await x.current();assert.equal(r.lines.find(l=>l.kind==='labor').amount_usd,'558.000000000000');
 assert.equal(r.total_cost_usd,'744.000000');assert.equal(r.cost_per_ha_usd,'8.000000');
});
test('ARS manual FX keeps original evidence and payment-date wholesale conversion',async()=>{
 const x=await fixture();await x.batch('200','1');
 await x.complete({labor:{status:'confirmed',currency:'ARS',rate_original:'6000',payment_date:'2026-11-05',fx_date:'2026-11-05',fx_rate:'1000',fx_source:'Comprobante mayorista'}});
 const l=(await x.current()).lines.find(l=>l.kind==='labor');assert.equal(l.amount_original,'558000.000000000000');
 assert.equal(l.amount_usd,'558.000000000000');assert.equal(l.fx_type,'divisa_mayorista');assert.equal(l.fx_source,'Comprobante mayorista');
});
for(const missing of ['payment_date','fx_date','fx_rate','fx_source'])test('confirmed ARS requires '+missing,async()=>{
 const x=await fixture();await x.batch('200','1');
 const labor={status:'confirmed',currency:'ARS',rate_original:'6000',payment_date:'2026-11-05',fx_date:'2026-11-05',fx_rate:'1000',fx_source:'Manual'};
 delete labor[missing];await assert.rejects(x.complete({labor}),e=>e.status===400);
 assert.equal(await x.current(),null);
});
test('wrong FX date and zero FX rejected; unpaid ARS is allowed pending',async()=>{
 assert.throws(()=>econ.laborLine({status:'confirmed',currency:'ARS',rate_original:'1',payment_date:'2026-11-05',fx_date:'2026-11-04',fx_rate:'1',fx_source:'x'},'93'));
 assert.throws(()=>econ.laborLine({status:'confirmed',currency:'ARS',rate_original:'1',payment_date:'2026-11-05',fx_date:'2026-11-05',fx_rate:'0',fx_source:'x'},'93'));
 const x=await fixture();await x.batch('200','1');await x.complete({labor:{status:'pending',currency:'ARS',rate_original:'6000'}});
 const r=await x.current();assert.equal(r.snapshot.economic_status,'partial');assert.equal(r.lines.find(l=>l.kind==='labor').amount_usd,null);
});
test('completing and correcting labor creates revisions without touching physical facts',async()=>{
 const x=await fixture();await x.batch('200','1');await x.complete();const first=await x.current();
 const before=await db.query('SELECT to_jsonb(m) v FROM stock_movements m WHERE company_id=$1 ORDER BY id',[x.company]);
 await x.revise({supersedes_id:first.snapshot.id,reason:'Labor pagada',labor:{status:'confirmed',currency:'USD',rate_original:'6'}});
 const second=await x.current();assert.equal(second.snapshot.economic_status,'complete');
 await x.revise({supersedes_id:second.snapshot.id,reason:'Corrección documentada tarifa',labor:{status:'confirmed',currency:'USD',rate_original:'7'}});
 assert.equal((await x.current()).total_cost_usd,'837.000000');
 assert.deepEqual((await db.query('SELECT to_jsonb(m) v FROM stock_movements m WHERE company_id=$1 ORDER BY id',[x.company])).rows,before.rows);
});
test('multilot weights sum exactly one and deterministic largest remainder preserves total',async()=>{
 const x=await fixture({area:'60'}),lot=await put('lots',{company_id:x.company,name:'Segundo',area:40});
 await put('planning_lots',{planning_id:x.planning,lot_id:lot.id,area_ha:40});await x.batch('200','1');await x.complete(noLabor);
 const r=await x.current();assert.deepEqual(new Set(r.targets.map(t=>t.allocation_weight)),new Set(['0.600000000000','0.400000000000']));
 assert(r.targets.every(t=>t.allocation_method==='area_proportional'&&/Prorrateado/.test(t.allocation_note)));
 const w=econ.weights(['1','1','1']);assert.equal(w.reduce((n,v)=>n+math.cost(v),0n),math.COST_SCALE);
 assert.deepEqual(w,['0.333333333334','0.333333333333','0.333333333333']);
});
for(const context of ['stubble','fallow','pre_sowing','other',null])test('explicit beneficiary required for '+context,async()=>{
 const x=await fixture({context});await x.batch('200','1');
 await assert.rejects(x.complete(noLabor),/beneficiario/);
 const soy=await put('crops',{company_id:x.company,name:'Soja'});
 await x.complete({...noLabor,targets:[{lot_id:x.lot,beneficiary_crop_id:soy.id}]});
 const r=await x.current();assert.equal(r.targets[0].beneficiary_crop_id,soy.id);assert.equal(r.snapshot.campaign_id,x.campaign);
});
test('foreign crop, unrelated target and wrong-campaign assignment are rejected',async()=>{
 const x=await fixture(),foreign=await fixture();await x.batch('200','1');
 await assert.rejects(x.complete({targets:[{lot_id:x.lot,beneficiary_crop_id:foreign.crop}]}),/empresa/);
 await assert.rejects(x.complete({targets:[{lot_id:foreign.lot,beneficiary_crop_id:x.crop}]}),/destinos/);
 const other=await put('campaigns',{company_id:x.company,name:'Otro',start_date:'2025-01-01',end_date:'2025-12-31'});
 const assignment=await put('crop_assignments',{company_id:x.company,campaign_id:other.id,crop_id:x.crop,lot_id:x.lot,start_date:'2025-01-01',area_ha:93});
 await assert.rejects(x.complete({targets:[{lot_id:x.lot,beneficiary_crop_id:x.crop,crop_assignment_id:assignment.id}]}),/ciclo beneficiario/);
});
test('tenant isolation and both read/edit permissions, including operator without price access',async()=>{
 const x=await fixture(),foreign=await fixture();await x.batch('200','1');await x.complete(noLabor);
 for(const fn of ['current','history'])await assert.rejects(econ[fn](pool,{user:foreign.user,planningId:x.planning}),{status:404});
 for(const custom_permissions of [[],['planning.view'],['inventory.view']])
  await assert.rejects(econ.current(pool,{user:{...x.user,custom_permissions},planningId:x.planning}),{status:403});
 const first=await x.current();
 await assert.rejects(econ.revise(pool,{user:{...x.user,custom_permissions:['planning.view','inventory.view','planning.edit']},planningId:x.planning,key:uuid(),body:{supersedes_id:first.snapshot.id,reason:'x'}}),{status:403});
 const y=await fixture();await y.batch('200','1');
 const operator={...y.user,custom_permissions:['planning.execute','planning.view']};
 await y.call('completeWork',{effective_date:'2026-11-05'},operator);
 assert.equal((await y.current()).snapshot.labor_status,'pending');
});
test('execution retry and revision retry do not duplicate facts or revisions',async()=>{
 const x=await fixture();await x.batch('200','1');await x.complete();const first=await x.current();
 assert.equal((await x.complete()).already_applied,true);assert.equal((await x.current()).snapshot.id,first.snapshot.id);
 const key=uuid(),body={supersedes_id:first.snapshot.id,reason:'Confirmar',labor:{status:'not_applicable'}};
 const a=await x.revise(body,key),b=await x.revise(body,key);assert.equal(a.current.snapshot.id,b.current.snapshot.id);assert.equal(b.replayed,true);
 await assert.rejects(x.revise({...body,reason:'Otro'},key),/clave/);
 await assert.rejects(x.revise(body),/revisión cambió/);
 assert.equal((await econ.history(pool,{user:x.user,planningId:x.planning})).data.length,2);
});
test('reversal of economically sealed Planning consumption is rejected atomically',async()=>{
 const x=await fixture(),batch=await x.batch('200','1');await x.complete(noLabor);
 const m=(await db.query("SELECT * FROM stock_movements WHERE company_id=$1 AND movement_type='consumption'",[x.company])).rows[0];
 await assert.rejects(stock.transaction(pool,c=>stock.reverseStock(c,{companyId:x.company,productId:x.product,actorId:x.actor,originalOperationId:m.operation_id,key:uuid()})),/reversión integral/);
 assert.equal((await db.query('SELECT available_quantity FROM stock_batches WHERE id=$1',[batch])).rows[0].available_quantity,'14.000000');
 assert.equal((await x.current()).total_cost_usd,'186.000000');
});
test('zero completion produces no fictitious product line or Usage; labor not-applicable gives explicit zero',async()=>{
 const x=await fixture({amount:'0'});await x.complete(noLabor);const r=await x.current();
 assert.equal(r.lines.length,0);assert.equal(r.total_cost_usd,'0.000000');
 assert.equal((await db.query('SELECT count(*)::int n FROM usage_records WHERE company_id=$1',[x.company])).rows[0].n,0);
});
test('one economic chain per Planning, not a second chain per generated Usage',async()=>{
 const x=await fixture();await x.batch('200','1');await x.complete(noLabor);
 assert.equal((await db.query('SELECT count(*)::int n FROM economic_snapshots WHERE company_id=$1',[x.company])).rows[0].n,1);
 assert.equal((await x.current()).lines.filter(l=>l.kind==='product').length,1);
});
test('sub-micro product cost preserved before summation; large money and FX division deterministic',async()=>{
 const x=await fixture({amount:'0.000002'});await x.batch('0.000001','0.5');await x.batch('0.000001','0.5');await x.complete(noLabor);
 const r=await x.current();assert.equal(r.total_cost_usd,'0.000001');assert(r.lines.every(l=>l.amount_usd==='0.000000500000'));
 assert.equal(econ.laborLine({status:'confirmed',currency:'ARS',rate_original:'1',fx_rate:'3',payment_date:'2026-11-05',fx_date:'2026-11-05',fx_source:'Manual'},'1').amount_usd,'0.333333333333');
});
test('non-product activity still captures labor and targets in the completion transaction',async()=>{
 const x=await fixture({activity:'mantenimiento',amount:'0'});await x.complete({labor:{status:'confirmed',currency:'USD',rate_original:'6'}});
 assert.equal((await x.current()).total_cost_usd,'558.000000');
});
test('historical no-stock records are explicitly excluded from automatic evidence',async()=>{
 const x=await fixture();
 const p=await db.query('SELECT * FROM planning WHERE id=$1',[x.planning]);
 const fake={query:async()=>({rows:[{...p.rows[0],inventory_impact_mode:'HISTORICAL_NO_STOCK'}]})};
 assert.equal(await econ.capture(fake,{planningId:x.planning,companyId:x.company,actorId:x.actor}),null);
});


async function cloneRevision(x,{editLine=l=>l,editTarget=t=>t,editHeader=s=>s}={}){
 const first=await x.current();
 return stock.transaction(pool,async()=>{
  const header=(await db.query('SELECT * FROM economic_snapshots WHERE id=$1',[first.snapshot.id])).rows[0];
  const candidate=editHeader({...header,id:uuid(),revision:header.revision+1,supersedes_id:header.id,reason:'SQL guard test',idempotency_key:uuid()});
  await put('economic_snapshots',candidate);
  for(const l of first.lines)await put('economic_snapshot_lines',editLine({...l,id:uuid(),snapshot_id:candidate.id}));
  for(const t of first.targets)await put('economic_snapshot_targets',editTarget({...t,id:uuid(),snapshot_id:candidate.id}));
 });
}
test('SQL guards reject foreign valuation evidence and tenant injection on targets',async()=>{
 const x=await fixture(),other=await fixture();const b=await x.batch('200','1'),foreign=await other.batch('200','2');await x.complete(noLabor);
 const v=(await valuations.current(pool,{user:other.user,productId:other.product,batchId:foreign})).current;
 await assert.rejects(cloneRevision(x,{editLine:l=>({...l,batch_valuation_id:v.id})}),/Valuation tenant mismatch/);
 await assert.rejects(cloneRevision(x,{editTarget:t=>({...t,beneficiary_crop_id:other.crop})}),/Crop tenant mismatch/);
 assert.equal((await x.current()).snapshot.revision,1);
});
test('SQL guards preserve pending product facts and reject different target area or weights',async()=>{
 const x=await fixture();await x.batch('200');await x.complete(noLabor);
 await assert.rejects(cloneRevision(x,{editLine:l=>({...l,product_name_snapshot:'Inventado'})}),/product facts/);
 await assert.rejects(cloneRevision(x,{editTarget:t=>({...t,applied_area_ha:'1'})}),/change targets/);
 await assert.rejects(cloneRevision(x,{editTarget:t=>({...t,allocation_weight:'0.5'})}),/sum to one/);
});
test('SQL rejects replacing an already confirmed price even with a later valid batch valuation',async()=>{
 const x=await fixture(),b=await x.batch('200','1');await x.complete(noLabor);
 const a=(await valuations.current(pool,{user:x.user,productId:x.product,batchId:b})).current,v=await x.value(b,'2',a.id);
 await assert.rejects(cloneRevision(x,{editLine:l=>({...l,batch_valuation_id:v.id,unit_cost_original:'2',unit_cost_usd:'2',amount_usd:'372'})}),/Confirmed product evidence/);
});
test('disabled Planning requires its existing additional read permission',async()=>{
 const x=await fixture();await x.batch('200','1');await x.complete(noLabor);
 await db.query('UPDATE planning SET enabled=false WHERE id=$1',[x.planning]);
 const user={...x.user,custom_permissions:['planning.view','inventory.view','planning.edit','inventory.edit']};
 for(const fn of ['current','history'])await assert.rejects(econ[fn](pool,{user,planningId:x.planning}),{status:403});
 const r=await econ.current(pool,{user:{...user,custom_permissions:[...user.custom_permissions,'planning.view_disabled']},planningId:x.planning});assert(r.current);
});
test('explicit confirmed zero is complete; it is distinct from unknown NULL',async()=>{
 const x=await fixture();await x.batch('200','0');await x.complete({labor:{status:'confirmed',currency:'USD',rate_original:'0'}});
 const r=await x.current();assert.equal(r.snapshot.economic_status,'complete');assert.equal(r.total_cost_usd,'0.000000');
 assert(r.lines.every(l=>l.amount_usd!==null));
});
test('unauthorized financial input is rejected before physical consumption',async()=>{
 const x=await fixture(),b=await x.batch('200','1');
 await assert.rejects(x.call('completeWork',{effective_date:'2026-11-05',economic:{labor:{status:'confirmed',currency:'USD',rate_original:'6'}}},
  {...x.user,custom_permissions:['planning.execute','planning.view']}),{status:403});
 assert.equal((await db.query('SELECT available_quantity FROM stock_batches WHERE id=$1',[b])).rows[0].available_quantity,'200.000000');
});
test('economic HTTP current, history, revision and errors enforce permissions and idempotency',async t=>{
 const x=await fixture();await x.batch('200','1');await x.complete();
 const express=require('express'),app=express();let user=x.user;
 app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});
 app.use('/planning/:id/economics',require('../routes/planningEconomics')(pool));
 app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port+'/planning/'+x.planning+'/economics';
 const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const current=(await response.json()).current;assert.equal(current.snapshot.request_hash,undefined);
 const body={supersedes_id:current.snapshot.id,reason:'Confirmar labor',labor:{status:'confirmed',currency:'USD',rate_original:'6'}},key=uuid();
 const post=payload=>fetch(url+'/revisions',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
 assert.equal((await post({...body,company_id:uuid()})).status,400);
 assert.equal((await post(body)).status,200);assert.equal((await (await post(body)).json()).replayed,true);
 assert.equal((await (await fetch(url+'/history')).json()).data.length,2);
 user={...x.user,custom_permissions:['planning.view']};
 assert.equal((await fetch(url)).status,403);assert.equal((await fetch(url+'/history')).status,403);assert.equal((await post(body)).status,403);
});

const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID:uuid}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const service=require('../services/planningCostEstimate'),stock=require('../services/stock');
const valuations=require('../services/stockBatchValuations');
let db,pool,queries=[];
before(async()=>{
  db=new PGlite();
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;');
  for(const file of ['./historySchema.fixture.sql','../migrations/20260914_inventory_base_units.sql',
    '../migrations/20260916_historical_no_stock.sql','../migrations/20261007_planning_effective_area.sql',
    '../migrations/20261104_stock_batch_valuations.sql'])
    await db.exec(fs.readFileSync(require.resolve(file),'utf8'));
  const client={query:(sql,args)=>{queries.push(sql);return db.query(sql,args);},release(){}};
  pool={...client,connect:async()=>client};
});
after(()=>db?.close());
async function put(table,row) {
  const keys=Object.keys(row);
  return (await db.query('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',Object.values(row))).rows[0];
}
async function fixture(amount='186',unit='L') {
  const company=uuid(),actor=uuid(),product=uuid(),planning=uuid(),lot=uuid();
  await put('companies',{id:company,name:'Synthetic'});
  await put('users',{id:actor,company_id:company,email:actor+'@example.test',role:3,enabled:true});
  await put('products',{id:product,company_id:company,name:'Glifosato',unit,enabled:true});
  await put('lots',{id:lot,company_id:company,name:'Lote',area:100});
  await put('planning',{id:planning,company_id:company,activity_type:'fumigacion',responsible_user:actor,
    start_at:'2027-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',status:'planificado'});
  await put('planning_lots',{planning_id:planning,lot_id:lot,area_ha:'100',effective_area_ha:'93'});
  const pp=await put('planning_products',{planning_id:planning,product_id:product,amount,unit});
  const user={id:actor,company_id:company,enabled:true,role:0,custom_permissions:['planning.view','inventory.view']};
  const estimate=()=>service.estimate(pool,{user,planningId:planning},()=> '2026-11-05');
  const value=async(batchId,price,supersedes_id=null,currency='USD')=>(await valuations.create(pool,{
    user,productId:product,batchId,key:uuid(),body:{status:price==null?'pending':'confirmed',currency,
      unit_cost_original:price,supersedes_id,reason:supersedes_id?'Correction':null}
  })).valuation;
  const batch=async(qty,price,extra={})=>{
    const row=await put('stock_batches',{id:uuid(),company_id:company,product_id:product,
      initial_quantity:qty,available_quantity:qty,unit,origin:'purchase',received_date:'2026-10-01',created_by:actor,...extra});
    if(price!==undefined) await value(row.id,price);
    return row.id;
  };
  return {company,actor,product,planning,lot,pp:pp.id,user,estimate,batch,value};
}
async function snapshot() {
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const all={};
  for(const {tablename} of tables) all[tablename]=(await db.query('SELECT to_jsonb(t)::text value FROM "'+tablename+'" t ORDER BY to_jsonb(t)::text')).rows;
  return all;
}
test('splits FEFO across two USD-valued batches, uses original planned amount and effective area',async()=>{
  const x=await fixture(),a=await x.batch('100','3.5',{expiration_date:'2026-12-01'}),
    b=await x.batch('100','3.9',{expiration_date:'2027-01-01'});
  const r=await x.estimate();
  assert.equal(r.status,'complete');assert.equal(r.area_ha,'93.000000');assert.equal(r.known_products_cost_usd,'685.400000');
  assert.equal(r.products[0].required_quantity,'186.000000');
  assert.deepEqual(r.products[0].simulated_batches.map(b=>[b.batch_id,b.quantity]),[[a,'100.000000'],[b,'86.000000']]);
  assert.equal(r.as_of_date,'2026-11-05');assert.equal(r.simulation,true);
});
test('read-only snapshot performs no writes or stock locks and changes no table',async()=>{
  const x=await fixture();await x.batch('200','3.8');
  const before=await snapshot();queries=[];
  await x.estimate();
  assert(queries[0].includes('REPEATABLE READ READ ONLY'));
  assert(queries.every(sql=>/^(SELECT|BEGIN|COMMIT)/i.test(sql)));
  assert(queries.every(sql=>!/FOR UPDATE|FOR SHARE|advisory|INSERT|UPDATE|DELETE/i.test(sql)));
  assert.deepEqual(await snapshot(),before);
});
test('unknown valuation and pending valuation do not fall back to legacy price',async()=>{
  const x=await fixture('300');
  await x.batch('100','2',{expiration_date:'2026-11-06'});
  await x.batch('100',null,{expiration_date:'2026-11-07'});
  await x.batch('100',undefined,{unit_price:'999',currency:'USD',exchange_rate:'1000'});
  const r=await x.estimate();
  assert.equal(r.status,'partial');assert.equal(r.known_products_cost_usd,'200.000000');
  assert.equal(r.pending_items,1);assert.equal(r.products[0].pending_cost_quantity,'200.000000');
  assert.equal(r.products[0].simulated_batches[1].known_cost_usd,null);
});
test('shortfall does not fail the request or extrapolate price',async()=>{
  const x=await fixture('200');await x.batch('150','4');
  const r=await x.estimate();
  assert.equal(r.status,'partial');assert.equal(r.products[0].uncovered_quantity,'50.000000');
  assert.equal(r.known_products_cost_usd,'600.000000');assert.equal(r.stock_shortfalls,1);
});
test('no stock or no known prices is unavailable; explicit zero price is complete',async()=>{
  const x=await fixture('10');assert.equal((await x.estimate()).status,'unavailable');
  const batch=await x.batch('10',null);assert.equal((await x.estimate()).status,'unavailable');
  const previous=(await valuations.current(pool,{user:x.user,productId:x.product,batchId:batch})).current;
  await x.value(batch,'0',previous.id);
  const r=await x.estimate();assert.equal(r.status,'complete');assert.equal(r.known_products_cost_usd,'0.000000');
});
test('only latest valuation revision counts, including a newer pending revision',async()=>{
  const x=await fixture('10'),batch=await x.batch('10','3.8');
  const a=(await valuations.current(pool,{user:x.user,productId:x.product,batchId:batch})).current;
  const b=await x.value(batch,'3.85',a.id);
  assert.equal((await x.estimate()).known_products_cost_usd,'38.500000');
  await x.value(batch,null,b.id);
  assert.equal((await x.estimate()).status,'unavailable');
  assert.equal((await valuations.history(pool,{user:x.user,productId:x.product,batchId:batch})).data.length,3);
});
test('eligibility uses TODAY, monthly/exact expiry inclusive, receipt dates and undated creation in Argentina',async()=>{
  const x=await fixture('6');
  const first=await x.batch('1','1',{expiration_date:'2026-11-05'});
  const monthly=await x.batch('1','2',{expiration_year:2026,expiration_month:11});
  await x.batch('9','50',{expiration_date:'2026-11-04'});
  await x.batch('9','50',{expiration_year:2026,expiration_month:10});
  await x.batch('9','50',{received_date:'2026-11-06'});
  await x.batch('9','50',{enabled:false});
  const legacy=await x.batch('1','3',{origin:'adjustment',received_date:null,created_at:'2026-11-06T02:59:00Z'});
  await x.batch('9','50',{origin:'adjustment',received_date:null,created_at:'2026-11-06T03:00:00Z'});
  const r=await x.estimate();
  assert.deepEqual(r.products[0].simulated_batches.map(b=>b.batch_id),[first,monthly,legacy]);
  assert.equal(r.products[0].uncovered_quantity,'3.000000');assert.equal(r.known_products_cost_usd,'6.000000');
});
test('FEFO ties use receipt and UUID and match physical consumption exactly',async()=>{
  const x=await fixture('3');
  const a=await x.batch('1','1',{received_date:'2026-10-01'});
  const b=await x.batch('1','2',{received_date:'2026-10-01'});
  const c=await x.batch('1','3',{received_date:'2026-10-02'});
  const r=await x.estimate(),order=[a,b].sort().concat(c);
  assert.deepEqual(r.products[0].simulated_batches.map(b=>b.batch_id),order);
  const use=await put('usage_records',{company_id:x.company,product_id:x.product,date:'2026-11-05',amount_used:3,unit:'L'});
  const movements=await stock.transaction(pool,client=>stock.consumeStock(client,{companyId:x.company,productId:x.product,
    actorId:x.actor,usageId:use.id,quantity:'3',unit:'L',key:uuid()}));
  assert.deepEqual(movements.map(m=>m.batch_id),order);
  assert.equal((await x.estimate()).status,'unavailable');
});
test('legacy compatible quantities use existing conversion, while new mismatched units remain SQL-protected',async()=>{
  const x=await fixture('186');
  await assert.rejects(db.query("UPDATE planning_products SET unit='mL' WHERE id=$1",[x.pp]),/unidad/);
  const r=service.estimateProduct({id:x.pp,product_id:x.product,name:'Legacy',amount:'186000',unit:'mL',base_unit:'L',product_enabled:true},
    [{id:uuid(),available_quantity:'186',unit:'L',valuation_status:'confirmed',currency:'USD',unit_cost_usd:'1'}]);
  assert.equal(r.required_quantity,'186.000000');assert.equal(r.known_cost_usd,'186.000000');
});
test('null quantity and incompatible legacy units are not silently treated as zero',async()=>{
  const x=await fixture(null);await x.batch('10','1');
  const r=await x.estimate();assert.equal(r.invalid_items,1);assert.equal(r.products[0].required_quantity,null);
  const invalid=service.estimateProduct({amount:'1',unit:'kg',base_unit:'L'},[]);
  assert.equal(invalid.status,'unavailable');assert.equal(invalid.required_quantity,null);
});
test('disabled product exposes no prices and cannot be assigned in simulation',async()=>{
  const x=await fixture('10');await x.batch('10','10');
  await db.query('UPDATE products SET enabled=false WHERE id=$1',[x.product]);
  const r=await x.estimate();assert.equal(r.status,'unavailable');assert.equal(r.products[0].simulated_batches.length,0);
});
test('area sums effective area plus fallback area, invalid area omits per-ha base',async()=>{
  const x=await fixture('1'),lot=await put('lots',{company_id:x.company,name:'Second',area:10});
  await put('planning_lots',{planning_id:x.planning,lot_id:lot.id,area_ha:'7.1234'});
  assert.equal((await x.estimate()).area_ha,'100.123400');
  await db.query('UPDATE planning_lots SET area_ha=NULL WHERE lot_id=$1',[lot.id]);
  assert.equal((await x.estimate()).area_ha,null);
});
test('retains all 12 product decimals before aggregation',async()=>{
  const x=await fixture('0.000002');
  await x.batch('0.000001','0.5',{expiration_date:'2026-11-06'});
  await x.batch('0.000001','0.5');
  const r=await x.estimate();
  assert.equal(r.products[0].simulated_batches[0].known_cost_usd,'0.0000005');
  assert.equal(r.known_products_cost_usd,'0.000001');
});
test('large decimal product is exact, never an IEEE-754 monetary value',async()=>{
  const x=await fixture('99999999999999.999999');
  await x.batch('99999999999999.999999','99999999999999.999999');
  assert.equal((await x.estimate()).known_products_cost_usd,'9999999999999999999800000000.000000000001');
});
test('zero planned amount and no products are valid, not missing-price errors',async()=>{
  const x=await fixture('0');assert.equal((await x.estimate()).status,'complete');
  await db.query('DELETE FROM planning_products WHERE planning_id=$1',[x.planning]);
  const r=await x.estimate();assert.equal(r.status,'complete');assert.equal(r.products.length,0);
});
test('tenant isolation, absent planning and both permissions',async()=>{
  const x=await fixture(),other=await fixture();
  await assert.rejects(service.estimate(pool,{user:other.user,planningId:x.planning}),{status:404});
  await assert.rejects(service.estimate(pool,{user:x.user,planningId:uuid()}),{status:404});
  for(const perms of [[],['planning.view'],['inventory.view']]) {
    queries=[];
    await assert.rejects(service.estimate(pool,{user:{...x.user,custom_permissions:perms},planningId:x.planning}),{status:403});
    assert.equal(queries.length,0);
  }
  await assert.rejects(service.estimate(pool,{user:{...x.user,enabled:false},planningId:x.planning}),{status:403});
});
test('completed, cancelled, disabled and historical planning are excluded; pendiente is supported',async()=>{
  const x=await fixture();
  for(const status of ['completado','cancelado']) {
    await db.query('UPDATE planning SET status=$1 WHERE id=$2',[status,x.planning]);
    await assert.rejects(x.estimate(),{status:409});
  }
  await db.query("UPDATE planning SET status='pendiente',enabled=false WHERE id=$1",[x.planning]);
  await assert.rejects(x.estimate(),{status:409});
  await db.query('UPDATE planning SET enabled=true WHERE id=$1',[x.planning]);
  assert.equal((await x.estimate()).planning_id,x.planning);
  // A legacy historical row is excluded even if it has an inconsistent pending status.
  const historicalPool={connect:async()=>({release(){},query:async sql=>({rows:sql.startsWith('SELECT')?
    [{id:x.planning,status:'pendiente',enabled:true,inventory_impact_mode:'HISTORICAL_NO_STOCK'}]:[]})})};
  await assert.rejects(service.estimate(historicalPool,{user:x.user,planningId:x.planning}),{status:409});
});
test('HTTP GET requires both permissions and returns no-store, without accepting client tenant/date',async t=>{
  const x=await fixture('1');await x.batch('1','2');
  const express=require('express'),app=express();let user=x.user;
  app.use((req,res,next)=>{req.user=user;next();});
  app.use('/planning/:id/cost-estimate',require('../routes/planningCostEstimate')(pool));
  app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/planning/'+x.planning+'/cost-estimate';
  const response=await fetch(url+'?company_id='+uuid()+'&date=1999-01-01');
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.notEqual((await response.json()).as_of_date,'1999-01-01');
  for(const custom_permissions of [['planning.view'],['inventory.view'],[]]) {
    user={...x.user,custom_permissions};assert.equal((await fetch(url)).status,403);
  }
  assert.equal((await fetch(url,{method:'POST'})).status,404);
});

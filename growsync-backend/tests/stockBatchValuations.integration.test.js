// Disposable PostgreSQL only. Never loads .env or connects to production.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const service=require('../services/stockBatchValuations');
const stock=require('../services/stock');
const initial=require('../services/stockInitialPlan');
let db,pool;
const migration=name=>fs.readFileSync(require.resolve('../migrations/'+name),'utf8');
before(async()=>{
  db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await db.exec(fs.readFileSync(require.resolve('./historySchema.fixture.sql'),'utf8'));
  await db.exec('BEGIN;'+migration('20260914_inventory_base_units.sql')+'COMMIT;');
  await db.exec(migration('20260916_historical_no_stock.sql'));
  await db.exec(migration('20260916_stock_initial.sql'));
  await db.exec(migration('20261104_stock_batch_valuations.sql'));
  // PGlite has one connection: serialize transactions, like a pool of size one.
  let tail=Promise.resolve();
  pool={query:(sql,args)=>db.query(sql,args),async connect(){
    const prior=tail;let release;tail=new Promise(resolve=>release=resolve);await prior;
    return {query:(sql,args)=>db.query(sql,args),release};
  }};
});
after(async()=>{await db?.close();});
async function fixture({opening=false}={}) {
  const companyId=randomUUID(),actorId=randomUUID(),productId=randomUUID();
  await db.query("INSERT INTO companies(id,name,inventory_control_start_date) VALUES($1,'Synthetic','2020-01-01')",[companyId]);
  await db.query("INSERT INTO users(id,company_id,email,role,enabled) VALUES($1,$2,$3,2,true)",[actorId,companyId,actorId+'@example.test']);
  await db.query("INSERT INTO products(id,company_id,name,unit) VALUES($1,$2,'Synthetic','kg')",[productId,companyId]);
  let batchId;
  if(opening) {
    await db.query("UPDATE users SET custom_permissions=$1 WHERE id=$2",[JSON.stringify(['history.import']),actorId]);
    const args={companyId,actorId,date:'2020-01-01',entries:[{product_id:productId,unit:'kg',quantity:'10.123456',expiration_date:null}],key:randomUUID(),confirmed:true};
    const prepared=await initial.prepare(pool,args);
    await initial.confirm(pool,{...args,previewHash:prepared.preview_hash});
    batchId=(await db.query('SELECT id FROM stock_batches WHERE company_id=$1',[companyId])).rows[0].id;
  } else {
    batchId=(await stock.transaction(pool,c=>stock.receiveStock(c,{companyId,actorId,productId,
      key:randomUUID(),quantity:'10.123456',unit:'kg',origin:'purchase',received_date:'2020-01-01'})))[0].batch_id;
  }
  const user={id:actorId,company_id:companyId,role:2,custom_permissions:['inventory.view','inventory.edit','history.import']};
  const args={user,productId,batchId};
  const create=(body={status:'confirmed',currency:'USD',unit_cost_original:'3.80',supersedes_id:null},key=randomUUID())=>service.create(pool,{...args,body,key});
  return {args,create,companyId,actorId,productId,batchId};
}
async function physical(x) {
  const result={};
  for(const table of ['products','stock_batches','stock_movements','stock_initial_openings'])
    result[table]=(await db.query('SELECT * FROM '+table+' WHERE company_id=$1 ORDER BY id',[x.companyId])).rows;
  return result;
}
test('no valuation means pending without manufacturing a row or importing legacy prices',async()=>{
  const x=await fixture();
  await db.query("UPDATE stock_batches SET unit_price=5,currency='USD',exchange_rate=1000 WHERE id=$1",[x.batchId]);
  const result=await service.current(pool,x.args);
  assert.equal(result.status,'pending');assert.equal(result.current,null);
  assert.equal((await service.history(pool,x.args)).data.length,0);
});
test('pending preserves unknown money as NULL, never zero',async()=>{
  const x=await fixture(),r=await x.create({status:'pending',supersedes_id:null});
  assert.equal(r.valuation.unit_cost_original,null);assert.equal(r.valuation.unit_cost_usd,null);
  assert.equal(r.valuation.currency,null);assert.equal(r.valuation.revision,1);
});
test('confirmed USD equals original exact price and requires no FX',async()=>{
  const x=await fixture(),r=await x.create();
  assert.equal(r.valuation.unit_cost_original,'3.800000');
  assert.equal(r.valuation.unit_cost_usd,'3.800000');assert.equal(r.valuation.fx_rate,null);
  assert.equal(r.valuation.created_by,x.actorId);assert(!('request_hash' in r.valuation));
});
test('explicit zero is distinct from pending and accepted as confirmed USD',async()=>{
  const x=await fixture(),r=await x.create({status:'confirmed',currency:'USD',unit_cost_original:'0',supersedes_id:null});
  assert.equal(r.valuation.unit_cost_usd,'0.000000');
});
test('current and paginated history reflect corrections while original stays intact',async()=>{
  const x=await fixture(),first=(await x.create()).valuation;
  const second=(await x.create({status:'confirmed',currency:'USD',unit_cost_original:'3.85',supersedes_id:first.id,reason:'Corrección de factura'})).valuation;
  assert.equal(second.revision,2);assert.equal(second.supersedes_id,first.id);
  assert.equal((await service.current(pool,x.args)).current.id,second.id);
  assert.deepEqual((await service.history(pool,x.args)).data,[second,first]);
  assert.equal((await service.history(pool,{...x.args,page:2,pageSize:1})).data[0].unit_cost_usd,'3.800000');
});
test('pending can become confirmed through a new immutable revision',async()=>{
  const x=await fixture(),first=(await x.create({status:'pending',supersedes_id:null})).valuation;
  await x.create({status:'confirmed',currency:'USD',unit_cost_original:'1.234567',supersedes_id:first.id,reason:'Llegó factura'});
  assert.equal((await service.history(pool,x.args)).data[1].unit_cost_usd,null);
});
test('ARS accepts pending original amount but cannot be confirmed or receive FX in this phase',async()=>{
  const x=await fixture(),body={status:'pending',currency:'ARS',unit_cost_original:'1000.12',supersedes_id:null};
  const r=await x.create(body);assert.equal(r.valuation.unit_cost_usd,null);
  assert.throws(()=>service.parseBody({...body,status:'confirmed'}),{status:400});
  assert.throws(()=>service.parseBody({...body,fx_rate:'1000'}),{status:400});
});
test('reject unknown fields, numeric floats, excess precision, invalid dates, negatives and missing confirmed price',()=>{
  const base={status:'confirmed',currency:'USD',unit_cost_original:'3.8',supersedes_id:null};
  for(const patch of [{unit_cost_original:3.8},{unit_cost_original:''},{unit_cost_original:'-1'},
    {unit_cost_original:'NaN'},{unit_cost_original:'1e3'},{unit_cost_original:'0.1234567'},
    {unit_cost_original:null},{unit_cost_original:'100000000000000'},
    {company_id:randomUUID()},{unit_cost_usd:'5'},{invoice_date:'2026-02-30'}])
    assert.throws(()=>service.parseBody({...base,...patch}),{status:400});
});
test('correction requires reason and expected latest revision',async()=>{
  const x=await fixture(),first=(await x.create()).valuation;
  await assert.rejects(x.create({status:'pending',supersedes_id:first.id,reason:' '}),{status:400});
  await assert.rejects(x.create(),{status:409});
  await assert.rejects(x.create({status:'pending',supersedes_id:randomUUID(),reason:'stale'}),{status:409});
});
test('six decimals and maximum exact magnitude survive SQL and JSON without Number conversion',async()=>{
  const x=await fixture(),r=await x.create({status:'confirmed',currency:'USD',unit_cost_original:'99999999999999.123456',supersedes_id:null});
  assert.equal(JSON.parse(JSON.stringify(r)).valuation.unit_cost_usd,'99999999999999.123456');
});
test('missing batch, wrong product and foreign company cannot read/write/history',async()=>{
  const x=await fixture(),other=await fixture();
  for(const args of [{...x.args,batchId:randomUUID()},{...x.args,productId:randomUUID()},{...x.args,user:other.args.user}]) {
    await assert.rejects(service.current(pool,args),{status:404});
    await assert.rejects(service.history(pool,args),{status:404});
    await assert.rejects(service.create(pool,{...args,body:{status:'pending',supersedes_id:null},key:randomUUID()}),{status:404});
  }
});
test('foreign actor and disabled actor cannot create a valuation',async()=>{
  const x=await fixture(),other=await fixture();
  const call=user=>service.create(pool,{...x.args,user,key:randomUUID(),body:{status:'pending',supersedes_id:null}});
  await assert.rejects(call({...x.args.user,id:other.actorId}),{status:403});
  await db.query('UPDATE users SET enabled=false WHERE id=$1',[x.actorId]);
  await assert.rejects(call(x.args.user),{status:403});
});
test('valuation does not change product, batch balance, movements or opening',async()=>{
  const x=await fixture(),before=await physical(x);await x.create();
  assert.deepEqual(await physical(x),before);
});
test('protected STOCK_INITIAL batch can be valued without changing any physical column',async()=>{
  const x=await fixture({opening:true}),before=await physical(x);
  await x.create();assert.deepEqual(await physical(x),before);
  await assert.rejects(db.query('UPDATE stock_batches SET unit_price=5 WHERE id=$1',[x.batchId]),/immutable/);
});
test('idempotent retry returns same revision, conflicts on payload and survives later corrections',async()=>{
  const x=await fixture(),key=randomUUID(),body={status:'confirmed',currency:'USD',unit_cost_original:'3.8',supersedes_id:null};
  const first=await x.create(body,key),retry=await x.create({...body,unit_cost_original:'3.800000'},key);
  assert.equal(retry.replayed,true);assert.deepEqual(first.valuation,retry.valuation);
  await assert.rejects(x.create({...body,unit_cost_original:'4'},key),{status:409});
  await x.create({...body,supersedes_id:first.valuation.id,reason:'Factura corregida'});
  assert.deepEqual((await x.create(body,key)).valuation,first.valuation);
  assert.equal((await service.history(pool,x.args)).data.length,2);
});
test('overlapping requests with same key create one revision; competing successors yield one 409',async()=>{
  const x=await fixture(),key=randomUUID(),body={status:'pending',supersedes_id:null};
  const pair=await Promise.all([x.create(body,key),x.create(body,key)]);
  assert.equal(pair[0].valuation.id,pair[1].valuation.id);
  const corrections=await Promise.allSettled(['A','B'].map(reason=>x.create({...body,supersedes_id:pair[0].valuation.id,reason})));
  assert.equal(corrections.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(corrections.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await service.history(pool,x.args)).data.length,2);
});
test('database refuses UPDATE, DELETE and TRUNCATE including pending revisions',async()=>{
  const x=await fixture();await x.create({status:'pending',supersedes_id:null});
  for(const sql of ["UPDATE stock_batch_valuations SET reason='changed' WHERE batch_id=$1",
    'DELETE FROM stock_batch_valuations WHERE batch_id=$1'])
    await assert.rejects(db.query(sql,[x.batchId]),/immutable/);
  await assert.rejects(db.exec('TRUNCATE stock_batch_valuations'),/immutable/);
});
test('database protects tenant FK, same-batch chain, sequential revisions and USD equality',async()=>{
  const x=await fixture(),other=await fixture(),first=(await x.create()).valuation;
  const insert=async patch=>{
    const row={company_id:x.companyId,batch_id:x.batchId,revision:2,supersedes_id:first.id,
      status:'confirmed',currency:'USD',unit_cost_original:'4',unit_cost_usd:'4',provenance:'manual',
      reason:'Correction',created_by:x.actorId,idempotency_key:randomUUID(),request_hash:'a'.repeat(64),...patch};
    const keys=Object.keys(row);
    return db.query('INSERT INTO stock_batch_valuations('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row));
  };
  for(const patch of [{company_id:other.companyId},{created_by:other.actorId},{revision:3},
    {supersedes_id:randomUUID()},{unit_cost_usd:'5'},{unit_cost_usd:null},{currency:null},
    {status:'confirmed',currency:'ARS'},{reason:null}]) await assert.rejects(insert(patch));
  await insert({});
  await assert.rejects(insert({}),/stale|unique/);
});
test('pending price never blocks physical consumption',async()=>{
  const x=await fixture();await x.create({status:'pending',supersedes_id:null});
  const usageId=randomUUID();
  await db.query("INSERT INTO usage_records(id,company_id,product_id,date,amount_used,unit) VALUES($1,$2,$3,'2020-01-02',1,'kg')",[usageId,x.companyId,x.productId]);
  await stock.transaction(pool,c=>stock.consumeStock(c,{companyId:x.companyId,productId:x.productId,actorId:x.actorId,
    usageId,quantity:'1',unit:'kg',key:randomUUID()}));
  assert.equal((await db.query('SELECT available_quantity FROM stock_batches WHERE id=$1',[x.batchId])).rows[0].available_quantity,'9.123456');
});
test('HTTP permissions, authenticated company, conflicts and no destructive endpoints',async t=>{
  const x=await fixture(),express=require('express'),app=express();
  let user=x.args.user;
  app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});
  app.use('/api/products/:id/batches/:batchId/valuation',require('../routes/stockBatchValuations')(pool));
  app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/api/products/'+x.productId+'/batches/'+x.batchId+'/valuation';
  const request=(method,path='',body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('GET')).status,200);
  assert.equal((await request('POST','',{status:'pending',supersedes_id:null,company_id:x.companyId})).status,400);
  assert.equal((await request('POST','',{status:'confirmed',currency:'USD',unit_cost_original:'3.8',supersedes_id:null})).status,201);
  assert.equal((await request('GET','/history')).status,200);
  user={...user,custom_permissions:['inventory.view']};
  assert.equal((await request('POST','',{status:'pending',supersedes_id:null})).status,403);
  user={...user,custom_permissions:['inventory.edit']};
  assert.equal((await request('GET')).status,403);assert.equal((await request('GET','/history')).status,403);
  user={...user,role:0};assert.equal((await request('POST','',{status:'pending',supersedes_id:null})).status,403);
  for(const method of ['PUT','PATCH','DELETE']) assert.equal((await request(method)).status,404);
});
test('disabled product history requires the existing inventory.view_disabled permission',async()=>{
  const x=await fixture();await x.create();
  await db.query('UPDATE products SET enabled=false WHERE id=$1',[x.productId]);
  await assert.rejects(service.current(pool,x.args),{status:403});
  const args={...x.args,user:{...x.args.user,custom_permissions:['inventory.view_disabled']}};
  assert.equal((await service.current(pool,args)).status,'confirmed');
});

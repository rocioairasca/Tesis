// Disposable PostgreSQL only; no .env or production connections.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const service=require('../services/inventoryReceipts');
const stock=require('../services/stock');
const valuations=require('../services/stockBatchValuations');
let db,pool,server,origin;const users=new Map();let inserts=0;
before(async()=>{
  db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await db.exec(fs.readFileSync(require.resolve('./historySchema.fixture.sql'),'utf8'));
  const migration=name=>fs.readFileSync(require.resolve('../migrations/'+name),'utf8');
  await db.exec('BEGIN;'+migration('20260914_inventory_base_units.sql')+'COMMIT;');
  for(const file of ['20260916_historical_no_stock.sql','20260916_stock_initial.sql','20261104_stock_batch_valuations.sql','20261107_inventory_receipts.sql'])await db.exec(migration(file));
  let tail=Promise.resolve();
  pool={query:(sql,args)=>db.query(sql,args),async connect(){
    const prior=tail;let release;tail=new Promise(resolve=>release=resolve);await prior;
    return {query:async(sql,args)=>{const result=await db.query(sql,args);if(sql.includes('INSERT INTO stock_batches'))inserts++;return result;},release};
  }};
  const app=require('express')();app.use(require('express').json());
  app.use((req,res,next)=>{req.user=users.get(req.get('X-Test-User'));next();});
  app.use('/api/products/receipts',require('../routes/inventoryReceipts')(pool));
  app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(resolve=>server?.close(resolve));await db?.close();});
async function fixture(){
  const companyId=randomUUID(),actorId=randomUUID(),productIds=[randomUUID(),randomUUID()].sort();
  await db.query("INSERT INTO companies(id,name,inventory_control_start_date) VALUES($1,'Synthetic','2020-01-01')",[companyId]);
  await db.query("INSERT INTO users(id,company_id,email,role,enabled) VALUES($1,$2,$3,2,true)",[actorId,companyId,actorId+'@example.test']);
  for(const [i,id] of productIds.entries())await db.query("INSERT INTO products(id,company_id,name,unit) VALUES($1,$2,$3,$4)",[id,companyId,'Product '+i,i?'litros':'kg']);
  const user={id:actorId,company_id:companyId,role:2,custom_permissions:['inventory.edit','inventory.view']};users.set(actorId,user);
  const body={received_date:'2020-01-02',supplier:'Proveedor',document_type:'Remito',reference:'R-001',notes:'Entrega',
    items:productIds.map((id,i)=>({product_id:id,quantity:i?'2.000001':'10.123456',unit:i?'litros':'kg'}))};
  return {companyId,actorId,productIds,user,body,create:(patch={},key=randomUUID())=>service.create(pool,{user,body:{...body,...patch},key})};
}
async function rows(table,x){return (await db.query('SELECT * FROM '+table+' WHERE company_id=$1 ORDER BY id',[x.companyId])).rows;}
async function empty(x){for(const table of ['inventory_receipts','stock_batches','stock_movements','stock_batch_valuations'])assert.equal((await rows(table,x)).length,0,table);}
async function post(x,body=x.body,key=randomUUID(),user=x.user){users.set(user.id,user);return fetch(origin+'/api/products/receipts',{method:'POST',headers:{'Content-Type':'application/json','X-Test-User':user.id,'Idempotency-Key':key},body:JSON.stringify(body)});}
test('one product creates header, batch and receipt movement with exact quantity and pending cost',async()=>{
  const x=await fixture(),r=await x.create({items:[x.body.items[0]]});
  assert.equal(r.movements.length,1);assert.equal(r.movements[0].quantity,'10.123456');
  const [batch]=await rows('stock_batches',x);
  assert.equal(batch.inventory_receipt_id,r.receipt.id);assert.equal(batch.unit,'kg');
  assert.equal(batch.initial_quantity,batch.available_quantity);assert.equal(batch.unit_price,null);
  assert.equal(batch.expiration_date,null);assert.equal(batch.reference,'R-001');assert.equal(batch.notes,'Entrega');
  const current=await valuations.current(pool,{user:x.user,productId:batch.product_id,batchId:batch.id});
  assert.equal(current.status,'pending');assert.equal(current.current,null);
});
test('several products share header, dates and supplier; movements and balances match each item',async()=>{
  const x=await fixture();x.body.items[1].expiration_year=2030;x.body.items[1].expiration_month=7;
  const r=await x.create();assert.equal(r.movements.length,2);
  assert.equal((await rows('inventory_receipts',x)).length,1);
  for(const batch of await rows('stock_batches',x)){
    const item=x.body.items.find(i=>i.product_id===batch.product_id);
    assert.equal(batch.inventory_receipt_id,r.receipt.id);assert.equal(batch.available_quantity,item.quantity);
    assert.equal(batch.supplier,'Proveedor');assert.equal(new Date(batch.received_date).toISOString().slice(0,10),'2020-01-02');
    const m=r.movements.find(m=>m.batch_id===batch.id);assert.equal(m.quantity,item.quantity);assert.equal(m.unit,require('../services/inventoryUnits').normalizeUnit(item.unit));assert.equal(m.movement_type,'receipt');
    if(item.expiration_year){assert.equal(batch.expiration_year,2030);assert.equal(batch.expiration_month,7);}
  }
});
test('failure in second line rolls back a genuinely inserted first batch, header and movement',async()=>{
  const x=await fixture(),before=inserts;
  x.body.items[1].unit='kg';
  await assert.rejects(x.create(),{status:400});assert.equal(inserts,before+1);await empty(x);
});
test('invalid expiration in second line rolls back all writes',async()=>{
  const x=await fixture();x.body.items[1].expiration_month=1;
  await assert.rejects(x.create(),{status:400});await empty(x);
});
test('duplicates rejected, including uppercase UUID aliases',async()=>{
  const x=await fixture();
  await assert.rejects(x.create({items:[x.body.items[0],{...x.body.items[0],product_id:x.productIds[0].toUpperCase()}]}),{status:400});await empty(x);
});
test('foreign product, disabled product and foreign actor rejected without writes',async()=>{
  const x=await fixture(),other=await fixture();
  await assert.rejects(x.create({items:[x.body.items[0],other.body.items[1]]}),{status:404});await empty(x);
  await db.query('UPDATE products SET enabled=false WHERE id=$1',[x.productIds[1]]);
  await assert.rejects(x.create(),{status:404});await empty(x);
  await assert.rejects(service.create(pool,{user:{...x.user,id:other.actorId},body:x.body,key:randomUUID()}),{status:403});await empty(x);
});
test('disabled actor cannot create or replay a receipt',async()=>{
  const x=await fixture(),key=randomUUID();await x.create({},key);
  await db.query('UPDATE users SET enabled=false WHERE id=$1',[x.actorId]);
  await assert.rejects(x.create({},key),{status:403});assert.equal((await rows('stock_batches',x)).length,2);
});
test('HTTP retains minimum role and inventory.edit permissions',async()=>{
  const x=await fixture();
  for(const user of [{...x.user,custom_permissions:['inventory.view']},{...x.user,role:1}])assert.equal((await post(x,x.body,randomUUID(),user)).status,403);
  await empty(x);const res=await post(x);assert.equal(res.status,200);assert.equal((await res.json()).movements.length,2);
});
test('HTTP rejects empty items, injected tenant/price, invalid precision, zero, future date and missing key',async()=>{
  const x=await fixture();
  for(const body of [{...x.body,items:[]},{...x.body,company_id:randomUUID()},
    {...x.body,items:[{...x.body.items[0],unit_price:10}]},
    ...['0','-1','1.0000001'].map(quantity=>({...x.body,items:[{...x.body.items[0],quantity}]})),
    {...x.body,received_date:'2099-01-01'}])assert.equal((await post(x,body)).status,400);
  assert.equal((await post(x,x.body,'')).status,400);await empty(x);
});
test('identical retries return same receipt and movements; changed body conflicts',async()=>{
  const x=await fixture(),key=randomUUID(),first=await x.create({},key);
  assert.deepEqual(await x.create({},key),first);
  await assert.rejects(x.create({notes:'Changed'},key),{status:409});
  assert.equal((await rows('stock_batches',x)).length,2);assert.equal((await rows('stock_movements',x)).length,2);
});
test('concurrent retries do not duplicate and same external key is scoped by company',async()=>{
  const x=await fixture(),y=await fixture(),key=randomUUID();
  const [a,b]=await Promise.all([x.create({},key),x.create({},key)]);assert.equal(a.receipt.id,b.receipt.id);
  const other=await y.create({},key);assert.notEqual(a.receipt.id,other.receipt.id);
  assert.equal((await rows('stock_batches',x)).length,2);
});
test('tenant FK prevents linking batches to another company receipt',async()=>{
  const x=await fixture(),y=await fixture();await x.create();const other=await y.create();
  await assert.rejects(db.query('UPDATE stock_batches SET inventory_receipt_id=$1 WHERE company_id=$2',[other.receipt.id,x.companyId]),/foreign key/);
});
test('created batches use unchanged subsequent valuation workflow',async()=>{
  const x=await fixture(),r=await x.create(),m=r.movements[0];
  await valuations.create(pool,{user:x.user,productId:m.product_id,batchId:m.batch_id,key:randomUUID(),
    body:{status:'confirmed',currency:'USD',unit_cost_original:'3.8',supersedes_id:null}});
  const v=await valuations.current(pool,{user:x.user,productId:m.product_id,batchId:m.batch_id});
  assert.equal(v.current.unit_cost_usd,'3.800000');assert.equal((await rows('stock_movements',x)).length,2);
});
test('individual stock receipt still works without header and preserves existing monetary inputs',async()=>{
  const x=await fixture();
  const r=await stock.transaction(pool,c=>stock.receiveStock(c,{companyId:x.companyId,actorId:x.actorId,productId:x.productIds[0],
    key:randomUUID(),origin:'purchase',received_date:'2020-01-02',quantity:'1',unit:'kg',currency:'ARS',unit_price:'4'}));
  assert.equal(r.length,1);const [b]=await rows('stock_batches',x);assert.equal(b.inventory_receipt_id,null);assert.equal(b.unit_price,'4.000000');
  assert.equal((await rows('inventory_receipts',x)).length,0);
});

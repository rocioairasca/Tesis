// Synthetic embedded PostgreSQL only. No .env, Supabase or new migration execution.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {expirationFields,effectiveExpirationSql}=require('../services/inventoryExpiration');
let today='2026-09-01',db,pool;
function load(file,overrides={}) {
  const filename=require.resolve(file),realRequire=createRequire(filename),mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:mod,exports:mod.exports,console,process,
    require:id=>Object.hasOwn(overrides,id)?overrides[id]:realRequire(id)});
  return mod.exports;
}
const stock=load('../services/stock',{'./harvestRegistration':{localToday:()=>today}});
const initial=load('../services/stockInitialPlan',{'./stock':stock});
before(async()=>{
  db=new PGlite();
  const client={query:(sql,args=[])=>db.query(sql,args),release(){}};
  pool={query:client.query,connect:async()=>client};
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE companies(id uuid PRIMARY KEY,inventory_control_start_date date DEFAULT '2026-01-01');
    CREATE TABLE users(id uuid PRIMARY KEY,company_id uuid,role integer DEFAULT 3,enabled boolean DEFAULT true);
    CREATE TABLE products(id uuid PRIMARY KEY,company_id uuid,name text,unit text,enabled boolean DEFAULT true,
      available_quantity numeric DEFAULT 0,total_quantity numeric DEFAULT 0,expiration_date date,acquisition_date date);
    CREATE TABLE usage_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,product_id uuid,amount_used numeric,unit text,enabled boolean DEFAULT true);`);
  await db.exec(require('./stockSchema.fixture'));
  // Existing opening schema; then install the target checker as a test fixture.
  await db.exec(fs.readFileSync(require.resolve('../migrations/20260916_stock_initial.sql'),'utf8'));
  await db.exec(require('./stockInitialExpiration.fixture'));
});
after(async()=>{delete process.env.INVENTORY_V1_COMPANY_IDS;await db?.close();});
async function fixture(){
  today='2026-09-01';
  const companyId=randomUUID(),actorId=randomUUID(),productId=randomUUID();
  await db.query('INSERT INTO companies(id) VALUES($1)',[companyId]);
  await db.query('INSERT INTO users(id,company_id) VALUES($1,$2)',[actorId,companyId]);
  await db.query("INSERT INTO products(id,company_id,name,unit) VALUES($1,$2,'Expiry test','kg')",[productId,companyId]);
  process.env.INVENTORY_V1_COMPANY_IDS=companyId;
  const ctx={companyId,actorId,productId,unit:'kg'};
  const receive=(expiry={},extra={})=>stock.transaction(pool,c=>stock.receiveStock(c,{...ctx,origin:'purchase',received_date:'2020-01-01',quantity:'1',key:randomUUID(),...expiry,...extra}));
  const balance=async()=> (await stock.balances(db,companyId,[productId])).get(productId);
  const consume=async quantity=>{
    const usageId=randomUUID();
    await db.query('INSERT INTO usage_records(id,company_id,product_id,amount_used,unit) VALUES($1,$2,$3,$4,$5)',[usageId,companyId,productId,quantity,'kg']);
    return stock.transaction(pool,c=>stock.consumeStock(c,{...ctx,usageId,quantity,key:randomUUID()}));
  };
  return {...ctx,receive,balance,consume};
}
const month=(expiration_year,expiration_month)=>({expiration_year,expiration_month});

test('09/2026 válido todo septiembre inclusive; vencido el 01/10, sin fecha almacenada ficticia',async()=>{
  const x=await fixture();await x.receive(month(2026,9),{quantity:'4'});
  for(const day of ['2026-09-01','2026-09-15','2026-09-30']){
    today=day;assert.equal((await x.balance()).available_quantity,day==='2026-09-01'?'4.000000':day==='2026-09-15'?'3.000000':'2.000000');
    await x.consume('1');
  }
  today='2026-10-01';assert.equal((await x.balance()).available_quantity,'0');
  assert.equal((await x.balance()).on_hand,'1.000000');
  await assert.rejects(x.consume('1'),/insuficiente/);
  const row=(await db.query('SELECT expiration_date,expiration_year,expiration_month FROM stock_batches WHERE product_id=$1',[x.productId])).rows[0];
  assert.deepEqual(row,{expiration_date:null,expiration_year:2026,expiration_month:9});
});

for(const [year,lastDay] of [[2027,'28'],[2028,'29'],[2100,'28'],[2000,'29']])test(`febrero ${year}: último día ${lastDay} y corte en marzo`,async()=>{
  const x=await fixture();today=`${year}-02-${lastDay}`;
  await x.receive(month(year,2),{received_date:`${year}-01-01`});assert.equal((await x.balance()).available_quantity,'1.000000');
  const row=(await db.query(`SELECT (${effectiveExpirationSql})::text AS effective FROM stock_batches WHERE product_id=$1`,[x.productId])).rows[0];
  assert.equal(row.effective,`${year}-02-${lastDay}`);
  today=`${year}-03-01`;assert.equal((await x.balance()).available_quantity,'0');
  await assert.rejects(x.consume('1'),/insuficiente/);
});

test('FEFO: mensuales, exactos, sin vencimiento al final; desempate por ingreso e ID',async()=>{
  const x=await fixture();
  const none=(await x.receive())[0].batch_id;
  const october=(await x.receive(month(2026,10)))[0].batch_id;
  const septemberLater=(await x.receive(month(2026,9),{received_date:'2026-02-01'}))[0].batch_id;
  const septemberA=(await x.receive(month(2026,9)))[0].batch_id;
  const septemberB=(await x.receive(month(2026,9)))[0].batch_id;
  const exact=(await x.receive({expiration_date:'2026-09-15'}))[0].batch_id;
  const movements=await x.consume('6');
  assert.deepEqual(Array.from(movements,m=>m.batch_id),[exact,...[septemberA,septemberB].sort(),septemberLater,october,none]);
});

test('FEFO: fecha exacta al fin de mes y mensual empatan; ajustes negativos incluyen vencidos',async()=>{
  const x=await fixture();
  const monthly=(await x.receive(month(2026,9),{received_date:'2026-02-01'}))[0].batch_id;
  const exact=(await x.receive({expiration_date:'2026-09-30'}))[0].batch_id;
  const none=(await x.receive())[0].batch_id;
  today='2026-10-01';
  const result=await stock.transaction(pool,c=>stock.adjustStock(c,{...x,quantity:'3',direction:'out',reason:'Recuento',key:randomUUID()}));
  assert.deepEqual(Array.from(result,m=>m.batch_id),[exact,monthly,none]);
});

const invalidExpiries=[
  ['mes 0',month(2026,0)],['mes 13',month(2026,13)],['año sin mes',{expiration_year:2026}],
  ['mes sin año',{expiration_month:9}],['exacta más mensual',{expiration_date:'2026-09-20',...month(2026,9)}],
  ['año 1999',month(1999,9)],['año 2101',month(2101,9)],
];
for(const [label,expiry] of invalidExpiries)test(`rechazo ${label}: servicio y constraint SQL`,async()=>{
  const x=await fixture();
  assert.throws(()=>expirationFields(expiry),{status:400});
  await assert.rejects(x.receive(expiry),{status:400});
  await assert.rejects(db.query(`INSERT INTO stock_batches(company_id,product_id,initial_quantity,available_quantity,unit,origin,
    received_date,created_by,expiration_date,expiration_year,expiration_month) VALUES($1,$2,1,1,'kg','purchase','2020-01-01',$3,$4,$5,$6)`,
    [x.companyId,x.productId,x.actorId,expiry.expiration_date??null,expiry.expiration_year??null,expiry.expiration_month??null]),/check constraint/);
  assert.equal((await db.query('SELECT count(*)::int n FROM stock_batches WHERE product_id=$1',[x.productId])).rows[0].n,0);
});

test('fechas exactas existentes conservan fecha, límite inclusivo y campos mensuales NULL',async()=>{
  const x=await fixture();today='2026-09-15';await x.receive({expiration_date:'2026-09-15'});
  assert.equal((await x.balance()).available_quantity,'1.000000');
  const row=(await db.query('SELECT expiration_date::text,expiration_year,expiration_month FROM stock_batches WHERE product_id=$1',[x.productId])).rows[0];
  assert.deepEqual(row,{expiration_date:'2026-09-15',expiration_year:null,expiration_month:null});
  today='2026-09-16';assert.equal((await x.balance()).available_quantity,'0');
});

test('API ingresos/listado y resumen exponen la precisión real sin sustituir expiration_date',async()=>{
  const x=await fixture();
  const controller=load('../controllers/products/stock',{'../../db/supabaseClient':{pool},'../../services/stock':stock});
  const req={user:{id:x.actorId,company_id:x.companyId,role:3},params:{id:x.productId},query:{},get:()=>randomUUID(),
    body:{quantity:'1',unit:'kg',origin:'purchase',received_date:'2020-01-01',...month(2026,9)}};
  const res={status(){return this;},json(value){this.body=value;}};
  await controller.registerReceipt(req,res,e=>{throw e;});
  await controller.listBatches(req,res,e=>{throw e;});
  assert.equal(res.body.data[0].expiration_date,null);assert.equal(res.body.data[0].expiration_year,2026);assert.equal(res.body.data[0].expiration_month,9);
  const product=(await db.query('SELECT * FROM products WHERE id=$1',[x.productId])).rows[0];
  const [decorated]=await stock.decorate(db,x.companyId,[product]);
  assert.equal(decorated.expiration_date,null);assert.equal(decorated.next_expiration_date,null);
  assert.equal(decorated.expiration_year,2026);assert.equal(decorated.expiration_month,9);
  assert(decorated.effective_expiration_date);assert.equal(decorated.next_expiration_month,9);
});

test('ingreso mensual idempotente: mismo mes reproduce; otro mes con misma clave se rechaza',async()=>{
  const x=await fixture(),key=randomUUID();
  const first=await x.receive(month(2026,9),{key});
  const replay=await x.receive(month(2026,9),{key});
  assert.equal(first[0].id,replay[0].id);
  await assert.rejects(x.receive(month(2026,10),{key}),/idempotencia/);
});

test('apertura prepare/confirm mensual, exacta y sin vencimiento; duplicados, replay y campos persistidos',async()=>{
  const x=await fixture();
  const args={companyId:x.companyId,actorId:x.actorId,date:'2026-01-01',key:randomUUID(),confirmed:true,
    entries:[{product_id:x.productId,unit:'kg',quantity:'1',...month(2026,9)},
      {product_id:x.productId,unit:'kg',quantity:'1',expiration_date:'2026-09-15'},
      {product_id:x.productId,unit:'kg',quantity:'1',expiration_date:null}]};
  await assert.rejects(initial.prepare(pool,{...args,entries:[args.entries[0],args.entries[0]]}),/repetidos/);
  for(const [,expiry] of invalidExpiries) await assert.rejects(initial.prepare(pool,{...args,entries:[{product_id:x.productId,unit:'kg',quantity:'1',...expiry}]}),{status:400});
  const preview=await initial.prepare(pool,args);
  assert.equal(preview.entries[0].expiration_date,null);assert.equal(preview.entries[0].expiration_month,9);
  const result=await initial.confirm(pool,{...args,previewHash:preview.preview_hash});
  assert.equal(result.entries.length,3);
  assert.equal((await initial.confirm(pool,{...args,previewHash:preview.preview_hash})).replayed,true);
  const row=(await db.query('SELECT expiration_date,expiration_year,expiration_month FROM stock_batches WHERE id=$1',[result.entries[0].batch_id])).rows[0];
  assert.deepEqual(row,{expiration_date:null,expiration_year:2026,expiration_month:9});
  await assert.rejects(db.query('UPDATE stock_batches SET expiration_month=10 WHERE id=$1',[result.entries[0].batch_id]),/immutable/);
});

test('apertura: el checker SQL de destino detecta mes distinto del manifiesto y revierte',async()=>{
  const x=await fixture();
  const args={companyId:x.companyId,actorId:x.actorId,date:'2026-01-01',key:randomUUID(),confirmed:true,
    entries:[{product_id:x.productId,unit:'kg',quantity:'1',...month(2026,9)}]};
  const preview=await initial.prepare(pool,args);
  const tampered={async connect(){const c=await pool.connect();return {...c,query(sql,args){
    if(sql.startsWith('INSERT INTO stock_batches'))args=[...args.slice(0,9),10];
    return c.query(sql,args);
  }};}};
  await assert.rejects(initial.confirm(tampered,{...args,previewHash:preview.preview_hash}),/manifest does not match/);
  assert.equal((await db.query('SELECT count(*)::int n FROM stock_batches WHERE product_id=$1',[x.productId])).rows[0].n,0);
});

test('migración nueva solo inspeccionada: checker coincide con fixture; sin reescrituras de fechas',()=>{
  const sql=fs.readFileSync(require.resolve('../migrations/20260924_inventory_monthly_expiration.sql'),'utf8');
  assert(sql.includes(require('./stockInitialExpiration.fixture')));
  assert(!/UPDATE\s+stock_batches/i.test(sql));
  assert(sql.includes('CHECK (expiration_year BETWEEN 2000 AND 2100)'));
  for(const name of ['expiration_pair','expiration_precision','expiration_year_range','expiration_month_range'])assert(sql.includes('stock_batches_'+name));
});

test('límites 1999/2000/2100/2101 consistentes en endpoint y apertura inicial',async()=>{
  const controller=load('../controllers/products/stock',{'../../db/supabaseClient':{pool},'../../services/stock':stock});
  for(const year of [1999,2000,2100,2101]){
    const accepted=year>=2000&&year<=2100;
    const x=await fixture();
    const req={user:{id:x.actorId,company_id:x.companyId,role:3},params:{id:x.productId},get:()=>randomUUID(),
      body:{quantity:'1',unit:'kg',origin:'purchase',received_date:'2020-01-01',...month(year,9)}};
    let error;
    const res={status(){return this;},json(value){this.body=value;}};
    await controller.registerReceipt(req,res,e=>{error=e;});
    if(accepted){assert.equal(error,undefined);assert.equal(res.body.movements.length,1);}
    else assert.equal(error.status,400);
    const opening=await fixture();
    const args={companyId:opening.companyId,actorId:opening.actorId,date:'2026-01-01',key:randomUUID(),confirmed:true,
      entries:[{product_id:opening.productId,unit:'kg',quantity:'1',...month(year,9)}]};
    if(accepted){
      const preview=await initial.prepare(pool,args);
      const result=await initial.confirm(pool,{...args,previewHash:preview.preview_hash});
      assert.equal(result.entries[0].expiration_year,year);
    }else{
      await assert.rejects(initial.prepare(pool,args),{status:400});
      await assert.rejects(initial.confirm(pool,{...args,previewHash:'a'.repeat(64)}),{status:400});
    }
  }
});

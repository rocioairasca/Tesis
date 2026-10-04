// Disposable embedded PostgreSQL. Never imports dotenv or a production client.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const initial=require('../services/stockInitialPlan');
const stock=require('../services/stock');
const history=require('../services/historicalImport');
const completion=require('../services/planningCompletion');
async function fixture(t){
  const db=await require('./stockInitialDatabase.fixture')(t);
  await db.exec(fs.readFileSync(path.join(__dirname,'historySchema.fixture.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../migrations/20261007_planning_effective_area.sql'),'utf8'));
  await db.exec('BEGIN;'+fs.readFileSync(path.join(__dirname,'../migrations/20260914_inventory_base_units.sql'),'utf8')+'COMMIT;');
  for(const file of ['20260916_historical_no_stock.sql','20260916_stock_initial.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
  let tail=Promise.resolve();const queries=[];
  const pool={async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;
    return {release,query(sql,args){queries.push(sql);return db.query(sql,args)}};}};
  const companyId=randomUUID(),actorId=randomUUID(),productId=randomUUID(),secondId=randomUUID(),lotId=randomUUID();
  await db.query("INSERT INTO companies(id,name,inventory_control_start_date) VALUES($1,'Synthetic','2020-01-01')",[companyId]);
  await db.query("INSERT INTO users(id,company_id,email,role,enabled,custom_permissions) VALUES($1,$2,$3,1,true,$4)",[actorId,companyId,actorId+'@example.test',JSON.stringify(['history.import'])]);
  for(const id of [productId,secondId]) await db.query("INSERT INTO products(id,company_id,name,unit,total_quantity,available_quantity) VALUES($1,$2,'Synthetic','kg',999,888)",[id,companyId]);
  await db.query("INSERT INTO lots(id,company_id,name,area) VALUES($1,$2,'Synthetic',2)",[lotId,companyId]);
  if(db.postgis){
    await db.query("UPDATE lots SET geom=ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326) WHERE id=$1",[lotId]);
    assert.equal((await db.query('SELECT ST_IsValid(geom) valid FROM lots WHERE id=$1',[lotId])).rows[0].valid,true);
  }

  const args={companyId,actorId,date:'2020-01-01',entries:[{product_id:productId,unit:'kg',quantity:'10.123456',expiration_date:null}],key:randomUUID(),confirmed:true};
  const prepare=(a=args)=>initial.prepare(pool,a);
  const confirm=async(a=args)=>initial.confirm(pool,{...a,previewHash:(await prepare(a)).preview_hash});
  const count=async table=>(await db.query('SELECT count(*)::int n FROM '+table)).rows[0].n;
  const balance=async()=> (await stock.balances(db,companyId,[productId])).get(productId)?.on_hand||'0';
  return {db,pool,queries,companyId,actorId,productId,secondId,lotId,args,prepare,confirm,count,balance};
}
test('A/B/C: configured date, exact positive quantities, explicit compatible units and full/null expiry',async t=>{
  const x=await fixture(t);
  for(const quantity of [0,-1,'NaN','1.1234567','1e3',null]) await assert.rejects(x.prepare({...x.args,entries:[{...x.args.entries[0],quantity}]}),{status:400});
  for(const unit of ['L','bag',null,undefined]) await assert.rejects(x.prepare({...x.args,entries:[{...x.args.entries[0],quantity:1050,unit}]}),{status:400});
  assert.equal((await x.prepare({...x.args,entries:[{...x.args.entries[0],quantity:1050,unit:'g'}]})).entries[0].quantity,'1.050000');
  for(const expiration_date of ['03/27','12/26','01/27','2027-02-30','']) await assert.rejects(x.prepare({...x.args,entries:[{...x.args.entries[0],expiration_date}]}),{status:400});
  await x.db.query('UPDATE companies SET inventory_control_start_date=NULL WHERE id=$1',[x.companyId]);
  await assert.rejects(x.prepare(),/inicio de control/);
  await assert.rejects(initial.confirm(x.pool,{...x.args,previewHash:'a'.repeat(64)}),/inicio de control/);
  assert.equal(await x.count('stock_batches'),0);
});
test('D/E/J: preview writes nothing; two products, exact quantity/date/actor, NULL expiry and no legacy double count',async t=>{
  const x=await fixture(t);x.args.entries.push({product_id:x.secondId,unit:'kg',quantity:'2.000001',expiration_date:'2030-05-12'});
  const preview=await x.prepare();assert.equal(preview.persisted,false);
  for(const table of ['stock_initial_openings','stock_batches','stock_movements']) assert.equal(await x.count(table),0);
  const result=await x.confirm();assert.equal(result.entries.length,2);
  const batches=(await x.db.query('SELECT * FROM stock_batches ORDER BY initial_quantity DESC')).rows;
  const movements=(await x.db.query('SELECT *,effective_date::text d FROM stock_movements ORDER BY quantity DESC')).rows;
  assert.equal(batches[0].initial_quantity,'10.123456');assert.equal(batches[0].available_quantity,'10.123456');
  assert.equal(batches[0].expiration_date,null);assert.equal(batches[0].origin,'stock_initial');
  assert.equal(batches[0].stock_initial_id,result.opening_id);assert.equal(batches[0].created_by,x.actorId);
  assert.equal((await x.db.query('SELECT received_date::text d FROM stock_batches LIMIT 1')).rows[0].d,'2020-01-01');
  assert.equal(movements[0].movement_type,'stock_initial');assert.equal(movements[0].quantity,'10.123456');
  assert.equal(movements[0].d,'2020-01-01');assert.equal(movements[0].created_by,x.actorId);assert.equal(movements[0].usage_id,null);
  const products=(await x.db.query('SELECT * FROM products WHERE id=$1',[x.productId])).rows;
  assert.equal(products[0].available_quantity,'888');assert.equal(products[0].total_quantity,'999');
  const decorated=await stock.decorate(x.db,x.companyId,products);
  assert.equal(decorated[0].available_quantity,'10.123456');assert.equal(decorated[0].legacy_available_quantity,'888');
  assert.equal(await x.balance(),'10.123456');
});
test('F: injected failure during second batch INSERT rolls back opening, first batch and first movement',async t=>{
  const x=await fixture(t);x.args.entries.push({product_id:x.secondId,unit:'kg',quantity:2,expiration_date:null});
  const preview=await x.prepare();
  const failing={async connect(){const c=await x.pool.connect();let inserts=0;return {...c,query(sql,args){
    if(sql.startsWith('INSERT INTO stock_batches')&&++inserts===2) throw new Error('Injected second batch failure');return c.query(sql,args);
  }}}};
  await assert.rejects(initial.confirm(failing,{...x.args,previewHash:preview.preview_hash}),/Injected/);
  for(const table of ['stock_initial_openings','stock_batches','stock_movements']) assert.equal(await x.count(table),0);
  await x.confirm();assert.equal(await x.count('stock_batches'),2);
});
test('G/H/I: retry returns recorded result; changed payload conflicts; other key cannot open twice',async t=>{
  const x=await fixture(t);const preview=await x.prepare();const args={...x.args,previewHash:preview.preview_hash};
  const [first,retry]=await Promise.all([initial.confirm(x.pool,args),initial.confirm(x.pool,args)]);
  assert.equal(retry.replayed,true);assert.equal(first.opening_id,retry.opening_id);assert.deepEqual(first.entries,retry.entries);
  await assert.rejects(initial.confirm(x.pool,{...args,entries:[{...args.entries[0],quantity:11}]}),{status:409});
  await assert.rejects(initial.confirm(x.pool,{...args,key:randomUUID()}),/ya tiene una apertura/);
  await assert.rejects(stock.transaction(x.pool,c=>stock.receiveStock(c,{companyId:x.companyId,actorId:x.actorId,productId:x.productId,
    unit:'kg',quantity:5,origin:'legacy',approvedLegacy:true,key:randomUUID()})),/Legacy opening cannot/);
  assert.equal(await x.count('stock_batches'),1);assert.equal(await x.count('stock_movements'),1);
});
test('confirmation, preview freshness, effective permissions and tenant catalog are enforced',async t=>{
  const x=await fixture(t),preview=await x.prepare(),args={...x.args,previewHash:preview.preview_hash};
  for(const override of [{confirmed:false},{key:''},{previewHash:undefined}]) await assert.rejects(initial.confirm(x.pool,{...args,...override}),{status:400});
  await assert.rejects(initial.confirm(x.pool,{...args,previewHash:'a'.repeat(64)}),/preview cambió/);

  await x.db.query('UPDATE users SET role=3,custom_permissions=$2 WHERE id=$1',[x.actorId,'[]']);
  await assert.rejects(x.prepare(),{status:403});
  await x.db.query('UPDATE users SET role=1,custom_permissions=$2 WHERE id=$1',[x.actorId,'["history.import"]']);
  await assert.rejects(x.prepare({...x.args,entries:[{...x.args.entries[0],product_id:randomUUID()}]}),/otra empresa/);
  await x.db.query('UPDATE products SET enabled=false WHERE id=$1',[x.productId]);await assert.rejects(initial.confirm(x.pool,args),{status:404});
  assert.equal(await x.count('stock_batches'),0);
});
test('existing receipts prevent initial opening; duplicate lines rejected; separate known expiries allowed',async t=>{
  const x=await fixture(t);
  await assert.rejects(x.prepare({...x.args,entries:[...x.args.entries,...x.args.entries]}),/repetidos/);
  const plan=await x.prepare({...x.args,entries:[...x.args.entries,{...x.args.entries[0],expiration_date:'2030-01-01'}]});assert.equal(plan.entries.length,2);
  await stock.transaction(x.pool,c=>stock.receiveStock(c,{companyId:x.companyId,actorId:x.actorId,productId:x.productId,quantity:1,unit:'kg',origin:'purchase',received_date:'2020-01-02',key:randomUUID()}));
  await assert.rejects(x.confirm(),/Ya existen partidas/);assert.equal(await x.count('stock_initial_openings'),0);
});
test('K/L/M/N/P: opening → historical import without alerts → purchase → NORMAL Planning → audited adjustment',async t=>{
  const x=await fixture(t);await x.confirm();const before=await x.balance();
  const p=randomUUID(),pp=randomUUID(),u=randomUUID();
  const records={planning:[{id:p,company_id:x.companyId,activity_type:'fumigacion',status:'completado',responsible_user:x.actorId,start_at:'2019-01-01',end_at:'2019-01-01',effective_date:'2019-01-01'}],
    planning_products:[{id:pp,planning_id:p,product_id:x.productId,amount:1000,unit:'kg'}],
    usage_records:[{id:u,company_id:x.companyId,product_id:x.productId,amount_used:1000,unit:'kg',date:'2019-01-01',user_id:x.actorId,source_planning_id:p,source_planning_product_id:pp}],
    planning_product_completions:[{planning_id:p,planning_product_id:pp,usage_id:u,actual_amount:1000}]};
  await history.importHistory(x.pool,{companyId:x.companyId,actorId:x.actorId,key:randomUUID(),source:'Synthetic historical',confirmedNoStock:true,records});
  assert.equal(await x.balance(),before);assert.equal(await x.count('stock_movements'),1);assert.equal(await x.count('notifications'),0);
  const common={companyId:x.companyId,actorId:x.actorId,productId:x.productId,unit:'kg'};
  await stock.transaction(x.pool,c=>stock.receiveStock(c,{...common,quantity:5,origin:'purchase',received_date:'2020-01-02',key:randomUUID()}));
  assert.equal(await x.balance(),'15.123456');
  const normal=randomUUID(),normalPP=randomUUID();
  await x.db.query("INSERT INTO planning(id,company_id,activity_type,status,start_at,end_at,responsible_user) VALUES($1,$2,'fumigacion','pendiente','2020-01-03','2020-01-03',$3)",[normal,x.companyId,x.actorId]);
  await x.db.query("INSERT INTO planning_products(id,planning_id,product_id,amount,unit) VALUES($1,$2,$3,3,'kg')",[normalPP,normal,x.productId]);
  await stock.transaction(x.pool,c=>completion.applyPlanningProductUsage(c,{companyId:x.companyId,actorId:x.actorId,planning:{id:normal,inventory_impact_mode:'NORMAL',responsible_user:x.actorId},
    selections:[{lot_id:x.lotId,area_ha:2}],plannedProducts:[{id:normalPP,product_id:x.productId,unit:'kg',amount:3}],effectiveDate:'2020-01-03'}));
  assert.equal(await x.balance(),'12.123456');
  await stock.transaction(x.pool,c=>stock.adjustStock(c,{...common,quantity:2,direction:'out',reason:'Physical correction',key:randomUUID()}));
  await stock.transaction(x.pool,c=>stock.adjustStock(c,{...common,quantity:1,direction:'in',reason:'Physical correction',key:randomUUID()}));
  assert.equal(await x.balance(),'11.123456');
  assert.equal((await x.db.query('SELECT sum(quantity)::text n FROM stock_movements')).rows[0].n,await x.balance());
  assert.equal((await x.db.query('SELECT available_quantity FROM products WHERE id=$1',[x.productId])).rows[0].available_quantity,'888');
});
test('O: movements, opening metadata, original batch and effective date cannot be rewritten; incomplete SQL opening rolls back',async t=>{
  const x=await fixture(t);await x.confirm();
  for(const sql of ["UPDATE stock_movements SET quantity=20","DELETE FROM stock_movements","TRUNCATE stock_movements",
    "UPDATE stock_initial_openings SET effective_date='2020-02-01'","DELETE FROM stock_initial_openings",
    "UPDATE stock_batches SET initial_quantity=20","DELETE FROM stock_batches","UPDATE companies SET inventory_control_start_date='2020-02-01'"]) await assert.rejects(x.db.query(sql),/immutable/);
  assert.equal(await x.balance(),'10.123456');
  const other=randomUUID();await x.db.query("INSERT INTO companies(id,name,inventory_control_start_date) VALUES($1,'Other','2020-01-01')",[other]);
  await assert.rejects(x.db.query('INSERT INTO stock_initial_openings(company_id,effective_date,actor_id,idempotency_key,request_hash,payload) VALUES($1,$2,$3,$4,$5,$6)',[other,'2020-01-01',x.actorId,'key','a'.repeat(64),'{}']),/foreign key/);
  const actor=randomUUID();await x.db.query("INSERT INTO users(id,company_id,email,role,enabled) VALUES($1,$2,$3,3,true)",[actor,other,actor+'@example.test']);
  await assert.rejects(stock.transaction(x.pool,c=>c.query('INSERT INTO stock_initial_openings(company_id,effective_date,actor_id,idempotency_key,request_hash,payload) VALUES($1,$2,$3,$4,$5,$6)',[other,'2020-01-01',actor,'key','a'.repeat(64),JSON.stringify({entries:[{product_id:x.productId,quantity:1,unit:'kg',expiration_date:null}]})])),/Incomplete/);
  assert.equal(await x.count('stock_initial_openings'),1);
});


test('fecha: elección explícita, corrección, auditoría, históricos y preview anterior invalidado', async t => {
  const x = await fixture(t);
  const setDate = date => require('../services/inventoryControlStart')(x.pool, { companyId: x.companyId, actorId: x.actorId, date });
  await x.db.query('UPDATE companies SET inventory_control_start_date=NULL WHERE id=$1', [x.companyId]);
  for (const date of [null, undefined, '', '2026-02-30']) await assert.rejects(setDate(date), { status: 400 });
  assert.equal((await x.db.query('SELECT inventory_control_start_date FROM companies WHERE id=$1', [x.companyId])).rows[0].inventory_control_start_date, null);
  await setDate(x.args.date);
  const oldPreview = await x.prepare();
  // Explicit historical operations are independent of the control date.
  await history.importHistory(x.pool, { companyId:x.companyId, actorId:x.actorId, key:randomUUID(), source:'synthetic', confirmedNoStock:true,
    records:{ usage_records:[{id:randomUUID(),product_id:x.productId,user_id:x.actorId,amount_used:2,unit:'kg',date:'2019-01-01'}] } });
  const before = (await x.db.query('SELECT * FROM usage_records')).rows;
  await setDate('2020-02-01');
  assert.deepEqual((await x.db.query('SELECT * FROM usage_records')).rows, before);
  assert.equal(await x.count('stock_movements'), 0);
  assert.equal(await x.count('historical_events'), 2);
  await setDate('2020-02-01'); // retry is a no-op, including audit
  assert.equal(await x.count('historical_events'), 2);
  await assert.rejects(initial.confirm(x.pool, {...x.args,previewHash:oldPreview.preview_hash}), /fecha/i);
  const next = {...x.args,date:'2020-02-01'};
  await x.confirm(next);
  await assert.rejects(setDate('2020-03-01'), /confirmado/);
  assert.equal((await x.db.query('SELECT inventory_control_start_date::text FROM companies WHERE id=$1',[x.companyId])).rows[0].inventory_control_start_date,'2020-02-01');
});

test('fecha: partidas incluso agotadas bloquean; permisos y tenant siguen vigentes', async t => {
  const x = await fixture(t);
  const change = require('../services/inventoryControlStart');
  const args = {companyId:x.companyId,actorId:x.actorId,date:'2020-02-01'};
  await assert.rejects(change(x.pool,{...args,companyId:randomUUID()}),{status:403});
  await x.db.query("UPDATE users SET custom_permissions='[]' WHERE id=$1",[x.actorId]);
  await assert.rejects(change(x.pool,args),{status:403});
  await x.db.query(`UPDATE users SET custom_permissions='["history.import"]' WHERE id=$1`,[x.actorId]);
  await x.db.query("INSERT INTO stock_batches(company_id,product_id,initial_quantity,available_quantity,unit,received_date,origin,created_by) VALUES($1,$2,1,0,'kg','2020-01-01','purchase',$3)",[x.companyId,x.productId,x.actorId]);
  await assert.rejects(change(x.pool,args), /existencias o movimientos/);
  assert.equal(await x.count('historical_events'),0);
});

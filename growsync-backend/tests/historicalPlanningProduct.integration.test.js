// Disposable PostgreSQL only; no .env, network database or production fixtures.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {addProduct,inventorySnapshot}=require('../services/historicalPlanningProduct');
const {mutate}=require('../services/historicalMutation');
let db,pool;
before(async()=>{
  db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['./historySchema.fixture.sql','../migrations/20260916_historical_no_stock.sql'])await db.exec(fs.readFileSync(require.resolve(f),'utf8'));
  let tail=Promise.resolve();
  pool={async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query:(s,a)=>db.query(s,a),release};}};
});
after(()=>db.close());
async function fixture(mode='HISTORICAL_NO_STOCK'){
  const companyId=randomUUID(),actorId=randomUUID(),planningId=randomUUID(),productId=randomUUID(),lotId=randomUUID();
  await db.query("INSERT INTO companies(id,name) VALUES($1,'Prueba histórica')",[companyId]);
  await db.query("INSERT INTO users(id,company_id,email,role,enabled,custom_permissions) VALUES($1,$2,$3,3,true,'[\"planning.edit\",\"history.import\"]')",[actorId,companyId,actorId+'@example.test']);
  await db.query("INSERT INTO products(id,company_id,name,unit,total_quantity,available_quantity) VALUES($1,$2,'Semilla Soja','kg',100,100)",[productId,companyId]);
  await db.query("INSERT INTO lots(id,company_id,name,area) VALUES($1,$2,'Lote de prueba',70.97)",[lotId,companyId]);
  await db.query(`INSERT INTO planning(id,company_id,title,activity_type,start_at,end_at,responsible_user,status,inventory_impact_mode)
    VALUES($1,$2,'Siembra histórica','siembra','2025-12-10','2025-12-11',$3,'completado',$4)`,[planningId,companyId,actorId,mode]);
  await db.query('INSERT INTO planning_lots(planning_id,lot_id,area_ha) VALUES($1,$2,70.97)',[planningId,lotId]);
  const batch=(await db.query("INSERT INTO stock_batches(company_id,product_id,initial_quantity,available_quantity,unit,origin,created_by,received_date) VALUES($1,$2,100,100,'kg','purchase',$3,'2026-09-24') RETURNING id",[companyId,productId,actorId])).rows[0].id;
  await db.query("INSERT INTO stock_movements(company_id,product_id,batch_id,movement_type,quantity,unit,operation_id,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,'receipt',100,'kg',gen_random_uuid(),'fixture',repeat('a',64),$4)",[companyId,productId,batch,actorId]);
  const input={companyId,actorId,planningId,body:{product_id:productId,amount:'4613.05'}};
  return {...input,productId,input,add:()=>addProduct(pool,input),snapshot:()=>inventorySnapshot(db,companyId)};
}
test('siembra sin productos: cantidades, auditoría, inventario intacto, reintento y corrección posterior sin consumos',async()=>{
  const x=await fixture(),stock=await x.snapshot();
  const planning=(await db.query('SELECT to_jsonb(p) p FROM planning p WHERE id=$1',[x.planningId])).rows[0].p;
  const result=await x.add();assert.equal(result.replayed,false);
  const pp=(await db.query('SELECT * FROM planning_products WHERE planning_id=$1',[x.planningId])).rows;
  assert.equal(pp.length,1);assert.equal(Number(pp[0].amount),4613.05);assert.equal(pp[0].unit,'kg');
  const pc=(await db.query('SELECT * FROM planning_product_completions WHERE planning_id=$1',[x.planningId])).rows;
  assert.equal(pc.length,1);assert.equal(Number(pc[0].actual_amount),4613.05);assert.equal(pc[0].usage_id,null);
  assert.deepEqual((await db.query('SELECT to_jsonb(p) p FROM planning p WHERE id=$1',[x.planningId])).rows[0].p,planning);
  assert.equal(await x.snapshot(),stock);
  assert.equal((await db.query('SELECT count(*)::int n FROM usage_records WHERE company_id=$1',[x.companyId])).rows[0].n,0);
  const events=(await db.query('SELECT * FROM historical_events WHERE entity_id=$1',[x.planningId])).rows;
  assert.equal(events.length,1);assert.equal(events[0].actor_id,x.actorId);
  assert.deepEqual(events[0].before_data.products,[]);
  assert.equal(events[0].after_data.operation,'add_historical_product');assert.equal(events[0].after_data.product_id,x.productId);
  assert.equal(events[0].after_data.unit,'kg');assert.equal(Number(events[0].after_data.amount),4613.05);
  assert.equal((await x.add()).replayed,true);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_events WHERE entity_id=$1',[x.planningId])).rows[0].n,1);
  await assert.rejects(addProduct(pool,{...x.input,body:{...x.input.body,amount:'10'}}),e=>e.status===409);
  await mutate(pool,{companyId:x.companyId,actorId:x.actorId,table:'planning',id:x.planningId,body:{products:[{planning_product_id:pp[0].id,amount:'4614',actual_amount:'4612'}]}});
  assert.equal(Number((await db.query('SELECT actual_amount FROM planning_product_completions WHERE planning_id=$1',[x.planningId])).rows[0].actual_amount),4612);
  assert.equal(await x.snapshot(),stock);
});
test('NORMAL, otra empresa, producto ajeno, permisos incompletos y cantidades inválidas no escriben',async()=>{
  const x=await fixture(),other=await fixture(),normal=await fixture('NORMAL');
  await assert.rejects(normal.add(),e=>e.status===409);
  await assert.rejects(addProduct(pool,{...x.input,companyId:other.companyId,actorId:other.actorId}),e=>e.status===404);
  await assert.rejects(addProduct(pool,{...x.input,body:{...x.input.body,product_id:other.productId}}),e=>e.status===404);
  for(const permissions of [['planning.edit'],['history.import'],[]]){
    await db.query('UPDATE users SET custom_permissions=$2::text::jsonb WHERE id=$1',[x.actorId,JSON.stringify(permissions)]);
    await assert.rejects(x.add(),e=>e.status===403);
  }
  for(const amount of ['0','-1','NaN','1.0000001'])await assert.rejects(addProduct(pool,{...x.input,body:{...x.input.body,amount}}),e=>e.status===400);
  await assert.rejects(addProduct(pool,{...x.input,body:{...x.input.body,unit:'L'}}),e=>e.status===400);
  for(const item of [x,normal])assert.equal((await db.query('SELECT count(*)::int n FROM planning_products WHERE planning_id=$1',[item.planningId])).rows[0].n,0);
});
test('reintentos concurrentes crean un solo producto y evento',async()=>{
  const x=await fixture();const results=await Promise.all([x.add(),x.add()]);
  assert.deepEqual(results.map(r=>r.replayed),[false,true]);assert.equal(results[0].product.id,results[1].product.id);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_events WHERE entity_id=$1',[x.planningId])).rows[0].n,1);
});
test('un trigger que altera inventario causa rollback de producto, cantidad y auditoría',async()=>{
  const x=await fixture(),stock=await x.snapshot();
  await db.exec(`CREATE FUNCTION sabotage_product() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE products SET available_quantity=available_quantity+1 WHERE id=NEW.product_id; RETURN NEW; END $$;
    CREATE TRIGGER sabotage_product AFTER INSERT ON planning_products FOR EACH ROW EXECUTE FUNCTION sabotage_product();`);
  try{await assert.rejects(x.add(),e=>e.status===409 && /inventario/.test(e.message));}
  finally{await db.exec('DROP TRIGGER sabotage_product ON planning_products; DROP FUNCTION sabotage_product();');}
  assert.equal(await x.snapshot(),stock);
  for(const table of ['planning_products','planning_product_completions'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table} WHERE planning_id=$1`,[x.planningId])).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_events WHERE entity_id=$1',[x.planningId])).rows[0].n,0);
});
test('endpoint dedicado usa tenant autenticado y exige ambos permisos',async t=>{
  const express=require('express'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
  const filename=path.resolve(__dirname,'../routes/history.js'),actual=createRequire(filename),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:n=>n==='../db/supabaseClient'?{pool}:actual(n)},{filename});
  const app=express();app.use(express.json());
  app.use(async(req,res,next)=>{req.user=(await db.query('SELECT * FROM users WHERE id=$1',[req.headers['x-actor']])).rows[0];if(!req.user)return res.sendStatus(401);next();});
  app.use('/history',module.exports);app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const x=await fixture(),other=await fixture();
  const request=(actor,body=x.input.body)=>fetch(`http://127.0.0.1:${server.address().port}/history/planning/${x.planningId}/products`,{method:'POST',headers:{'Content-Type':'application/json','x-actor':actor},body:JSON.stringify(body)});
  const options=actor=>fetch(`http://127.0.0.1:${server.address().port}/history/planning/${x.planningId}/product-options`,{headers:{'x-actor':actor}});
  assert.equal((await options(other.actorId)).status,404);
  const catalog=await (await options(x.actorId)).json();
  assert.deepEqual(catalog.map(p=>p.id),[x.productId]);
  assert.deepEqual(Object.keys(catalog[0]).sort(),['id','name','unit']);
  assert.equal((await request(other.actorId)).status,404);
  for(const permissions of [['planning.edit'],['history.import']]){
    await db.query('UPDATE users SET custom_permissions=$2::text::jsonb WHERE id=$1',[x.actorId,JSON.stringify(permissions)]);
    assert.equal((await request(x.actorId)).status,403);
    assert.equal((await options(x.actorId)).status,403);
  }
  await db.query('UPDATE users SET custom_permissions=NULL WHERE id=$1',[x.actorId]);
  assert.equal((await request(x.actorId)).status,201);assert.equal((await request(x.actorId)).status,200);
});
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRequire}=require('node:module');
const schema=require('../validations/products.schema');
const stock=require('../services/stock');
function load(relative, fakeDb, stockOverride){
  const file=path.join(__dirname,relative),realRequire=createRequire(file),mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,exports:mod.exports,console,require:id=>
    id.includes('supabaseClient')?fakeDb:id.endsWith('/stock')&&stockOverride?stockOverride:id.endsWith('/notifications')?{createNotification:async()=>{}}:realRequire(id)});
  return mod.exports;
}
function fake(){
  const calls=[];const db={from(table){calls.push(['from',table]);return this;},pool:{query:async()=>{throw Error('Unexpected SQL');}}};
  for(const name of ['select','eq','order','range','update','insert','ilike'])db[name]=(...args)=>{calls.push([name,...args]);return db;};
  db.then=resolve=>resolve({data:[],count:0});db.maybeSingle=async()=>({data:null});
  return {db,calls};
}
const response=()=>({code:200,status(code){this.code=code;return this;},json(data){this.body=data;return this;}});
test('API exige fecha en purchase/return y deriva ajustes al endpoint con motivo',async()=>{
  const {db}=fake();let calls=0;
  const ctrl=load('../controllers/products/stock.js',db,{...stock,isEnabled:()=>true,
    transaction:async(_pool,fn)=>fn({}),receiveStock:async()=>{calls++;return [];}});
  for(const origin of ['purchase','return','adjustment'])for(const received_date of [undefined,null,'2020-01-01']){
    const before=calls,res=response();let error;
    await ctrl.registerReceipt({user:{company_id:'00000000-0000-4000-8000-000000000001',id:'actor'},
      params:{id:'00000000-0000-4000-8000-000000000002'},get:()=> 'key',
      body:{origin,received_date,quantity:1,unit:'kg'}},res,e=>{error=e;});
    if(origin==='adjustment'||received_date==null){assert.equal(error.status,400);assert.equal(calls,before);}
    else{assert.equal(error,undefined);assert.equal(calls,before+1);}
  }
});
test('includeDisabled interpreta false/0 y valida entradas inválidas',()=>{
  for(const value of ['false','0',false])assert.equal(schema.listQuery.parse({query:{includeDisabled:value}}).query.includeDisabled,false);
  for(const value of ['true','1',true])assert.equal(schema.listQuery.parse({query:{includeDisabled:value}}).query.includeDisabled,true);
  assert.throws(()=>schema.listQuery.parse({query:{includeDisabled:'yes'}}));
});
test('disabled list y enable restringen company_id y rechazan empresa ausente',async()=>{
  const {db,calls}=fake(),ctrl=load('../controllers/products/products.disabled.js',db);
  for(const name of ['listDisabledProducts','enableProduct']){
    calls.length=0;
    await ctrl[name]({user:{company_id:'company'},query:{},params:{id:'product'}},response(),e=>{throw e;});
    assert(calls.some(c=>c[0]==='eq'&&c[1]==='company_id'&&c[2]==='company'));
    calls.length=0;const res=response();await ctrl[name]({user:{},query:{},params:{}},res,e=>{throw e;});
    assert.equal(res.code,400);assert.equal(calls.length,0);
  }
});
test('listado general exige permiso extra y false textual sigue filtrando enabled',async()=>{
  const {db,calls}=fake(),ctrl=load('../controllers/products/products.js',db);
  for(const value of [true,'true','1']){
    const res=response();await ctrl.listProducts({user:{company_id:'company',role:0},query:{includeDisabled:value}},res,e=>{throw e;});
    assert.equal(res.code,403);
  }
  calls.length=0;const res=response();await ctrl.listProducts({user:{company_id:'company',role:0},query:{includeDisabled:'false'}},res,e=>{throw e;});
  assert.equal(res.code,200);assert(calls.some(c=>c[0]==='eq'&&c[1]==='enabled'&&c[2]===true));
});
test('modelo activo rechaza saldo directo y toggle por edición',async()=>{
  const {db,calls}=fake(),ctrl=load('../controllers/products/products.js',db);
  {
    for(const body of [{available_quantity:5},{total_quantity:7},{enabled:true},{price:2}]){
      let error;await ctrl.editProduct({user:{company_id:'company'},params:{id:'product'},body},response(),e=>{error=e;});
      assert.equal(error.status,400);assert.equal(calls.length,0);
    }
  }
});
test('rutas usan inventory.edit y permisos explícitos en servicios nuevos',()=>{
  const routes=fs.readFileSync(path.join(__dirname,'../routes/products.js'),'utf8');
  assert(!routes.includes('PERMISSIONS.INVENTORY_UPDATE'));
  assert(routes.includes("router.post('/:id/receipts',checkRole(2),requirePermission(PERMISSIONS.INVENTORY_EDIT)"));
  assert(routes.includes("router.post('/:id/adjustments',checkRole(2),requirePermission(PERMISSIONS.INVENTORY_EDIT)"));
  assert(routes.includes("router.get('/:id/movements',checkRole(0),requirePermission(PERMISSIONS.INVENTORY_VIEW)"));
  assert.equal(stock.isEnabled('unconfigured-company'),true);
});
test('Usage legacy valida producto/empresa antes de insertar',async()=>{
  const {db,calls}=fake(),ctrl=load('../controllers/usage/usage.js',db,{...stock,isEnabled:()=>false}),res=response();
  await ctrl.createUsage({user:{company_id:'company'},body:{product_id:'foreign-product',unit:'kg',amount_used:2}},res);
  assert.equal(res.code,404);
  assert(calls.some(c=>c[0]==='eq'&&c[1]==='company_id'&&c[2]==='company'));
  assert(!calls.some(c=>c[0]==='insert'||c[0]==='update'));
});

test('listado vacío informa flag booleano de la empresa sin exponer configuración',async()=>{
  for(const enabled of [true]){
    const {db}=fake(),ctrl=load('../controllers/products/products.js',db,{...stock,isEnabled:()=>enabled,decorate:async()=>[]}),res=response();
    await ctrl.listProducts({user:{company_id:'company'},query:{}},res,e=>{throw e;});
    assert.equal(res.body.inventory_v1_enabled,enabled);
    assert.equal(res.body.data.length,0);
  }
});
test('crear identidad sin activar partidas admite metadatos y saldo inicial cero',async()=>{
  const {db,calls}=fake();db.single=async()=>({data:{id:'product'}});
  db.pool.query=async sql=>{assert(sql.includes('pg_constraint'));return {rows:[]};};
  const ctrl=load('../controllers/products/products.js',db,{...stock,isEnabled:()=>false,decorate:async(_p,_c,rows)=>rows});
  await ctrl.addProduct({user:{company_id:'company'},body:{name:'Prueba',category:'semillas',unit:'kg',manufacturer:'Marca',minimum_stock:2}},response(),e=>{throw e;});
  const inserted=calls.find(c=>c[0]==='insert')[1][0];
  assert.equal(inserted.total_quantity,0);assert.equal(inserted.available_quantity,0);assert.equal(inserted.manufacturer,'Marca');
  assert(!calls.some(c=>c[0]==='from'&&c[1]!=='products'));
});
test('endpoints de historial e ingreso apagados no consultan ni escriben DB',async()=>{
  const {db,calls}=fake(),ctrl=load('../controllers/products/stock.js',db,{...stock,isEnabled:()=>false});
  for(const method of ['listBatches','listMovements','registerReceipt','registerAdjustment']){
    let error;
    await ctrl[method]({user:{company_id:'00000000-0000-4000-8000-000000000001'},params:{id:'00000000-0000-4000-8000-000000000002'}},response(),e=>{error=e;});
    assert.ok(error);assert.equal(calls.length,0);
  }
});

test('endpoint de ajuste valida motivo y devuelve producto actualizado',async()=>{
  const {db}=fake();const ctx={company_id:'00000000-0000-4000-8000-000000000001',id:'actor'};
  let executed=0;
  const ctrl=load('../controllers/products/stock.js',db,{...stock,isEnabled:()=>true,
    transaction:async(_pool,fn)=>fn({query:async()=>({rows:[{id:'product'}]})}),
    adjustStock:async(_c,x)=>{executed++;assert.equal(x.key,'retry');return [{movement_type:'adjustment_in'}];},
    decorate:async()=>[{id:'product',on_hand_quantity:'4.000000'}]});
  const req={user:ctx,params:{id:'00000000-0000-4000-8000-000000000002'},get:()=> 'retry',body:{direction:'in',quantity:4,reason:'Conteo'}};
  const res=response();await ctrl.registerAdjustment(req,res,e=>{throw e;});
  assert.equal(res.body.product.on_hand_quantity,'4.000000');assert.equal(executed,1);
  let error;await ctrl.registerAdjustment({...req,body:{...req.body,reason:'  '}},response(),e=>{error=e;});
  assert.equal(error.status,400);assert.equal(executed,1);
});

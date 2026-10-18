const {test}=require('node:test'),assert=require('node:assert/strict');
const {PERMISSIONS,getEffectivePermissions}=require('../constants/permissions');
const {assertCanExecutePlanning}=require('../services/planningExecution');
const schema=require('../validations/planning.schema');
const user={id:'me',company_id:'company',role:0},row={id:'task',company_id:'company',responsible_user:'me',enabled:true,status:'pendiente'};
test('execute defaults accompany view; custom permissions replace defaults including Admin',()=>{
 assert.equal(PERMISSIONS.PLANNING_EXECUTE,'planning.execute');
 for(const role of [0,1,2]){const p=getEffectivePermissions({role});assert.ok(p.includes('planning.execute'));assert.ok(p.includes('planning.view'));}
 assert.ok(getEffectivePermissions({role:2}).includes('planning.edit'));assert.deepEqual(getEffectivePermissions({role:3}),['all']);
 for(const role of [0,1,2,3])assert.deepEqual(getEffectivePermissions({role,custom_permissions:['planning.view']}),['planning.view']);
});
test('ownership, tenancy, enabled/cancelled/history enforced; editors override ownership, never tenancy',()=>{
 assert.doesNotThrow(()=>assertCanExecutePlanning(user,row));
 for(const patch of [{responsible_user:'other'},{company_id:'foreign'},{enabled:false},{status:'cancelado'}])assert.throws(()=>assertCanExecutePlanning(user,{...row,...patch}),e=>e.status===403);
 assert.throws(()=>assertCanExecutePlanning({...user,custom_permissions:['planning.view']},row),e=>e.status===403);
 assert.throws(()=>assertCanExecutePlanning(user,{...row,inventory_impact_mode:'HISTORICAL_NO_STOCK'}),e=>e.status===409);
 for(const permissions of [['planning.edit'],['planning.execute','planning.edit'],['all']]){
  assert.doesNotThrow(()=>assertCanExecutePlanning({...user,custom_permissions:permissions},{...row,responsible_user:'other'}));
  assert.throws(()=>assertCanExecutePlanning({...user,custom_permissions:permissions},{...row,company_id:'foreign'}),e=>e.status===403);
 }
 assert.doesNotThrow(()=>assertCanExecutePlanning({...user,custom_permissions:['planning.execute']},{...row,status:'completado'}),'existing service owns technical retry checks');
});
test('execution endpoints have narrow bodies, cannot inject status or planned data',()=>{
 const params={id:'11111111-1111-4111-8111-111111111111'};
 assert.equal(schema.startSchema.safeParse({params,body:{}}).success,true);
 for(const key of ['status','title','responsible_user','products','lot_selections','recipe_id','effective_date'])assert.equal(schema.startSchema.safeParse({params,body:{[key]:'injected'}}).success,false);
 assert.equal(schema.completeActivitySchema.safeParse({params,body:{effective_date:'2026-10-21'}}).success,true);
 for(const key of ['status','title','responsible_user','actual_products','created_by','recipe_id'])assert.equal(schema.completeActivitySchema.safeParse({params,body:{effective_date:'2026-10-21',[key]:'injected'}}).success,false);
});

test('execute alone cannot edit products, receive stock or adjust inventory even with an Admin role',async t=>{
 const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),express=require('express');
 const filename=require.resolve('../routes/products'),actual=createRequire(filename),module={exports:{}};
 let writes=0;const controllers=new Proxy({},{get:()=> (_req,res)=>{writes++;res.json({ok:true});}});
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>name.startsWith('../controllers/products/')?controllers:actual(name)},{filename});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'me',company_id:'company',role:3,custom_permissions:['planning.execute']};next();});app.use('/products',module.exports);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port+'/products/11111111-1111-4111-8111-111111111111';
 for(const [path,method,body] of [['','PUT',{name:'No editar'}],['/receipts','POST',{quantity:1,unit:'kg',received_date:'2026-10-21'}],['/adjustments','POST',{quantity:1,reason:'No ajustar'}]]){
  const response=await fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,403,path);
 }assert.equal(writes,0);
});

// Local HTTP authorization only: real routes/validators/guards, fail-closed spies at data boundaries.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {PERMISSIONS,ROLE_PERMISSIONS,getEffectivePermissions}=require('../constants/permissions');
const actions=['view','create','edit','disable','enable','view_disabled'];

test('recipe permissions are distinct; legacy aliases are exact, one-way and do not mutate custom permissions',()=>{
 for(const action of actions){
  assert.equal(PERMISSIONS['RECIPES_'+action.toUpperCase()],'recipes.'+action);
  for(const role of [0,1,2,3]){
   const custom=Object.freeze(['usage.'+action]);
   assert.deepEqual(getEffectivePermissions({role,custom_permissions:custom}),['usage.'+action,'recipes.'+action]);
   assert.deepEqual(getEffectivePermissions({role,custom_permissions:['recipes.'+action]}),['recipes.'+action]);
   assert.deepEqual(getEffectivePermissions({role,custom_permissions:[]}),[]);
  }
 }
 assert.deepEqual(getEffectivePermissions({custom_permissions:['all']}),['all']);
 assert.deepEqual(getEffectivePermissions({custom_permissions:['usage.unknown']}),['usage.unknown']);
 for(const role of [0,1,2])for(const action of actions){
  assert.equal(ROLE_PERMISSIONS[role].includes('recipes.'+action),ROLE_PERMISSIONS[role].includes('usage.'+action));
  assert.deepEqual(getEffectivePermissions({role,custom_permissions:null}),getEffectivePermissions({role}));
 }
 assert.deepEqual(ROLE_PERMISSIONS[3],['all']);
});

test('recipes-only users cannot reach any /api/usage controller or historical/stock mutation',async t=>{
 const express=require('express'),app=express();let permissions=['recipes.view','recipes.create','recipes.edit'];
 let controllerCalls=0,historicalCalls=0;
 const controllers=new Proxy({}, {get:()=>((_req,res)=>{controllerCalls++;res.json({unexpected:true});})});
 const filename=require.resolve('../routes/usage'),actual=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:id=>{
  if(id==='../controllers/usage/usage')return controllers;
  if(id==='../middleware/historicalOperations')return {
   rejectModeInput:(_req,_res,next)=>next(),
   historical:()=>((_req,res)=>{historicalCalls++;res.json({unexpected:true});}),
   blockHistorical:()=>{throw Error('Unexpected historical guard');},
  };
  return actual(id);
 }},{filename});
 app.use(express.json());app.use((req,_res,next)=>{req.user={role:3,company_id:'company',custom_permissions:permissions};next();});
 app.use('/api/usage',module.exports);app.use((e,_req,res,_next)=>res.status(e.status||500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const id='11111111-1111-4111-8111-111111111111',body={date:'2026-10-18',product_id:id,amount_used:1,unit:'L',lot_ids:[id]};
 const cases=[['GET',''],['GET','?includeDisabled=true'],['GET','/disabled'],['POST','',body],['PUT','/'+id,{amount_used:2}],['DELETE','/'+id],['PUT','/enable/'+id]];
 for(const assigned of [permissions,actions.map(a=>'recipes.'+a)]){
  permissions=assigned;
  for(const [method,path,data] of cases){
   const result=await fetch('http://127.0.0.1:'+server.address().port+'/api/usage'+path,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
   assert.equal(result.status,403,method+' '+path);
  }
 }
 assert.equal(controllerCalls,0);assert.equal(historicalCalls,0);
});

// QA only. No network, environment loading, migrations or production changes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../growsync-backend');
const findings=[];
function load(relative,overrides={}) {
 const file=path.join(root,relative),actual=createRequire(file),module={exports:{}};
 const sandbox={module,exports:module.exports,console:{log(){},error(){},warn(){}},Date,process,
  require:name=>Object.hasOwn(overrides,name)?overrides[name]:actual(name)};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});return module.exports;
}
function database({failDisable=false}={}) {
 const tables={products:[{id:'p',company_id:'c',name:'QA',enabled:true,unit:'kg',available_quantity:5,total_quantity:7,expiration_date:'2020-01-01'}],usage_records:[{id:'u',company_id:'c',product_id:'p',amount_used:2,unit:'kg',enabled:true}],usage_lots:[],lots:[{id:'l',company_id:'c',enabled:false}],users:[]};
 return {tables,from(table){let mode='select',payload,filters=[],single=false;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},update(v){mode='update';payload=v;return q;},insert(v){mode='insert';payload=v;return q;},delete(){mode='delete';return q;},then(resolve,reject){
   return Promise.resolve().then(()=>{let rows=tables[table].filter(r=>filters.every(f=>f(r)));
    if(mode==='update') {if(failDisable&&table==='usage_records'&&payload.enabled===false)return{data:null,error:new Error('QA simulated storage failure')};rows.forEach(r=>Object.assign(r,payload));}
    if(mode==='insert'){rows=(Array.isArray(payload)?payload:[payload]).map((r,i)=>({id:'new-'+tables[table].length+'-'+i,enabled:true,...r}));tables[table].push(...rows);}
    if(mode==='delete')tables[table]=tables[table].filter(r=>!rows.includes(r));
    return {data:single?structuredClone(rows[0]||null):structuredClone(rows),error:null};
   }).then(resolve,reject);
  }};return q;}};
}
async function invoke(fn,body={},id='u'){let status=200,result;const res={status(v){status=v;return this;},json(v){result=v;return v;}};
 await fn({user:{id:'actor',company_id:'c',role:3},params:{id},body,query:{},get:()=> 'qa-key'},res,e=>{throw e;});return{status,result};}
function controller(db){return load('controllers/usage/usage.js',{'../../db/supabaseClient':db,'../notifications':{createNotification:async()=>{}}});}
(async()=>{
 delete process.env.INVENTORY_V1_COMPANY_IDS;
 let db=database(),api=controller(db);
 const edit=await invoke(api.editUsage,{amount_used:20});
 findings.push({case:'LEGACY_EDIT_INSUFFICIENT',response:edit,statusAfter:{usage:db.tables.usage_records[0].amount_used,stock:db.tables.products[0].available_quantity},expected:'409 with usage=2 and stock=5 unchanged'});
 db=database({failDisable:true});api=controller(db);
 await invoke(api.disableUsage);await invoke(api.disableUsage);
 findings.push({case:'LEGACY_DISABLE_RETRY_AFTER_FAILURE',usageEnabled:db.tables.usage_records[0].enabled,stock:db.tables.products[0].available_quantity,expected:'failed requests leave stock=5'});
 db=database();api=controller(db);
 const create=await invoke(api.createUsage,{product_id:'p',unit:'kg',amount_used:1,lot_ids:['l'],date:'2026-09-14'});
 findings.push({case:'LEGACY_DISABLED_LOT_EXPIRED_PRODUCT',response:create,stock:db.tables.products[0].available_quantity,expected:'reject disabled lot and expired stock'});
 const checkRole=require(path.join(root,'middleware/checkRole.js'));
 const {getEffectivePermissions}=require(path.join(root,'constants/permissions.js'));
 const roles=[];
 for(const role of [0,1,2,3])for(const custom_permissions of [null,[]]){
  let allowed=false,status=200;checkRole(1)({user:{role,custom_permissions}},{status(s){status=s;return this;},json(){}},()=>{allowed=true;});
  roles.push({role,custom_permissions,usageRouteAllows:allowed,status,effectivePermissions:getEffectivePermissions({role,custom_permissions})});
 }
 findings.push({case:'ROLE_VS_PERMISSIONS',roles});
 let harvestControllerReached=false;
 const fakeHarvest=new Proxy({}, {get:()=>((req,res)=>{harvestControllerReached=true;res.json({reached:true});})});
 const pass=(req,res,next)=>next();
 const harvestRouter=load('routes/harvestRecords.js',{'../controllers/harvestRecords':fakeHarvest,'../middleware/checkJwt':pass,'../middleware/userData':pass});
 const postHarvest=harvestRouter.stack.find(layer=>layer.route?.path==='/'&&layer.route.methods.post).route.stack;
 let step=0;const next=()=>{const handler=postHarvest[step++];if(handler)handler.handle({user:{role:0,company_id:'c',custom_permissions:[]}}, {json(){}}, next);};next();
 findings.push({case:'HARVEST_EMPLOYEE_NO_PERMISSION_REACHES_CREATE',controllerReached:harvestControllerReached,expected:false,note:'authenticated identity injected; actual route middleware chain, controller stub; no writes'});
 // Simulated interleaving: completion commits between cancellation's read and write.
 let planning={id:'plan',status:'en_progreso',enabled:true},snapshot;
 const client={release(){},async query(sql){
  if(sql.startsWith('SELECT id, status, enabled FROM planning')){snapshot={...planning};planning.status='completado';return{rows:[snapshot]};}
  if(sql.includes('SET enabled = false')){planning.status='cancelado';planning.enabled=false;}
  return{rows:[]};
 }};
 const planningApi=load('controllers/planning.js',{'../db/supabaseClient':{pool:{connect:async()=>client}},'./notifications':{createNotification:async()=>{}}});
 const cancel=await invoke(planningApi.remove,{},'plan');
 findings.push({case:'CANCEL_AFTER_CONCURRENT_COMPLETION_SIMULATION',response:cancel,planning,expected:'completion remains completed; cancellation rejects'});
 const vehicleSchema=require(path.join(root,'validations/vehicle.schema.js'));
 findings.push({case:'VEHICLE_BOOLEAN_QUERY',input:'false',parsed:vehicleSchema.listQuery.parse({query:{includeDisabled:'false'}}).query.includeDisabled,expected:false});
 const express=require(path.join(root,'node_modules/express'));
 const parsedRequest=Object.create(express.request);parsedRequest.app=express();parsedRequest.url='/?includeDisabled=false';parsedRequest.body={};parsedRequest.params={};
 let validationError;
 await require(path.join(root,'middleware/validate.js'))(vehicleSchema.listQuery)(parsedRequest,{},e=>{validationError=e;});
 findings.push({case:'EXPRESS5_QUERY_REINJECTION',query:parsedRequest.query,actualType:typeof parsedRequest.query.includeDisabled,error:validationError?.message,expected:'parsed query reaches controller as boolean'});
 parsedRequest.url='/disabled';parsedRequest.query.onlyDisabled=true;
 findings.push({case:'EXPRESS5_DISABLED_ROUTE_FLAG',query:parsedRequest.query,flag:parsedRequest.query.onlyDisabled??null,expected:'onlyDisabled=true reaches list controller'});
 const vehicleCalls=[];
 const vehicles=load('controllers/vehicle.js',{'../db/supabaseClient':{pool:{query:async(sql,args)=>{vehicleCalls.push({sql,args});return{rows:[{id:'v'}]};}}},'./notifications':{createNotification:async()=>{}}});
 const vehicle=await invoke(vehicles.create,{name:'QA',responsible_user:'00000000-0000-0000-0000-000000000002',created_by:'00000000-0000-0000-0000-000000000003'});
 findings.push({case:'VEHICLE_UNVERIFIED_USER_REFERENCES',response:vehicle,queries:vehicleCalls.length,passedResponsible:vehicleCalls[0].args[8],passedAuthor:vehicleCalls[0].args[9],expected:'validate responsible belongs to tenant; author comes from session'});
 fs.writeFileSync(path.join(__dirname,'probes-results.json'),JSON.stringify(findings,null,2));
 console.log(JSON.stringify(findings,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

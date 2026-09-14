const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module');
const {getEffectivePermissions} = require('../constants/permissions');
function load(relative, overrides={}) {
  const file=path.resolve(__dirname,'..',relative), actual=createRequire(file), module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,console,
    require:id=>Object.hasOwn(overrides,id)?overrides[id]:actual(id)},{filename:file});
  return module.exports;
}
const pass=(_req,_res,next)=>next();
const controllers=new Proxy({}, {get:()=>((_req,res)=>{res.reached=true;res.json({ok:true});})});
const routers={};
for(const [file,controller] of [['harvestRecords','harvestRecords'],['usage','usage/usage'],['vehicle','vehicle'],['planning','planning']]) {
  routers[file]=load(`routes/${file}.js`,{
    [`../controllers/${controller}`]:controllers, '../controllers/vehicleFuel':controllers,
    '../middleware/checkJwt':pass, '../middleware/userData':pass, '../middleware/validate':()=>pass,
  });
}
function invoke(file, method, url, user, query={}) {
  const stack=routers[file].stack.find(layer=>layer.route?.path===url&&layer.route.methods[method]).route.stack;
  const res={code:200,reached:false,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  const req={user,query};let i=0;const next=()=>{if(i<stack.length) stack[i++].handle(req,res,next);};next();return res;
}
const routes=[
  ...['/stats/filters','/stats/summary','/stats/by-crop','/stats/by-campaign','/','/:id'].map(url=>['harvestRecords','get',url,['harvest.view']]),
  ['harvestRecords','get','/disabled',['harvest.view_disabled']],
  ['harvestRecords','post','/',['harvest.create']],['harvestRecords','put','/:id',['harvest.edit']],
  ['harvestRecords','patch','/:id/disable',['harvest.disable']],['harvestRecords','patch','/:id/enable',['harvest.enable']],
  ['harvestRecords','get','/context',['harvest.create']],['harvestRecords','post','/cycles/:assignmentId/finalize',['harvest.edit']],
  ...[['get','/','view'],['get','/disabled','view_disabled'],['post','/','create'],['put','/:id','edit'],['delete','/:id','disable'],['put','/enable/:id','enable']]
    .map(([m,u,p])=>['usage',m,u,[`usage.${p}`]]),
  ...[['get','/','view'],['get','/:id','view'],['get','/disabled','view_disabled'],['post','/','create'],['patch','/:id','edit'],['delete','/:id','disable'],['put','/enable/:id','enable']]
    .map(([m,u,p])=>['vehicle',m,u,[`vehicles.${p}`]]),
  ...[['get','/','view'],['get','/:id','view'],['get','/disabled','view_disabled'],['post','/','create'],['patch','/:id','edit'],['post','/:id/complete-work','edit'],['post','/:id/complete-sowing','edit']]
    .map(([m,u,p])=>['planning',m,u,[`planning.${p}`]]),
  ['planning','put','/enable/:id',['planning.edit','planning.enable']],
  ['planning','delete','/:id',['planning.edit','planning.disable']],
  ['planning','post','/register-completed',['planning.create','planning.edit']],
];
for(const [file,method,url,permissions] of routes) {
  test(`Q03 ${file} ${method.toUpperCase()} ${url}: role/custom permission matrix`,t=>{
    for(const role of [0,1,2,3]) {
      const denied=invoke(file,method,url,{role,custom_permissions:[]});
      assert.equal(denied.code,403);assert.equal(denied.reached,false);
      const granted=invoke(file,method,url,{role,custom_permissions:permissions});
      assert.equal(granted.reached,true,'custom permission must override base role');
      const defaults=invoke(file,method,url,{role});
      const actual=getEffectivePermissions({role});
      assert.equal(defaults.reached,actual.includes('all')||permissions.every(p=>actual.includes(p)));
    }
    if(file==='harvestRecords'&&method==='post'&&url==='/') {
      const denied=invoke(file,method,url,{role:0,custom_permissions:[]});
      t.diagnostic(JSON.stringify({case:'HARVEST_EMPLOYEE_NO_PERMISSION_REACHES_CREATE',status:denied.code,controllerReached:denied.reached}));
    }
  });
}
test('Q03 harvest context also accepts edit alone',()=>{
  assert.equal(invoke('harvestRecords','get','/context',{role:0,custom_permissions:['harvest.edit']}).reached,true);
});
for(const [file,prefix,query] of [['harvestRecords','harvest',{includeDisabled:'true'}],['harvestRecords','harvest',{onlyDisabled:'true'}],
  ['usage','usage',{includeDisabled:'true'}],['planning','planning',{includeDisabled:'true'}],['vehicle','vehicles',{includeDisabled:'true'}]]) {
  test(`Q03 ${file} ${JSON.stringify(query)} cannot bypass view_disabled`,()=>{
    const user={role:0,custom_permissions:[`${prefix}.view`]};
    assert.equal(invoke(file,'get','/',user,query).code,403);
    user.custom_permissions.push(`${prefix}.view_disabled`);
    assert.equal(invoke(file,'get','/',user,query).reached,true);
  });
}
test('Q03 tenant middleware rejects missing/invalid company without reaching private routes',()=>{
  const requireTenant=require('../middleware/requireTenant');
  for(const company_id of [undefined,'invalid']){
    let reached=false;const res={status(code){this.code=code;return this;},json(){}};
    requireTenant({user:{company_id}},res,()=>{reached=true;});assert.equal(res.code,403);assert.equal(reached,false);
  }
});
test('Q03 harvest mutations scope the locked record to the authenticated company',async()=>{
  const calls=[];const client={release(){},async query(sql,args){calls.push({sql,args});return {rows:[]};}};
  const ctrl=load('controllers/harvestRecords.js',{'../db/supabaseClient':{pool:{connect:async()=>client}}});
  for(const method of ['updateHarvestRecord','disableHarvestRecord','enableHarvestRecord']){
    calls.length=0;let error;
    await ctrl[method]({user:{company_id:'company-A'},params:{id:'record-company-B'},body:{}},{},e=>{error=e;});
    assert.equal(error.status,404);
    const read=calls.find(c=>c.sql.includes('FROM harvest_records'));
    assert.match(read.sql,/company_id = \$2/);assert.deepEqual(Array.from(read.args),['record-company-B','company-A']);
    assert.equal(calls.some(c=>/UPDATE|INSERT|DELETE/.test(c.sql.replace('FOR UPDATE',''))),false);
    assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
  }
});

for (const [file,method,prefix] of [['harvestRecords','getHarvestRecordById','harvest'],['vehicle','getOne','vehicles'],['planning','getOne','planning']]) {
  test(`Q03 ${file}: disabled detail requires view_disabled and foreign record returns 404`,async()=>{
    let rows=[{id:'record',enabled:false,products:[]}];
    const pool={query:async()=>({rows})};
    const ctrl=load(`controllers/${file}.js`,{'../db/supabaseClient':{pool},'./notifications':{createNotification:async()=>{}}});
    const req={user:{company_id:'company',role:0,custom_permissions:[`${prefix}.view`]},params:{id:'record'}};
    const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;}});
    let res=response();await ctrl[method](req,res,e=>{throw e;});assert.equal(res.code,403);
    req.user.custom_permissions.push(`${prefix}.view_disabled`);
    res=response();await ctrl[method](req,res,e=>{throw e;});assert.equal(res.code,200);assert.equal(res.body.id,'record');
    rows=[];res=response();await ctrl[method](req,res,e=>{throw e;});assert.equal(res.code,404);
  });
}

// Real routes and userData, synthetic Supabase and JWT identity. No DB client or credentials loaded.
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
function load(file,overrides){const filename=path.resolve(__dirname,'..',file),actual=createRequire(filename),module={exports:{}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:name=>Object.hasOwn(overrides,name)?overrides[name]:actual(name)},{filename});return module.exports;}
async function fixture(t){
 const employee={id:'self',company_id:'one',full_name:null,email:'employee@example.test',role:0,enabled:true,auth0_id:'auth0|self',custom_permissions:[]};
 const rows=[employee,{...employee,id:'colleague',auth0_id:'auth0|colleague'},{...employee,id:'foreign',company_id:'two',auth0_id:'auth0|foreign'},{...employee,id:'disabled',enabled:false,auth0_id:'auth0|disabled'}];
 const initial=structuredClone(rows),writes=[];
 const client={from(table){assert.equal(table,'users');const filters=[];let columns,changes;
  return {select(value){columns=value;return this;},eq(key,value){filters.push([key,value]);return this;},update(value){changes=value;return this;},async maybeSingle(){
   const row=rows.find(row=>filters.every(([key,value])=>row[key]===value));
   if(changes){writes.push({filters:structuredClone(filters),changes:structuredClone(changes)});if(row)Object.assign(row,changes);}
   if(!row)return {data:null};
   if(columns.includes('companies(name)')){assert.equal(columns,'id,full_name,email,role,enabled,company_id,companies(name)');return {data:{...row,companies:{name:row.company_id==='one'?'Empresa Uno':'Empresa Dos'}}};}
   return {data:Object.fromEntries(columns.split(',').map(key=>[key.trim(),row[key.trim()]]))};
  }};
 }};
 const jwt=(req,res,next)=>{if(!req.headers['x-test-sub'])return res.sendStatus(401);req.auth={sub:req.headers['x-test-sub']};next();};
 const userData=load('middleware/userData.js',{'../db/supabaseClient':client}),unused=()=>{throw Error('Unexpected administrative controller');};
 const router=load('routes/userRoutes.js',{'../db/supabaseClient':client,'../middleware/checkJwt':jwt,'../middleware/userData':userData,'../controllers/users/updateRole':unused,'../controllers/users/updatePermissions':unused,'../controllers/auth/inviteUser':unused});
 const app=express();app.use(express.json());app.use('/api/users',router);app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const send=(method='GET',body,suffix=method==='GET'?'/me':'/me/profile',actor=employee)=>fetch('http://127.0.0.1:'+server.address().port+'/api/users'+suffix,{method,headers:{'Content-Type':'application/json',...(actor?{'x-test-sub':actor.auth0_id}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {rows,initial,writes,send};
}
test('GET own profile exposes exactly the public fields and own company; null names remain compatible',async t=>{
 const x=await fixture(t),r=await x.send();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),{id:'self',full_name:null,email:'employee@example.test',role:0,enabled:true,company_id:'one',company_name:'Empresa Uno'});assert.equal(x.writes.length,0);
 const foreign=await x.send('GET',undefined,'/me',x.rows[2]);assert.equal((await foreign.json()).company_name,'Empresa Dos');
});
for(const name of ['Rocío Airasca','María José López','Juan Pérez',"Ana O'Connor",'García-López','José María del Valle','Iñaki Muñoz','Juan','李明'])test('employee updates own full_name only, preserving real name: '+name,async t=>{
 const x=await fixture(t),r=await x.send('PATCH',{full_name:'  '+name+'  '});assert.equal(r.status,200);assert.equal((await r.json()).full_name,name);assert.deepEqual(x.rows,[{...x.initial[0],full_name:name},...x.initial.slice(1)]);assert.deepEqual(x.writes[0].changes,{full_name:name});assert.deepEqual(x.writes[0].filters,[['id','self'],['company_id','one'],['enabled',true]]);assert.equal((await (await x.send()).json()).full_name,name);
});
for(const body of [{},{full_name:''},{full_name:'   '},{full_name:'a'},{full_name:'a'.repeat(101)},{full_name:42},{full_name:null},{full_name:'Ana\nOtra'},[],null])test('invalid profile name is rejected: '+JSON.stringify(body),async t=>{
 const x=await fixture(t),r=await x.send('PATCH',body);assert.equal(r.status,400);assert.deepEqual(x.rows,x.initial);assert.equal(x.writes.length,0);
});
for(const key of ['role','company_id','email','custom_permissions','enabled','auth0_id','id','user_id'])test('strict whitelist rejects '+key+' without any mutation',async t=>{
 const x=await fixture(t),r=await x.send('PATCH',{full_name:'Nombre permitido',[key]:'foreign'});assert.equal(r.status,400);assert.match((await r.json()).message,/Solo podés modificar/);assert.deepEqual(x.rows,x.initial);assert.equal(x.writes.length,0);
});
test('query and path cannot target another user or tenant; disabled/anonymous users cannot access profile',async t=>{
 const x=await fixture(t);
 for(const method of ['GET','PATCH']){
  const body=method==='PATCH'?{full_name:'Otro nombre'}:undefined,base=method==='GET'?'/me':'/me/profile';
  for(const query of ['user_id=foreign','id=colleague','company_id=two'])assert.equal((await x.send(method,body,base+'?'+query)).status,400);
  assert.equal((await x.send(method,body,base,null)).status,401);assert.equal((await x.send(method,body,base,x.rows[3])).status,403);
 }
 assert.equal((await x.send('PATCH',{full_name:'Otro'},'/foreign/profile')).status,404);assert.deepEqual(x.rows,x.initial);assert.equal(x.writes.length,0);
});

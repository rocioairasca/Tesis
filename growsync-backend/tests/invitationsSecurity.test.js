// Real HTTP routes, validators and permission guards. DB/Auth0 doubles only; no .env or real services.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path'), vm = require('node:vm'), express = require('express');

function load(file, overrides, logs) {
  const filename = path.resolve(__dirname,'..',file), actual = createRequire(filename), module = {exports:{}};
  vm.runInNewContext(readFileSync(filename,'utf8'), {
    module,exports:module.exports,process:{env:{FRONTEND_URL:'https://frontend.example.invalid',
      AUTH0_DOMAIN:'auth.example.invalid',AUTH0_M2M_CLIENT_ID:'synthetic',AUTH0_M2M_CLIENT_SECRET:'synthetic'}},
    console:{error:(...args)=>logs.push(args)},
    require:name=>Object.hasOwn(overrides,name)?overrides[name]:actual(name),
  },{filename});
  return module.exports;
}
async function fixture(t) {
  const company=randomUUID(), otherCompany=randomUUID(), users=[], invitations=[], writes=[], logs=[], authCalls=[];
  const faults={};
  const db={from(table){
    assert.ok(['users','invitations'].includes(table));
    const store=table==='users'?users:invitations, filters=[];
    let inserted, updated, columns;
    const q={
      select(value){columns=value;return q;},
      insert(value){inserted=Array.isArray(value)?value:[value];return q;},
      update(value){updated=value;return q;},
      eq(key,value){filters.push(row=>row[key]===value);return q;},
      gt(key,value){filters.push(row=>row[key]>value);return q;},
      in(key,values){filters.push(row=>values.includes(row[key]));return q;},
      async execute(single){
        let result;
        if(inserted){
          if(faults.insert && table==='invitations')return {data:null,error:{code:'23505',details:inserted[0].token}};
          result=inserted.map(row=>({id:randomUUID(),...row,...(row.expires_at?{expires_at:new Date(row.expires_at).toISOString()}:{}),created_at:new Date().toISOString()}));
          store.push(...result);writes.push({table,rows:structuredClone(result)});
        } else {
          result=store.filter(row=>filters.every(filter=>filter(row)));
          if(updated){result.forEach(row=>Object.assign(row,updated));writes.push({table,updated});}
        }
        if(columns?.includes('companies(name)'))result=result.map(row=>({...row,companies:{name:'Synthetic company'}}));
        return {data:single?structuredClone(result[0]||null):structuredClone(result),error:null};
      },
      single(){return q.execute(true);},maybeSingle(){return q.execute(true);},
      then(resolve,reject){return q.execute(false).then(resolve,reject);},
    };
    return q;
  }};
  const overrides={'../../db/supabaseClient':db,axios:{
    async post(url,payload){authCalls.push({url,payload});return {data:url.endsWith('/oauth/token')?{access_token:'synthetic'}:{user_id:'auth0|'+randomUUID()}};},
    async delete(){},
  },'../../controllers/notifications':{createNotification:async()=>{}}};
  const invite=load('controllers/auth/inviteUser.js',overrides,logs);
  const register=load('controllers/auth/registerUser.js',overrides,logs);
  const getInvitation=load('controllers/auth/getInvitation.js',overrides,logs);
  const jwt=(req,res,next)=>{
    const id=req.headers.authorization?.replace(/^Bearer /,'');
    const actor=users.find(row=>row.id===id && row.enabled);
    if(!actor)return res.sendStatus(401);
    req.auth={sub:actor.id};next();
  };
  const userData=(req,res,next)=>{req.user=users.find(row=>row.id===req.auth.sub);next();};
  const unused=()=>{throw Error('Out of scope controller');};
  const router=load('routes/userRoutes.js',{'../db/supabaseClient':db,'../middleware/checkJwt':jwt,
    '../middleware/userData':userData,'../controllers/users/updateRole':unused,
    '../controllers/users/updatePermissions':unused,'../controllers/auth/inviteUser':invite},logs);
  const auth=load('routes/auth.js',{'../controllers/auth/registerUser':register,
    '../controllers/auth/loginUser':unused,'../controllers/auth/getInvitation':getInvitation},logs);
  const app=express();app.use(express.json());
  app.use('/api/users',jwt,userData,require('../middleware/requireTenant'),router);
  app.use('/api',auth);
  app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.error||'Error',details:error.details}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port;
  const actor=(role,custom_permissions)=>{
    const user={id:randomUUID(),company_id:company,role,enabled:true,...(custom_permissions===undefined?{}:{custom_permissions})};
    users.push(user);return user;
  };
  async function request(route,body,user,method=body===undefined?'GET':'POST') {
    const res=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.id}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:res.status,data:await res.json().catch(()=>null),headers:res.headers};
  }
  const seed=(patch={})=>{const row={id:randomUUID(),email:randomUUID()+'@example.invalid',token:randomBytes(32).toString('hex'),
    company_id:company,role:0,used:false,expires_at:new Date(Date.now()+86400000).toISOString(),...patch};invitations.push(row);return row;};
  return {company,otherCompany,users,invitations,writes,logs,authCalls,faults,actor,request,seed,invite,register};
}
const body=role=>({email:' Guest@Example.Invalid ',role});

test('direct HTTP: roles 0/1/2 without invite permission and role 3 with custom denial cannot issue tokens',async t=>{
  const f=await fixture(t);
  for(const role of [0,1,2])for(const custom of [undefined,[]]){
    const response=await f.request('/api/users/invite',body(0),f.actor(role,custom));
    assert.equal(response.status,403);assert.equal(JSON.stringify(response.data).includes('inviteLink'),false);
  }
  assert.equal((await f.request('/api/users/invite',body(0),f.actor(3,[]))).status,403);
  assert.equal((await f.request('/api/users/invite',body(0))).status,401);
  const noCompany=f.actor(3);noCompany.company_id=null;
  assert.equal((await f.request('/api/users/invite',body(0),noCompany)).status,403);
  assert.equal(f.invitations.length,0);
});

test('effective permission plus role ceiling: complete actor 0..3 and target 0..3 matrix',async t=>{
  const f=await fixture(t);
  for(const actorRole of [0,1,2,3]) {
    const actor=f.actor(actorRole,actorRole===3?undefined:['users.invite']);
    for(const target of [0,1,2,3]) {
      const before=f.invitations.length;
      const response=await f.request('/api/users/invite',body(target),actor);
      const allowed=target<=2 && target<=actorRole;
      assert.equal(response.status,allowed?201:target===3?400:403,`${actorRole} -> ${target}`);
      assert.equal(f.invitations.length,before+(allowed?1:0));
      if(allowed){
        const saved=f.invitations.at(-1);
        assert.equal(saved.role,target);assert.equal(saved.company_id,f.company);assert.equal(saved.email,'guest@example.invalid');
        assert.match(saved.token,/^[0-9a-f]{64}$/);assert.equal(saved.used,false);
        const ttl=Date.parse(saved.expires_at)-Date.now();assert.ok(ttl>7*86400000-10000 && ttl<=7*86400000);
        assert.equal(response.headers.get('cache-control'),'no-store');
      }
    }
  }
  // all grants permission, but never bypasses the actor ceiling.
  assert.equal((await f.request('/api/users/invite',body(2),f.actor(1,['all']))).status,403);
});

test('strict invite schema rejects missing/coerced roles and every server-owned field',async t=>{
  const f=await fixture(t),admin=f.actor(3);
  for(const role of [-1,3,4,'superadmin','1',null,undefined,1.5,true,{},[]])
    assert.equal((await f.request('/api/users/invite',body(role),admin)).status,400,JSON.stringify(role));
  for(const [field,value] of Object.entries({company_id:f.otherCompany,custom_permissions:['all'],enabled:true,
    used:false,token:'attacker',expires_at:'2099-01-01',auth0_id:'auth0|attacker',id:randomUUID(),created_at:'now',unexpected:'field'}))
    assert.equal((await f.request('/api/users/invite',{...body(0),[field]:value},admin)).status,400,field);
  for(const email of ['invalid',null,123])assert.equal((await f.request('/api/users/invite',{email,role:0},admin)).status,400);
  assert.equal(f.invitations.length,0);
});

test('controller defense uses effective permissions, validates body and never logs invitation secrets',async t=>{
  const f=await fixture(t);
  const response=()=>({status(code){this.code=code;return this;},set(){return this;},json(data){this.data=data;return this;}});
  for(const [actor,requestBody,expected] of [[f.actor(2),body(0),403],[f.actor(3),body(3),400],
    [f.actor(1,['users.invite']),body(2),403],[f.actor(3),{...body(0),company_id:f.otherCompany},400]]) {
    const res=response();await f.invite({user:actor,body:requestBody},res);assert.equal(res.code,expected);
  }
  f.faults.insert=true;
  const failed=await f.request('/api/users/invite',body(0),f.actor(3));assert.equal(failed.status,500);
  assert.equal(/\b[0-9a-f]{64}\b/.test(JSON.stringify(f.logs)),false);
});

test('register uses stored role/company, rejects body overrides and normalizes email',async t=>{
  const f=await fixture(t);
  for(const role of [0,1,2]) {
    const invite=f.seed({role});
    const payload={email:invite.email.toUpperCase(),password:'synthetic-password',token:invite.token};
    for(const extra of [{role:3},{company_id:f.otherCompany},{custom_permissions:['all']},{enabled:true}])
      assert.equal((await f.request('/api/register',{...payload,...extra})).status,400);
    const result=await f.request('/api/register',payload);
    assert.equal(result.status,201);assert.equal(result.data.user.role,role);assert.equal(result.data.user.company_id,invite.company_id);
    assert.equal(result.data.user.email,invite.email);assert.equal(result.data.user.custom_permissions,undefined);
    assert.equal(invite.used,true);assert.equal(result.headers.get('cache-control'),'no-store');
    assert.equal((await f.request('/api/register',payload)).status,403);
    assert.equal((await f.request('/api/invitations/'+invite.token)).status,404);
  }
  // Even a direct controller invocation cannot replace role/company using request fields.
  const invite=f.seed({role:1});
  const res={status(code){this.code=code;return this;},set(){return this;},json(data){this.data=data;return this;}};
  await f.register({body:{email:invite.email,password:'synthetic-password',token:invite.token,role:3,company_id:f.otherCompany,custom_permissions:['all']}},res);
  assert.equal(res.code,201);assert.equal(res.data.user.role,1);assert.equal(res.data.user.company_id,invite.company_id);
});

test('used, expired, missing-company and dangerous legacy role invitations fail before Auth0',async t=>{
  const f=await fixture(t);
  for(const patch of [{used:true},{expires_at:new Date(Date.now()-1000).toISOString()},
    {role:3},{role:4},{role:-1},{role:null},{role:'1'},{company_id:null}]) {
    const invite=f.seed(patch);
    assert.equal((await f.request('/api/invitations/'+invite.token)).status,404);
    assert.equal((await f.request('/api/register',{email:invite.email,password:'synthetic-password',token:invite.token})).status,403);
  }
  assert.equal(f.authCalls.length,0);assert.equal(f.users.length,0);
  const valid=f.seed();
  assert.equal((await f.request('/api/register',{email:'different@example.invalid',password:'synthetic-password',token:valid.token})).status,400);
  assert.equal(f.authCalls.length,0);
});

test('public invitation preview is no-store, omits token and server fields, and cannot issue invitations',async t=>{
  const f=await fixture(t),invite=f.seed({role:2});
  const result=await f.request('/api/invitations/'+invite.token);
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.deepEqual(Object.keys(result.data).sort(),['companyName','email','expiresAt','role']);
  assert.equal(JSON.stringify(result.data).includes(invite.token),false);
  assert.equal(JSON.stringify(f.logs).includes(invite.token),false);
});

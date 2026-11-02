// Real Socket.IO + the unchanged Express checkJwt + real RS256 verification.
// JWKS, users, companies and persistence are local synthetic fixtures; no Auth0/DB calls.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {generateKeyPairSync,sign}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const path=require('node:path'),vm=require('node:vm');
const {io:clientIO}=require('../../grow-sync/node_modules/socket.io-client');
const {createNotificationServer,userRoom}=require('../socket');
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
const companyA='11111111-1111-4111-8111-111111111111',companyB='22222222-2222-4222-8222-222222222222';
let jwks,uri;
before(async()=>{
 jwks=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));});
 await new Promise(resolve=>jwks.listen(0,'127.0.0.1',resolve));
 uri='http://127.0.0.1:'+jwks.address().port+'/.well-known/jwks.json';
});
after(()=>new Promise(resolve=>jwks.close(resolve)));
function token(sub='auth0|a',extra={},key=privateKey,algorithm='RS256'){
 const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const body=enc({alg:algorithm,kid:'test-key',typ:'JWT'})+'.'+enc({
  sub,iss:'https://auth.fixture/',aud:'growsync.fixture',exp:Math.floor(Date.now()/1000)+300,...extra,
 });
 return body+'.'+sign('RSA-SHA256',Buffer.from(body),key).toString('base64url');
}
function load(file,overrides,globals={}){
 const filename=path.resolve(__dirname,'..',file),actual=createRequire(filename),module={exports:{}};
 vm.runInNewContext(readFileSync(filename,'utf8'),{module,exports:module.exports,console,...globals,
  require:id=>Object.hasOwn(overrides,id)?overrides[id]:actual(id)},{filename});
 return module.exports;
}
function verifier(){
 const real=require('jwks-rsa');
 return load('middleware/checkJwt.js',{
  dotenv:{config(){}},
  'jwks-rsa':{expressJwtSecret(options){
   assert.equal(options.jwksUri,'https://auth.fixture/.well-known/jwks.json');
   return real.expressJwtSecret({...options,jwksUri:uri});
  }},
 },{process:{env:{AUTH0_DOMAIN:'auth.fixture',AUTH0_API_AUDIENCE:'growsync.fixture'}}});
}
async function fixture(t,options={}){
 const users=[
  {id:'a',auth0_id:'auth0|a',enabled:true,company_id:companyA},
  {id:'b',auth0_sub:'auth0|b',enabled:true,company_id:companyB},
 ];
 const companies=new Set([companyA,companyB]);
 let failure=false;
 const db={from(table){const filters=[];return {
  select(){return this;},eq(k,v){filters.push([k,v]);return this;},
  async maybeSingle(){
   if(failure)return {error:{message:'synthetic failure'}};
   const rows=table==='users'?users:[...companies].map(id=>({id}));
   return {data:rows.find(row=>filters.every(([k,v])=>row[k]===v))||null};
  },
 };}};
 const http=createServer(),channel=createNotificationServer(http,{checkJwt:verifier(),db,...options});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const clients=[];
 const connect=(credential,extra={})=>{
  const client=clientIO('http://127.0.0.1:'+http.address().port,{autoConnect:false,reconnection:false,transports:['websocket'],auth:{...(credential?{token:credential}:{}),...extra}});
  clients.push(client);return client;
 };
 t.after(async()=>{clients.forEach(c=>c.disconnect());await new Promise(resolve=>channel.io.close(resolve));});
 return {...channel,users,companies,connect,fail:()=>{failure=true;}};
}
function event(socket,name){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{socket.off(name,done);reject(Error('Timed out waiting for '+name));},4000);
 function done(value){clearTimeout(timer);resolve(value);}
 socket.once(name,done);
});}
async function accepted(socket){const ready=event(socket,'connect');socket.connect();await ready;return socket;}
async function rejected(socket){const ready=event(socket,'connect_error');socket.connect();const error=await ready;
 assert.equal(error.data.code,'SOCKET_UNAUTHORIZED');assert.equal(socket.connected,false);}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('valid JWT uses server identity and namespaced room; client identity/tenant ignored',async t=>{
 const f=await fixture(t),credential=token(),a=await accepted(f.connect(credential,{userId:'b',company_id:companyB,sub:'auth0|b'}));
 const server=f.io.sockets.sockets.get(a.id);
 assert.deepEqual(server.data,{userId:'a',companyId:companyA,subject:'auth0|a',expiresAt:JSON.parse(Buffer.from(credential.split('.')[1],'base64url')).exp*1000});
 assert.deepEqual([...server.rooms].sort(),[a.id,userRoom('a')].sort());
 assert.deepEqual(server.handshake.auth,{});
});
test('missing, malformed, expired, wrong signature, issuer, audience, algorithm and future nbf rejected',async t=>{
 const f=await fixture(t),other=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
 for(const credential of [null,'invalid',token('auth0|a',{exp:1}),token('auth0|a',{},other),
  token('auth0|a',{iss:'https://other.fixture/'}),token('auth0|a',{aud:'other'}),
  token('auth0|a',{},privateKey,'HS256'),token('auth0|a',{nbf:Math.floor(Date.now()/1000)+60}),
  token('auth0|a',{exp:null}),token('',{})])await rejected(f.connect(credential));
});
test('unknown or disabled user rejected; email cannot link another identity',async t=>{
 const f=await fixture(t);
 await rejected(f.connect(token('auth0|missing',{email:'a@example.test'})));
 f.users[0].enabled=false;await rejected(f.connect(token()));
});
test('missing, malformed and nonexistent company rejected',async t=>{
 const f=await fixture(t);
 for(const company_id of [null,'invalid','33333333-3333-4333-8333-333333333333']){
  f.users[0].company_id=company_id;await rejected(f.connect(token()));
 }
});
test('A receives its unchanged persisted notification; B cannot subscribe via join_room',async t=>{
 const f=await fixture(t);f.users[1].company_id=companyA;
 const a=await accepted(f.connect(token())),b=await accepted(f.connect(token('auth0|b')));
 const stolen=[];b.on('new_notification',n=>stolen.push(n));
 b.emit('join_room','a');b.emit('join_room',userRoom('a'));await pause(30);
 assert.equal(f.io.sockets.sockets.get(b.id).rooms.has(userRoom('a')),false);
 const controller=load('controllers/notifications.js',{
  '../socket':{emitNotification:f.emitNotification},
  '../db/supabaseClient':{from(table){assert.equal(table,'notifications');return {
   insert(rows){return {select(){return {single:async()=>({data:{...rows[0],id:'notification',read:false}})};}};}
  };}},
 });
 const received=event(a,'new_notification');
 const saved=await controller.createNotification('a','low_stock','high','Stock bajo','Producto con stock bajo.',{product_id:'product'},companyA);
 assert.deepEqual(await received,JSON.parse(JSON.stringify(saved)));await pause(30);assert.deepEqual(stolen,[]);
});
test('multiple legitimate sockets of same user receive the event',async t=>{
 const f=await fixture(t),a=await accepted(f.connect(token())),a2=await accepted(f.connect(token()));
 const arrivals=[event(a,'new_notification'),event(a2,'new_notification')];
 await f.emitNotification({id:'n',user_id:'a',company_id:companyA});
 assert.equal((await Promise.all(arrivals)).length,2);
});
test('transport reconnect reauthenticates; disabled user cannot reconnect',async t=>{
 const f=await fixture(t),a=await accepted(f.connect(token()));
 a.disconnect();await accepted(a);assert.ok(f.io.sockets.sockets.get(a.id).rooms.has(userRoom('a')));
 a.disconnect();f.users[0].enabled=false;await rejected(a);
});
test('connected socket is disconnected at JWT expiration',async t=>{
 const f=await fixture(t),a=await accepted(f.connect(token('auth0|a',{exp:Math.floor(Date.now()/1000)+2})));
 assert.equal(await event(a,'disconnect'),'io server disconnect');
});
for(const change of ['disabled','moved','companyRemoved','subjectChanged','dbError'])test('before emission fail closed: '+change,async t=>{
 const f=await fixture(t),a=await accepted(f.connect(token())),received=[];
 a.on('new_notification',n=>received.push(n));
 if(change==='disabled')f.users[0].enabled=false;
 if(change==='moved')f.users[0].company_id=companyB;
 if(change==='companyRemoved')f.companies.delete(companyA);
 if(change==='subjectChanged')f.users[0].auth0_id='auth0|other';
 if(change==='dbError')f.fail();
 const disconnected=event(a,'disconnect');
 await f.emitNotification({id:'n',user_id:'a',company_id:companyA});
 await disconnected;assert.deepEqual(received,[]);
});
test('idle sockets revalidate enabled user without waiting for an event',async t=>{
 const f=await fixture(t,{revalidateMs:30}),a=await accepted(f.connect(token()));
 f.users[0].enabled=false;await event(a,'disconnect');
});
test('foreign-company notification is not delivered to a currently authorized user',async t=>{
 const f=await fixture(t),a=await accepted(f.connect(token())),received=[];
 a.on('new_notification',n=>received.push(n));
 await f.emitNotification({id:'n',user_id:'a',company_id:companyB});await pause(30);
 assert.deepEqual(received,[]);assert.equal(a.connected,true);
});

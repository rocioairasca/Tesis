import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startNotificationSocket,usableSocketToken} from '../src/services/notificationSocket.mjs';
const token=(sub='auth0|a',exp=Math.floor(Date.now()/1000)+600)=>
 'header.'+Buffer.from(JSON.stringify({sub,exp})).toString('base64url')+'.signature';
function fixture(initial=token()){
 let credential=initial,tick,cleared=false;
 const sockets=[],received=[],events=new EventTarget();
 const stop=startNotificationSocket({
  origin:'http://fixture.invalid',getToken:()=>credential,events,
  setIntervalFn:fn=>{tick=fn;return 1;},clearIntervalFn:()=>{cleared=true;},
  onNotification:n=>received.push(n),
  io(origin,options){
   assert.equal(origin,'http://fixture.invalid');assert.equal(options.autoConnect,false);
   const listeners=new Map();
   const socket={options,listeners,connects:0,disconnects:0,handshakes:[],
    on(name,fn){assert.equal(listeners.has(name),false);listeners.set(name,fn);},
    removeAllListeners(){listeners.clear();},
    disconnect(){this.disconnects++;},
    connect(){this.connects++;options.auth(value=>this.handshakes.push(value));},
    fire(name,value){listeners.get(name)?.(value);},
   };
   sockets.push(socket);return socket;
  },
 });
 return {sockets,received,events,tick:()=>tick(),setToken:value=>{credential=value;},stop,isCleared:()=>cleared};
}
test('no session, malformed or expired token never creates a socket',()=>{
 for(const initial of [null,'invalid',token('auth0|a',1)]){
  const f=fixture(initial);assert.equal(f.sockets.length,0);f.tick();assert.equal(f.sockets.length,0);f.stop();
 }
 assert.equal(usableSocketToken(token()),true);
});
test('current token in handshake, no user identity/room emission; existing event callback',()=>{
 const credential=token(),f=fixture(credential),s=f.sockets[0];
 assert.deepEqual(s.handshakes,[{token:credential}]);
 assert.equal(s.connects,1);
 s.fire('new_notification',{id:'n'});assert.deepEqual(f.received,[{id:'n'}]);f.stop();
});
test('cleanup removes listeners, disconnects and cancels monitoring',()=>{
 const f=fixture(),s=f.sockets[0];f.stop();
 assert.equal(f.isCleared(),true);assert.equal(s.listeners.size,0);assert.equal(s.disconnects,1);
 s.fire('new_notification',{id:'late'});assert.deepEqual(f.received,[]);
});
test('late handshake or synchronization after cleanup cannot create a connection',()=>{
 const f=fixture(),s=f.sockets[0],auth=s.options.auth;f.stop();f.tick();
 f.events.dispatchEvent(new Event('focus'));let credentials;auth(value=>{credentials=value;});
 assert.deepEqual(credentials,{});assert.equal(f.sockets.length,1);assert.equal(s.connects,1);
});
test('transport reconnection reads latest token without installing duplicate listeners',()=>{
 const f=fixture(),s=f.sockets[0],next=token('auth0|b');
 s.fire('connect_error',new Error('network unavailable'));
 s.fire('disconnect','transport close');
 f.tick();assert.equal(f.sockets.length,1);
 f.setToken(next);let credentials;s.options.auth(value=>{credentials=value;});
 assert.deepEqual(credentials,{token:next});
 assert.equal(s.listeners.size,3);
 f.tick();assert.equal(f.sockets.length,2);assert.equal(s.listeners.size,0);
 assert.equal(f.sockets[1].listeners.size,3);f.stop();
});
test('logout removes socket in same tab, cross-tab storage and unmount',()=>{
 for(const trigger of ['tick','storage','unmount']){
  const f=fixture(),s=f.sockets[0];f.setToken(null);
  if(trigger==='tick')f.tick();else if(trigger==='storage')f.events.dispatchEvent(new Event('storage'));else f.stop();
  assert.equal(s.disconnects,1);assert.equal(s.listeners.size,0);f.stop();
 }
});
test('expired session and notifications racing with logout do not reach UI',()=>{
 const f=fixture(),s=f.sockets[0];f.setToken(token('auth0|a',1));s.fire('new_notification',{id:'late'});
 assert.deepEqual(f.received,[]);assert.equal(s.disconnects,1);f.stop();
});
test('authentication rejection/server revocation stops retry until token changes',()=>{
 for(const failure of ['connect_error','disconnect']){
  const f=fixture(),s=f.sockets[0];
  s.fire(failure,failure==='connect_error'?{data:{code:'SOCKET_UNAUTHORIZED'}}:'io server disconnect');
  f.tick();f.events.dispatchEvent(new Event('focus'));assert.equal(f.sockets.length,1);
  f.setToken(token('auth0|a',Math.floor(Date.now()/1000)+900));f.tick();
  assert.equal(f.sockets.length,2);assert.equal(f.sockets[1].connects,1);f.stop();
 }
});
test('StrictMode-style mount cleanup remount leaves only the live lifecycle listeners',()=>{
 const first=fixture();first.stop();const next=fixture();
 assert.equal(first.sockets[0].listeners.size,0);assert.equal(next.sockets[0].listeners.size,3);
 first.tick();assert.equal(first.sockets.length,1);next.stop();
});
test('provider wires cleanup and preserves visual notification behavior without identity lookup',()=>{
 const source=readFileSync(new URL('../src/context/NotificationsContext.jsx',import.meta.url),'utf8');
 assert.match(source,/useEffect\(\(\) => startNotificationSocket\(/);
 assert.doesNotMatch(source,/join_room|getUserDataByEmail/);
 assert.match(source,/antNotification.info/);assert.match(source,/duration: 4/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentLocation, GEOLOCATION_OPTIONS } from '../src/utils/geolocation.mjs';
const position = { coords: { latitude: -32.4, longitude: -63.2, accuracy: 120 }, timestamp: 12345 };
test('location: success, browser cache options and metadata', async () => {
  let options;
  const result = await getCurrentLocation({ secureContext: true, permissions: { query: async () => ({state:'granted'}) }, geolocation: { getCurrentPosition(ok, bad, opts) { options=opts; ok(position); } } });
  assert.deepEqual(result, {latitude:-32.4,longitude:-63.2,accuracy:120,obtainedAt:12345});assert.deepEqual(options,GEOLOCATION_OPTIONS);
});
test('location: prompt and unsupported Permissions API still use geolocation', async () => {
  for (const permissions of [{query:async()=>({state:'prompt'})},{query:async()=>{throw Error('unsupported');}},{}]) {
    assert.equal((await getCurrentLocation({permissions,geolocation:{getCurrentPosition:ok=>ok(position)}})).latitude,-32.4);
  }
});
test('location: denied permission never calls position provider', async () => {
  await assert.rejects(getCurrentLocation({permissions:{query:async()=>({state:'denied'})},geolocation:{getCurrentPosition:()=>assert.fail('must not ask again')}}),{code:'permission_denied'});
});
test('location: typed native errors, unavailable browser and insecure context', async () => {
  for(const [code,expected] of [[1,'permission_denied'],[2,'position_unavailable'],[3,'timeout']]) await assert.rejects(getCurrentLocation({permissions:{},geolocation:{getCurrentPosition:(ok,bad)=>bad({code})}}),{code:expected});
  await assert.rejects(getCurrentLocation({geolocation:null}),{code:'unsupported'});
  await assert.rejects(getCurrentLocation({secureContext:false,geolocation:{getCurrentPosition:()=>assert.fail()}}),{code:'unsupported'});
  await assert.rejects(getCurrentLocation({permissions:{},geolocation:{getCurrentPosition:ok=>ok({coords:{latitude:91,longitude:0}})}}),{code:'position_unavailable'});
});
test('location: deadline, cancellation, late responses and controlled subsequent request', async () => {
  let calls=0;const geolocation={getCurrentPosition:ok=>{if(calls++>0)ok(position);}};
  await assert.rejects(getCurrentLocation({geolocation,permissions:{},options:{timeout:5}}),{code:'timeout'});
  assert.equal((await getCurrentLocation({geolocation,permissions:{}})).longitude,-63.2);assert.equal(calls,2);
  const controller=new AbortController();let callback;
  const request=getCurrentLocation({signal:controller.signal,permissions:{},geolocation:{getCurrentPosition:ok=>{callback=ok;}}});
  await Promise.resolve();await Promise.resolve();controller.abort();await assert.rejects(request,{name:'AbortError'});callback?.(position);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { saveRegistrationToken, registrationHeaders, clearRegistrationToken, activeRegistrationReference } from '../src/services/registrationSession.mjs';

function storage(t) {
  const data = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{
    getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),
  }});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'sessionStorage',previous);else delete globalThis.sessionStorage;});
  return data;
}

test('token is bound to provider/reference and kept only in sessionStorage',t=>{
  const data = storage(t), token = 'a'.repeat(64);
  saveRegistrationToken('mercadopago','ref-a',token);
  assert.equal(activeRegistrationReference(),'ref-a');
  assert.deepEqual(registrationHeaders('mercadopago','ref-a'),{'X-Registration-Token':token,'X-Registration-Reference':'ref-a'});
  assert.throws(()=>registrationHeaders('simulated','ref-a'));
  assert.throws(()=>registrationHeaders('mercadopago','ref-b'));
  assert.equal([...data.values()].filter(value=>value===token).length,1);
  clearRegistrationToken('mercadopago','ref-a');
  assert.equal(activeRegistrationReference(),null);
  assert.throws(()=>registrationHeaders('mercadopago','ref-a'));
});

test('missing storage or malformed secrets fail closed before checkout can be shown',t=>{
  storage(t);
  assert.throws(()=>saveRegistrationToken('mercadopago','ref','short'));
  assert.throws(()=>saveRegistrationToken('mercadopago','ref',null));
  assert.throws(()=>registrationHeaders('mercadopago',null));
});

test('public flow never places the private token in persistent storage or URL construction',()=>{
  const session = readFileSync(new URL('../src/services/registrationSession.mjs',import.meta.url),'utf8');
  assert.equal(session.includes('localStorage'),false);
  for(const file of ['paymentSimulation.jsx','paymentSuccess.jsx','registerCompany.jsx']) {
    const source = readFileSync(new URL('../src/features/public/'+file,import.meta.url),'utf8');
    assert.equal(source.includes('registrationToken'),false,'components never receive the secret: '+file);
    assert.doesNotMatch(source,/console\.(?:log|error)\([^;]*(?:requestError|\berror\b|\bresult\b)/s);
  }
});

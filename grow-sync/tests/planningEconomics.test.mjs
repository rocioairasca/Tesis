import {test} from 'node:test';
import assert from 'node:assert/strict';
import {laborPayload,executionEconomicPayload,requiresBeneficiary,economicReadPermissions,economicEditPermissions} from '../src/features/planning/planningEconomics.mjs';
const planning={field_context:'growing_crop',crop_id:'corn',lots:[{lot_id:'a'},{lot_id:'b',sub_lot_id:'s'}]};
test('growing crop can retain beneficiary; ambiguous contexts require explicit beneficiary',()=>{
 assert.equal(requiresBeneficiary(planning),false);
 for(const field_context of ['stubble','fallow','pre_sowing','other',null]) {
  const p={...planning,field_context};assert(requiresBeneficiary(p));
  assert.throws(()=>executionEconomicPayload(p,{},true),/beneficiario/);
  const result=executionEconomicPayload(p,{economicTargets:['soy','soy']},false);
  assert.deepEqual(result.targets,[{lot_id:'a',sub_lot_id:null,beneficiary_crop_id:'soy'},{lot_id:'b',sub_lot_id:'s',beneficiary_crop_id:'soy'}]);
 }
});
test('USD payload retains strings and drops irrelevant stale ARS fields',()=>{
 assert.deepEqual(laborPayload({status:'confirmed',currency:'USD',rate_original:'6,125',fx_rate:'1000',fx_date:'2026-11-05',fx_source:'old'}),
  {status:'confirmed',currency:'USD',rate_original:'6.125'});
});
test('ARS FX and payment evidence preserved; pending remains pending',()=>{
 const body={status:'pending',currency:'ARS',rate_original:'6000',fx_rate:'1000',fx_date:'2026-11-05',payment_date:'2026-11-05',fx_source:'Manual'};
 assert.deepEqual(laborPayload(body),body);
 assert.deepEqual(laborPayload({...body,status:'confirmed'}),{...body,status:'confirmed'});
});
test('no labor editing without economic edit permissions; operational target still submitted',()=>{
 const r=executionEconomicPayload(planning,{economicLabor:{status:'confirmed',currency:'USD',rate_original:'6'}},false);
 assert.equal(r.labor,undefined);assert.equal(r.targets.length,2);
 assert.deepEqual(economicReadPermissions,['planning.view','inventory.view']);
 assert.deepEqual(economicEditPermissions,['planning.view','inventory.view','planning.edit','inventory.edit']);
});
test('revision keep and not-applicable do not leak stale form prices',()=>{
 assert.equal(laborPayload({status:'unchanged',rate_original:'6'}),undefined);
 assert.deepEqual(laborPayload({status:'not_applicable',rate_original:'6'}),{status:'not_applicable'});
});

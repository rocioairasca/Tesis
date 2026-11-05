import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const money=createRequire(import.meta.url)('../../shared/costEstimate.cjs');
const estimate={status:'complete',area_ha:'93.000000',known_products_cost_usd:'1699.040000'};
test('local labor uses exact rate × operative area and total / ha',()=>{
  const r=money.simulateLabor(estimate,'6');
  assert.equal(r.labor_usd,'558.000000');assert.equal(r.total_usd,'2257.040000');
  assert.equal(r.per_ha_display,'USD 24,27');
});
test('blank labor is explicitly excluded; zero is a valid entered rate',()=>{
  assert.equal(money.simulateLabor(estimate,'').labor_usd,null);
  assert.equal(money.simulateLabor(estimate,'0').labor_usd,'0.000000');
});
test('partial/unavailable estimates never return a complete total or per-ha figure',()=>{
  for(const status of ['partial','unavailable']){
    const r=money.simulateLabor({...estimate,status},'6');
    assert.equal(r.total_usd,null);assert.equal(r.per_ha_display,null);
    assert.equal(r.known_total_usd,'2257.040000');
  }
});
test('missing/zero area disables labor and per-ha without losing products',()=>{
  for(const area_ha of [null,'0']){
    assert.equal(money.simulateLabor({...estimate,area_ha},'').per_ha_display,null);
    assert.throws(()=>money.simulateLabor({...estimate,area_ha},'6'));
  }
});
test('monetary input precision, comma and invalid values',()=>{
  assert.equal(money.simulateLabor(estimate,'6,125').labor_usd,'569.625000');
  for(const rate of ['-1','NaN','1e2','0.1234567','100000000000000'])assert.throws(()=>money.simulateLabor(estimate,rate));
});
test('sum exact products before display rounding and calculate per-ha from exact total',()=>{
  const a=money.productCost('0.000001','0.5'),b=money.productCost('0.000001','0.5');
  assert.equal(money.costText(a+b),'0.000001');
  assert.equal(money.formatUsd('0.005'),'USD 0,01');
  const r=money.simulateLabor({status:'complete',area_ha:'0.01',known_products_cost_usd:'0.0049'},'');
  assert.equal(money.formatUsd(r.total_usd),'USD 0,00');
  assert.equal(r.per_ha_display,'USD 0,49');
});
test('large amounts format without IEEE-754 conversion or lost cents',()=>{
  assert.equal(money.formatUsd('99999999999999.995'),'USD 100.000.000.000.000,00');
  assert.equal(money.formatUsd(null),'—');
});

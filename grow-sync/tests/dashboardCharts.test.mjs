import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yieldChartRows, campaignChartRows } from '../src/features/dashboard/chartPresentation.mjs';
test('Charts: rendimiento del servidor sin reconversión ni promedio; ausencia de área no es cero', () => {
  const input = [{crop:'trigo',area_ha:10,yield_kg_ha:8.27,production_kg:99},{crop:'Trigo',area_ha:0,yield_kg_ha:0},{crop:'Maíz',area_ha:null,yield_kg_ha:23}];
  const result = yieldChartRows(input);
  assert.deepEqual(result.map(row=>row.chartYield),[8.27,null,null]);
  assert.deepEqual(result.map(row=>row.crop),['trigo','Trigo','Maíz']);
  assert.equal(input[0].chartYield,undefined);
});
test('Charts: orden temporal por fechas; nombres libres y valores intactos', () => {
  const input=[{campaign_id:'b',campaign_name:'Especial',campaign_start_date:'2026-10-01',production_kg:7},{campaign_id:'a',campaign_name:'Gruesa',campaign_start_date:'2025-10-01',production_kg:8}];
  const result=campaignChartRows(input);
  assert.equal(result.chronological,true); assert.deepEqual(result.rows.map(row=>row.production_kg),[8,7]);
  assert.deepEqual(result.rows.map(row=>[row.campaign_id,row.campaign]),[['a','Gruesa'],['b','Especial']]);
  assert.equal(input[0].campaign,undefined);
  const unknown=[{campaign:'2026/27'},{campaign:'2024/25'}];
  assert.equal(campaignChartRows(unknown).chronological,false); assert.deepEqual(campaignChartRows(unknown).rows,unknown);
  assert.equal(campaignChartRows([{campaign:'2025/29'}]).chronological,false);
});

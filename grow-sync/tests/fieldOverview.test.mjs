import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldOverview } from '../src/features/dashboard/fieldOverview.mjs';
import { fixtureLots } from './lotsOverview.fixtures.mjs';
test('MiniFieldMap: activos, áreas de padres sin doble conteo, divisiones vigentes y geometrías faltantes', () => {
  const before = JSON.stringify(fixtureLots);
  const result = fieldOverview(fixtureLots);
  assert.equal(result.lots, 3); assert.equal(result.divisions, 2);
  assert.ok(Math.abs(result.area - 71.96) < 1e-8);
  assert.equal(result.geometries.length, 2); assert.equal(result.missing, 1);
  assert.equal(JSON.stringify(fixtureLots), before);
  assert.equal(fieldOverview([{id:'unknown',enabled:true}]).area, null);
  assert.equal(fieldOverview([{...fixtureLots[0],active_layout:{...fixtureLots[0].active_layout,status:'draft'}}]).divisions, 0);
  assert.deepEqual(fieldOverview([]),{lots:0,area:0,divisions:0,geometries:[],missing:0});
});

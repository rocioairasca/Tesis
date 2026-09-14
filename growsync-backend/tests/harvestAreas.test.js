const { test } = require('node:test');
const assert = require('node:assert/strict');
const { areaCents, areaValue, cycleBalance, validateManualClosure } = require('../services/harvestAreas');
const { allocate } = require('../services/harvestCycles');

test('hectares round to hundredths, including decimal ties; invalid values fail', () => {
  for (const [input, expected] of [['68.2926', '68.29'], ['25.0181', '25.02'], ['1.005', '1.01'], ['0.005', '0.01']]) {
    assert.equal(areaValue(areaCents(input)), expected);
  }
  for (const value of [null, '', 'NaN', Infinity, -1]) assert.throws(() => areaCents(value));
});

test('20 + 30 + 18.29 closes 68.29; partial journeys stay open', () => {
  const entries = [];
  for (const [area, date, remaining] of [['20', '2026-06-10', 4829], ['30', '2026-06-15', 1829], ['18.29', '2026-06-20', 0]]) {
    entries.push({ harvested_area_ha: area, harvest_date: date, enabled: true });
    const balance = cycleBalance('68.29', entries);
    assert.equal(balance.remaining, remaining);
    assert.equal(balance.endDate, remaining ? null : '2026-06-20');
  }
});

test('out-of-order entries close on the chronological last journey, disabled entries do not count', () => {
  const entries = ['2026-06-20', '2026-06-10', '2026-06-15'].map((date, index) => ({
    harvest_date: date, harvested_area_ha: ['20', '30', '18.29'][index], enabled: true,
  }));
  assert.equal(cycleBalance('68.29', entries).endDate, '2026-06-20');
  entries[1].enabled = false;
  assert.equal(cycleBalance('68.29', entries).remaining, 3000);
  assert.equal(cycleBalance('68.29', entries).endDate, null);
});

test('allocation rejects excess, duplicate IDs, ambiguous multi-cycle distribution and legacy closure', () => {
  const a = { id: 'a', remaining_area_ha: '18.29' };
  assert.throws(() => allocate([a], '20'), /pendiente/);
  assert.equal(allocate([a], '18.29')[0].harvested_area_ha, '18.29');
  assert.throws(() => allocate([a, { id: 'b', remaining_area_ha: '10' }], '20'), /varios ciclos/);
  assert.throws(() => allocate([a], '2', [{ crop_assignment_id: 'a', harvested_area_ha: '1' }, { crop_assignment_id: 'a', harvested_area_ha: '1' }]), /repetidos/);
  assert.throws(() => allocate([{ ...a, harvest_closure_source: 'legacy' }], '1'), /legacy/);
  assert.deepEqual(allocate([a, { id: 'b', remaining_area_ha: '10' }], '28.29').map((v) => v.harvested_area_ha), ['18.29', '10.00']);
});

test('manual finalization accepts weather, requires explanation for other', () => {
  validateManualClosure('weather', null);
  assert.throws(() => validateManualClosure('other', ' '));
  assert.throws(() => validateManualClosure('unknown', null));
  validateManualClosure('other', 'Detalle');
});

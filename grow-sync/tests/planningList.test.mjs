import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planningFilterKey, readPlanningFilters, readPlanningListState, updatePlanningPage, updatePlanningFilters, planningRequestParams, lastPlanningPage } from '../src/features/planning/planningFilters.mjs';

test('detail, pagination, view and unrelated parameters never change the filter identity', () => {
  const query = new URLSearchParams('mine=1&search=Trabajo&crop=maiz&from=2026-10-01&to=2026-10-31');
  const key = planningFilterKey(query);
  for (const [name, value] of [['planningId', 'detail'], ['page', '3'], ['pageSize', '16'], ['view', 'calendar'], ['other', 'value']]) {
    query.set(name, value); assert.equal(planningFilterKey(query), key);
  }
  query.delete('planningId'); assert.equal(planningFilterKey(query), key);
  query.set('status', 'pendiente'); assert.notEqual(planningFilterKey(query), key);
  query.delete('status'); query.set('search', 'Otro'); assert.notEqual(planningFilterKey(query), key);
});
test('functional aliases normalize to the same request; mine does not widen responsibility', () => {
  const a = new URLSearchParams('mine=true&responsible=other&crop=maiz&campaign=year&lot=field');
  const b = new URLSearchParams('mine=1&cropId=maiz&campaignId=year&lotSelectionKey=lot:field');
  assert.equal(planningFilterKey(a), planningFilterKey(b));
  assert.deepEqual(planningRequestParams(readPlanningFilters(b)), { mine: true, cropId: 'maiz', campaignId: 'year', lotId: 'field' });
  assert.deepEqual(planningRequestParams(readPlanningFilters(new URLSearchParams('subLotId=division&lotId=field'))), { subLotId: 'division' });
});
test('URL pagination is controlled, bounded, preserves filters/detail/view, and filter changes reset only page', () => {
  const original = new URLSearchParams('search=Trabajo&planningId=detail&view=calendar&page=3&pageSize=16');
  const next = updatePlanningPage(original, 2, 24);
  assert.deepEqual(readPlanningListState(next), { page: 2, pageSize: 24, view: 'calendar' });
  for (const key of ['search', 'planningId', 'view']) assert.equal(next.get(key), original.get(key));
  assert.deepEqual(readPlanningListState(updatePlanningFilters(original, 'status', 'pendiente')), { page: 1, pageSize: 16, view: 'calendar' });
  for (const invalid of ['0', '-1', 'abc', '1.5', 'Infinity', '9007199254740992']) {
    assert.deepEqual(readPlanningListState(new URLSearchParams({ page: invalid, pageSize: invalid })), { page: 1, pageSize: 8, view: 'table' });
  }
  assert.equal(readPlanningListState(new URLSearchParams('pageSize=2000')).pageSize, 1000);
  assert.equal(lastPlanningPage(45, 8), 6);
  assert.equal(lastPlanningPage(44, 11), 4);
  assert.equal(lastPlanningPage(0, 8), 1);
});

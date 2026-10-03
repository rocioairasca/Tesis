import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANNING_COLUMN_WIDTHS, PLANNING_TABLE_WIDTH, isCompactPlanningWidth } from '../src/features/planning/planningLayout.mjs';

test('compact layout follows the actual space required by unchanged readable columns', () => {
  assert.equal(PLANNING_TABLE_WIDTH, 1200);
  assert.equal(Object.keys(PLANNING_COLUMN_WIDTHS).length, 9);
  for (const width of [0, 300, 768, 1000, 1106, 1199.9]) assert.equal(isCompactPlanningWidth(width), true);
  for (const width of [1200, 1200.1, 1366, 1600]) assert.equal(isCompactPlanningWidth(width), false);
});

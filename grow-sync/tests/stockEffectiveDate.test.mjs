import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('Usage y completion no bloquean con saldo de hoy; register-completed delega al backend', () => {
  const usage = source('../src/features/usages/Usage.jsx');
  const planning = source('../src/features/planning/Planning.jsx');
  assert(!usage.includes('available={selectedProduct?.available_quantity}'));
  assert(usage.includes('según la fecha del uso'));
  assert(planning.includes('!registerCompleted && !isEditingHistorical'));
  assert(planning.includes('available={registerCompleted ? undefined : available}'));
  assert.match(planning, /unitName=\{\["actual_products"[\s\S]*?extra="El stock se valida al guardar según la fecha efectiva\."/);
  assert(!planning.includes('available={available} allowZero'));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const status = require('../services/stockInitialStatus');

test('registro público: empresa nueva tiene V1 y puede llegar a apertura sin configuración manual', async t => {
  const { fixture } = require('./publicRegistration.fixture');
  const f = await fixture(t, { NODE_ENV: 'test', ALLOW_SIMULATED_PAYMENTS: 'true' });
  const db = f.db;
  await db.exec(`CREATE TABLE stock_initial_openings(id uuid, company_id uuid, effective_date date, created_at timestamptz);
    CREATE TABLE stock_batches(company_id uuid); CREATE TABLE stock_movements(company_id uuid);`);
  const created = await f.request('POST', '/api/public/payments', { plan: 'basic', payment_method: 'qr' });
  assert.equal(created.status, 201);
  const paymentId = created.data.payment.id;
  assert.equal((await f.request('POST', `/api/public/payments/${paymentId}/confirm`, {})).status, 200);
  const result = await f.register({ paymentId });
  assert.equal(result.status, 201);
  const companyId = result.data.company.id;
  const actorId = (await db.query('SELECT id FROM users WHERE company_id=$1', [companyId])).rows[0].id;
  const pool = f.pool;
  const first = await status(pool, { companyId: companyId, actorId });
  assert.equal(first.inventory_v1_enabled, true);
  assert.deepEqual(first.blockers, ['CONTROL_DATE_MISSING']);
  assert.equal(first.can_prepare, false);
  await db.query('UPDATE companies SET inventory_control_start_date=$2 WHERE id=$1', [companyId, '2026-09-24']);
  const ready = await status(pool, { companyId, actorId });
  assert.equal(ready.can_prepare, true);
  assert.equal(ready.can_confirm, true);
  assert.deepEqual(ready.blockers, []);
});

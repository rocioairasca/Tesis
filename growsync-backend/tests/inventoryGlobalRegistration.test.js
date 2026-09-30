const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const status = require('../services/stockInitialStatus');

test('registro público: empresa nueva tiene V1 y puede llegar a apertura sin configuración manual', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE companies(id uuid PRIMARY KEY, name text, inventory_control_start_date date);
    CREATE TABLE users(id uuid, company_id uuid, enabled boolean, role integer, custom_permissions jsonb);
    CREATE TABLE stock_initial_openings(id uuid, company_id uuid, effective_date date, created_at timestamptz);
    CREATE TABLE stock_batches(company_id uuid); CREATE TABLE stock_movements(company_id uuid);`);
  const companyId = randomUUID(), actorId = randomUUID();
  // All registration dependencies are simulated: no payment, Auth0 or production DB calls.
  const fakeDb = {
    pool: null,
    from(table) {
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: table === 'payments' ? { status: 'approved' } : null }; },
        insert(value) {
          if (table === 'companies') return { select: () => ({ single: async () => {
            await db.query('INSERT INTO companies(id,name) VALUES($1,$2)', [companyId, value.name]);
            return { data: { id: companyId, name: value.name } };
          } }) };
          assert.equal(table, 'users');
          return db.query('INSERT INTO users VALUES($1,$2,$3,$4,NULL)', [actorId, value.company_id, value.enabled, value.role]).then(() => ({}));
        },
      };
    },
  };
  const mod = { exports: {} };
  const mocks = {
    '../db/supabaseClient': fakeDb,
    axios: { post: async url => ({ data: url.endsWith('/oauth/token') ? { access_token: 'synthetic' } : { user_id: 'auth0|synthetic' } }) },
    mercadopago: { Payment: class {} },
    '../src/config/mercadoPago': {},
    '../services/defaultCrops': {},
  };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../controllers/publicController.js'), 'utf8'), {
    exports: mod.exports, module: mod, process: { env: { AUTH0_DOMAIN: 'synthetic.invalid' } }, console,
    require(name) { assert.ok(Object.hasOwn(mocks, name), `Unmocked dependency: ${name}`); return mocks[name]; },
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await mod.exports.registerCompany({ body: { companyName: 'Synthetic', adminName: 'Admin', email: 'admin@example.test', password: 'synthetic-only', paymentId: 'synthetic' } }, res);
  assert.equal(res.code, 201);
  const pool = { connect: async () => ({ query: (sql, args) => db.query(sql, args), release() {} }) };
  const first = await status(pool, { companyId: res.body.company.id, actorId });
  assert.equal(first.inventory_v1_enabled, true);
  assert.deepEqual(first.blockers, ['CONTROL_DATE_MISSING']);
  assert.equal(first.can_prepare, false);
  await db.query('UPDATE companies SET inventory_control_start_date=$2 WHERE id=$1', [companyId, '2026-09-24']);
  const ready = await status(pool, { companyId, actorId });
  assert.equal(ready.can_prepare, true);
  assert.equal(ready.can_confirm, true);
  assert.deepEqual(ready.blockers, []);
});

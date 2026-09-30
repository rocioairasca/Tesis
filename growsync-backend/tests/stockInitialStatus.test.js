const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const status = require('../services/stockInitialStatus');

test('stock initial status: flags, counts, opening, isolation and authorization (disposable SQL)', async t => {
  const db = new PGlite();
  const oldFlag = process.env.INVENTORY_V1_COMPANY_IDS;
  t.after(async () => {
    if (oldFlag === undefined) delete process.env.INVENTORY_V1_COMPANY_IDS;
    else process.env.INVENTORY_V1_COMPANY_IDS = oldFlag;
    await db.close();
  });
  // Minimal disposable schema: no production client, env files or migrations.
  await db.exec(`
    CREATE TABLE companies(id text PRIMARY KEY, inventory_control_start_date date);
    CREATE TABLE users(id text, company_id text, enabled boolean, role integer, custom_permissions jsonb);
    CREATE TABLE stock_initial_openings(id uuid, company_id text, effective_date date, created_at timestamptz,
      payload jsonb, request_hash text, idempotency_key text);
    CREATE TABLE stock_batches(company_id text, available_quantity numeric, enabled boolean);
    CREATE TABLE stock_movements(company_id text);
    INSERT INTO companies VALUES ('a',NULL),('b','2026-09-24');
    INSERT INTO users VALUES ('actor','a',true,1,'["history.import"]'),('other','b',true,3,NULL);
  `);
  const queries = [];
  let released = 0;
  const pool = { async connect() { return {
    query(sql, args) { queries.push(sql); return db.query(sql, args); },
    release() { released++; },
  }; } };
  const get = () => status(pool, { companyId: 'a', actorId: 'actor' });
  process.env.INVENTORY_V1_COMPANY_IDS = 'a';
  await t.test('sin fecha, V1 activo, inventario vacío', async () => {
    assert.deepEqual(await get(), {
      inventory_control_start_date: null, inventory_v1_enabled: true,
      opening: { exists: false, id: null, effective_date: null, created_at: null },
      stock: { batches: 0, movements: 0 }, can_prepare: false, can_confirm: false,
      blockers: ['CONTROL_DATE_MISSING'],
    });
  });
  await db.exec("UPDATE companies SET inventory_control_start_date='2026-09-24' WHERE id='a'");
  await t.test('fecha configurada y V1 desactivado permite preparar', async () => {
    process.env.INVENTORY_V1_COMPANY_IDS = 'b';
    const result = await get();
    assert.equal(result.inventory_control_start_date, '2026-09-24');
    assert.equal(result.inventory_v1_enabled, false);
    assert.equal(result.can_prepare, true);
    assert.equal(result.can_confirm, false);
    assert.deepEqual(result.blockers, ['INVENTORY_V1_DISABLED']);
  });
  await t.test('V1 activo y vacío permite confirmar', async () => {
    process.env.INVENTORY_V1_COMPANY_IDS = ' b, a ';
    const result = await get();
    assert.equal(result.can_prepare, true); assert.equal(result.can_confirm, true);
    assert.deepEqual(result.blockers, []);
  });
  await t.test('datos de otra empresa no afectan conteos ni apertura', async () => {
    await db.exec(`INSERT INTO stock_batches VALUES ('b',0,false);
      INSERT INTO stock_movements VALUES ('b');
      INSERT INTO stock_initial_openings VALUES ('00000000-0000-0000-0000-000000000001','b','2026-09-24',now(),'{}','secret','secret');`);
    const result = await get();
    assert.deepEqual(result.stock, { batches: 0, movements: 0 });
    assert.equal(result.opening.exists, false); assert.equal(result.can_confirm, true);
    await assert.rejects(status(pool, { companyId: 'b', actorId: 'actor' }), { status: 403 });
  });
  await t.test('batch agotada y deshabilitada impide confirmar, no preparar', async () => {
    await db.exec("INSERT INTO stock_batches VALUES ('a',0,false)");
    const result = await get();
    assert.deepEqual(result.stock, { batches: 1, movements: 0 });
    assert.equal(result.can_prepare, true); assert.equal(result.can_confirm, false);
    assert.deepEqual(result.blockers, ['INVENTORY_NOT_EMPTY']);
    await db.exec("DELETE FROM stock_batches WHERE company_id='a'");
  });
  await t.test('movimiento sin batch impide confirmar', async () => {
    await db.exec("INSERT INTO stock_movements VALUES ('a')");
    const result = await get();
    assert.deepEqual(result.stock, { batches: 0, movements: 1 });
    assert.equal(result.can_confirm, false);
    assert.deepEqual(result.blockers, ['INVENTORY_NOT_EMPTY']);
  });
  await t.test('apertura existente y bloqueos acumulados, sin datos sensibles', async () => {
    await db.exec(`INSERT INTO stock_initial_openings VALUES ('00000000-0000-0000-0000-000000000002','a','2026-09-24','2026-09-24T12:00:00Z','{}','secret','secret');
      UPDATE companies SET inventory_control_start_date=NULL WHERE id='a'`);
    process.env.INVENTORY_V1_COMPANY_IDS = '';
    const result = await get();
    assert.deepEqual(JSON.parse(JSON.stringify(result.opening)), {
      exists: true, id: '00000000-0000-0000-0000-000000000002', effective_date: '2026-09-24', created_at: '2026-09-24T12:00:00.000Z',
    });
    assert.equal(result.can_prepare, false); assert.equal(result.can_confirm, false);
    assert.deepEqual(result.blockers, ['CONTROL_DATE_MISSING','INVENTORY_V1_DISABLED','OPENING_ALREADY_EXISTS','INVENTORY_NOT_EMPTY']);
    await db.exec("UPDATE companies SET inventory_control_start_date='2026-09-24' WHERE id='a'");
    assert.equal((await get()).can_prepare, false);
  });
  await t.test('permiso efectivo y usuario habilitado, con liberación de conexión', async () => {
    await db.exec("UPDATE users SET custom_permissions='[]' WHERE id='actor'");
    await assert.rejects(get(), { status: 403 });
    await db.exec("UPDATE users SET custom_permissions='[\"all\"]' WHERE id='actor'");
    await assert.doesNotReject(get());
    await db.exec("UPDATE users SET enabled=false WHERE id='actor'");
    const before = released;
    await assert.rejects(get(), { status: 403 });
    assert.equal(released, before + 1);
  });
  assert.ok(queries.every(sql => /^\s*SELECT\b/i.test(sql)), 'status only executes SELECT');
});

test('GET route inherits history.import and uses authenticated tenant only', async () => {
  const dbPath = require.resolve('../db/supabaseClient');
  const servicePath = require.resolve('../services/stockInitialStatus');
  const routePath = require.resolve('../routes/history');
  const saved = [dbPath, servicePath, routePath].map(p => require.cache[p]);
  let received;
  const pool = {};
  require.cache[dbPath] = { exports: { pool } };
  require.cache[servicePath] = { exports: async (p, args) => { assert.equal(p, pool); received = args; return { can_prepare: true }; } };
  delete require.cache[routePath];
  try {
    const router = require('../routes/history');
    const gate = router.stack[0].handle;
    for (const permissions of [[], ['inventory.view'], ['history.import'], ['all']]) {
      let allowed = false, code;
      gate({ user: { custom_permissions: permissions } }, { status(n) { code=n; return this; }, json() {} }, () => { allowed=true; });
      assert.equal(allowed, permissions.includes('history.import') || permissions.includes('all'));
      if (!allowed) assert.equal(code, 403);
    }
    const route = router.stack.find(layer => layer.route?.path === '/stock-initial/status').route;
    assert.equal(route.methods.get, true);
    const headers = {};
    let response;
    await route.stack[0].handle({ user: { company_id: 'a', id: 'actor' }, query: { company_id: 'b' }, body: { company_id: 'b' } },
      { set(k,v) { headers[k]=v; }, json(value) { response=value; } }, error => { throw error; });
    assert.deepEqual(received, { companyId: 'a', actorId: 'actor' });
    assert.deepEqual(response, { can_prepare: true });
    assert.equal(headers['Cache-Control'], 'no-store');
  } finally {
    [dbPath, servicePath, routePath].forEach((p,i) => { if (saved[i]) require.cache[p]=saved[i]; else delete require.cache[p]; });
  }
});

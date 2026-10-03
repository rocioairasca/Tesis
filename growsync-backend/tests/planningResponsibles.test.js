// Real route/authorization/userData, synthetic Supabase only. Never loads .env or the DB client.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

function load(file, overrides) {
  const filename = path.resolve(__dirname, '..', file), actual = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(readFileSync(filename, 'utf8'), { module, exports: module.exports, console,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : actual(name),
  }, { filename });
  return module.exports;
}
async function fixture(t) {
  const companyId = randomUUID(), otherCompanyId = randomUUID();
  const permissions = ['planning.view', 'planning.create', 'planning.edit'];
  const users = [0, 1, 2, 3].map(role => ({ id: randomUUID(), company_id: companyId,
    auth0_id: `auth0|test-${role}`, enabled: true, full_name: `Persona ${role}`, email: `p${role}@example.test`, role,
    custom_permissions: permissions,
  }));
  const disabled = { ...users[0], id: randomUUID(), enabled: false, auth0_id: 'auth0|disabled' };
  const foreign = { ...users[0], id: randomUUID(), company_id: otherCompanyId, auth0_id: 'auth0|foreign' };
  const onlyView = { ...users[0], id: randomUUID(), auth0_id: 'auth0|view', custom_permissions: ['planning.view'] };
  const data = [...users, disabled, foreign, onlyView];
  const supabase = { from(table) {
    assert.equal(table, 'users');
    const filters = []; let columns;
    const execute = () => data.filter(row => filters.every(([key, value]) => row[key] === value))
      .map(row => Object.fromEntries(columns.split(',').map(key => [key.trim(), row[key.trim()]])));
    return {
      select(value) { columns = value; return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      async maybeSingle() { return { data: execute()[0] || null }; },
      async order(key) { return { data: execute().sort((a, b) => a[key].localeCompare(b[key])) }; },
    };
  } };
  const checkJwt = (req, res, next) => {
    const sub = req.headers['x-test-sub'];
    if (!sub) return res.status(401).json({ message: 'Test authentication required' });
    req.auth = { sub }; next();
  };
  const userData = load('middleware/userData.js', { '../db/supabaseClient': supabase });
  const unused = () => { throw new Error('Unrelated controller must not execute'); };
  const router = load('routes/userRoutes.js', {
    '../db/supabaseClient': supabase, '../middleware/checkJwt': checkJwt, '../middleware/userData': userData,
    '../controllers/users/updateRole': unused, '../controllers/users/updatePermissions': unused,
    '../controllers/auth/inviteUser': unused,
  });
  const app = express();
  app.use('/api/users', checkJwt, userData, require('../middleware/requireTenant'), router);
  app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const get = (suffix, user) => fetch(`http://127.0.0.1:${server.address().port}/api/users${suffix}`, {
    headers: user ? { 'x-test-sub': user.auth0_id } : {},
  });
  return { users, disabled, foreign, onlyView, data, get };
}

test('non-Admins can list every enabled company colleague, including themselves, without users permissions', async t => {
  const x = await fixture(t);
  for (const actor of x.users.filter(user => user.role !== 3)) {
    const response = await x.get('/planning-responsibles?company_id=' + x.foreign.company_id + '&enabled=false', actor);
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.deepEqual(rows.map(row => row.id).sort(), [...x.users, x.onlyView].map(row => row.id).sort());
    assert.ok(rows.some(row => row.id === actor.id));
    assert.ok(!rows.some(row => [x.foreign.id, x.disabled.id].includes(row.id)));
    for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['email', 'full_name', 'id', 'role']);
    // The planning selector does not grant access to administrative user management.
    assert.equal((await x.get('/', actor)).status, 403);
  }
});
test('responsible lookup keeps authentication and planning-write permission checks', async t => {
  const x = await fixture(t);
  assert.equal((await x.get('/planning-responsibles')).status, 401);
  assert.equal((await x.get('/planning-responsibles', x.disabled)).status, 403);
  assert.equal((await x.get('/planning-responsibles', x.onlyView)).status, 403);
  for (const permission of ['planning.create', 'planning.edit']) {
    x.users[0].custom_permissions = [permission];
    assert.equal((await x.get('/planning-responsibles', x.users[0])).status, 200);
  }
});

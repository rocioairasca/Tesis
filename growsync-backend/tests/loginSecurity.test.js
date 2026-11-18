const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { configureHttpSecurity } = require('../middleware/httpSecurity');
const { createPublicRateLimits } = require('../middleware/publicRateLimits');

async function fixture(t) {
  const secrets = { password: 'synthetic-password', access_token: 'synthetic-access', id_token: 'synthetic-id',
    client_secret: 'synthetic-client-secret', mfa_token: 'synthetic-mfa' };
  const logs = [], calls = [], provider = { data: { access_token: secrets.access_token, id_token: secrets.id_token, expires_in: 3600, token_type: 'Bearer' } };
  const env = { AUTH0_DOMAIN: 'auth.example.invalid', AUTH0_API_AUDIENCE: 'api.example.invalid',
    AUTH0_CLIENT_ID: 'test-client', AUTH0_CLIENT_SECRET: secrets.client_secret, ADMIN_COMPANY_INVITATION_SECRET: 'test-admin' };
  function load(relative, overrides = {}) {
    const filename = path.resolve(__dirname, '..', relative), module = { exports: {} }, actual = createRequire(filename);
    vm.runInNewContext(readFileSync(filename, 'utf8'), {
      module, exports: module.exports, process: { env }, Buffer,
      console: { error: (...args) => logs.push(args) },
      require: name => Object.hasOwn(overrides, name) ? overrides[name] : actual(name),
    }, { filename });
    return module.exports;
  }
  const login = load('controllers/auth/loginUser.js', { axios: { async post(url, body, options) {
    calls.push({ url, body, options });
    if (provider.error) throw provider.error;
    return { data: provider.data };
  } } });
  const unused = () => { throw Error('Unexpected controller'); };
  const auth = load('routes/auth.js', { '../controllers/auth/loginUser': login,
    '../controllers/auth/registerUser': unused, '../controllers/auth/getInvitation': unused });
  const guard = load('middleware/requireAdminSecret.js');
  const app = express();
  configureHttpSecurity(app, { NODE_ENV: 'test' });
  app.use(express.json());
  app.use(createPublicRateLimits());
  app.use('/api', auth);
  app.post('/api/admin/company-invitations', guard, (_req, res) => res.json({ inviteLink: 'https://frontend.invalid/?token=synthetic' }));
  app.use(load('middleware/errorHandler.js'));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(body = { email: 'user@example.test', password: secrets.password }, path = '/api/login', headers = {}, rawBody) {
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: rawBody ?? JSON.stringify(body),
    });
  }
  return { request, provider, logs, calls, secrets, env };
}

test('successful login preserves the ROPG contract and token responses use no-store', async t => {
  const { request, calls, secrets } = await fixture(t);
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { access_token: secrets.access_token, id_token: secrets.id_token, token_type: 'Bearer', expires_in: 3600 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.grant_type, 'http://auth0.com/oauth/grant-type/password-realm');
  assert.equal(calls[0].body.password, secrets.password);
  assert.equal(calls[0].options.timeout, 10000);
});

for (const [code, status] of [['invalid_grant', 401], ['too_many_requests', 429], ['access_denied', 403], ['mfa_required', 403], ['unknown_provider_error', 500]]) {
  test(`login maps ${code} without public provider details or secret logs`, async t => {
    const { request, provider, logs, secrets } = await fixture(t);
    const description = JSON.stringify(secrets);
    provider.error = { code: 'ERR_BAD_RESPONSE', message: description,
      response: { status: 400, data: { error: code, error_description: description, mfa_token: secrets.mfa_token } } };
    const response = await request();
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.details, undefined);
    if (code === 'mfa_required') assert.equal(body.mfa_token, secrets.mfa_token);
    else assert.equal(body.mfa_token, undefined);
    if (status === 429) assert.equal(response.headers.get('retry-after'), '60');
    for (const [name, value] of Object.entries(secrets)) {
      assert.ok(!JSON.stringify(logs).includes(value), name);
      if (name !== 'mfa_token' || code !== 'mfa_required') assert.ok(!JSON.stringify(body).includes(value), name);
    }
  });
}

test('generic provider codes/messages cannot inject secrets into logs; useful safe status/code retained', async t => {
  const { request, provider, logs, secrets } = await fixture(t);
  provider.error = { message: secrets.password, response: { status: 502, data: { error: secrets.client_secret, error_description: secrets.access_token } } };
  assert.equal((await request()).status, 500);
  assert.equal(logs[0][1].code, 'provider_error');
  assert.equal(logs[0][1].status, 502);
  for (const value of Object.values(secrets)) assert.ok(!JSON.stringify(logs).includes(value));
  provider.error = { code: 'ECONNABORTED', message: secrets.password };
  assert.equal((await request()).status, 500);
  assert.equal(logs[1][1].code, 'ECONNABORTED');
});

test('provider HTTP 429 without known code remains 429', async t => {
  const { request, provider } = await fixture(t);
  provider.error = { response: { status: 429, data: {} } };
  const response = await request();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('validation, missing config and invalid provider success are generic and non-cacheable', async t => {
  const { request, provider, calls, env } = await fixture(t);
  const invalid = await request({ email: 'invalid', password: '' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0);
  provider.data = {};
  const empty = await request();
  assert.equal(empty.status, 502);
  assert.equal((await empty.json()).message, 'No se pudo iniciar sesión');
  delete env.AUTH0_CLIENT_SECRET;
  const missing = await request();
  assert.equal(missing.status, 500);
  assert.equal((await missing.json()).message, 'No se pudo iniciar sesión');
});

test('actual admin secret guard remains enforced and inviteLink response is no-store', async t => {
  const { request } = await fixture(t);
  const rejected = await request({}, '/api/admin/company-invitations');
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get('cache-control'), 'no-store');
  const accepted = await request({}, '/api/admin/company-invitations', { 'x-admin-secret': 'test-admin' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('cache-control'), 'no-store');
  assert.ok((await accepted.json()).inviteLink);
});


test('malformed login JSON cannot leak password fragments through the central error logger', async t => {
  const { request, logs, calls } = await fixture(t);
  const response = await request({}, '/api/login', {}, '{"password": sensitive-test-value}');
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0);
  assert.equal(logs[0][1].message, 'JSON inválido');
  assert.ok(!JSON.stringify(logs).includes('sensitive-'));
  assert.ok(!(await response.text()).includes('sensitive-'));
});

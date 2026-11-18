const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { MemoryStore } = require('express-rate-limit');
const { configureHttpSecurity, allowedOrigins, trustProxySetting } = require('../middleware/httpSecurity');
const { createPublicRateLimits, POLICIES, LIMITED_RESPONSE, loginKey } = require('../middleware/publicRateLimits');

async function fixture(t, { env = {}, overrides = {} } = {}) {
  const app = express(), keys = [], stores = [];
  configureHttpSecurity(app, { NODE_ENV: 'production', FRONTEND_URL: 'https://app.example.test', ...env });
  app.use(express.json());
  const policies = Object.fromEntries(Object.keys(POLICIES).map(key => [key, { limit: 2, windowMs: 60_000 }]));
  policies.loginIp.limit = 10;
  app.use(createPublicRateLimits({ policies: { ...policies, ...overrides }, storeFactory(name) {
    const store = new MemoryStore();
    const increment = store.increment.bind(store);
    store.increment = key => { keys.push({ name, key }); return increment(key); };
    stores.push(store);
    return store;
  } }));
  const reached = [];
  app.use((req, res) => {
    reached.push(req.path);
    if (req.path === '/api/admin/company-invitations' && req.get('x-admin-secret') !== 'test-secret') {
      return res.sendStatus(401);
    }
    res.json({ ok: true, ip: req.ip });
  });
  // No raw errors/body/URL logging in this fixture.
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: 'Solicitud rechazada' }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(async () => {
    stores.forEach(store => store.shutdown());
    await new Promise(resolve => server.close(resolve));
  });
  async function request(path, { method = 'POST', body = {}, headers = {}, rawBody } = {}) {
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers },
      ...(['GET', 'HEAD', 'OPTIONS'].includes(method) ? {} : { body: rawBody ?? JSON.stringify(body) }),
    });
  }
  return { request, keys, reached };
}

async function exhaust(request, path, options) {
  assert.equal((await request(path, options)).status, 200);
  assert.equal((await request(path, options)).status, 200);
  return request(path, options);
}

test('login: identity normalization, safe 429/Retry-After, password excluded and other identity works', async t => {
  const { request, keys } = await fixture(t);
  const password = 'never-log-or-key-this-password';
  assert.equal((await request('/api/login', { body: { email: ' Person@Example.test ', password } })).status, 200);
  assert.equal((await request('/api/login', { body: { email: 'person@example.test', password } })).status, 200);
  const blocked = await request('/api/login', { body: { email: 'PERSON@example.test', password: 'different' } });
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), LIMITED_RESPONSE);
  assert.match(blocked.headers.get('retry-after'), /^[1-9]\d*$/);
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  for (const name of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'ratelimit', 'ratelimit-policy']) {
    assert.equal(blocked.headers.get(name), null);
  }
  assert.equal((await request('/api/login', { body: { email: 'another@example.test', password } })).status, 200);
  assert.equal(new Set(keys.filter(x => x.name === 'loginIdentity').slice(0, 3).map(x => x.key)).size, 1);
  assert.ok(!JSON.stringify(keys).includes(password));
  assert.ok(!JSON.stringify(keys).includes('person@example.test'));
  assert.equal(loginKey({ ip: '192.0.2.1', body: { email: 'a@test', get password() { throw Error('Password accessed'); } } }),
    loginKey({ ip: '192.0.2.1', body: { email: 'A@test', password: 'ignored' } }));
});

test('login IP ceiling prevents rotating identities indefinitely', async t => {
  const { request } = await fixture(t, { overrides: { loginIp: { limit: 3, windowMs: 60_000 } } });
  for (let i = 0; i < 3; i++) assert.equal((await request('/api/login', { body: { email: `${i}@test` } })).status, 200);
  assert.equal((await request('/api/login', { body: { email: 'another@test' } })).status, 429);
});

test('independent register, company register, invitations, simulation and Mercado Pago budgets; private routes unaffected', async t => {
  const { request, keys } = await fixture(t);
  for (const [path, method] of [
    ['/api/register', 'POST'], ['/api/public/register-company', 'POST'],
    ['/api/invitations/sensitive-token', 'GET'], ['/api/public/payments', 'POST'],
    ['/api/public/payments/a', 'GET'], ['/api/public/payments/mercadopago/preference', 'POST'],
    ['/api/public/payments/mercadopago/reference/a', 'GET'],
  ]) {
    assert.equal((await exhaust(request, path, { method })).status, 429, path);
  }
  // Rotating tokens/payment IDs cannot reset the shared group counters.
  assert.equal((await request('/api/invitations/another-token', { method: 'GET' })).status, 429);
  assert.equal((await request('/api/public/payments/another/confirm')).status, 429);
  assert.equal((await request('/api/public/payments/mercadopago/payment/another', { method: 'GET' })).status, 429);
  assert.ok(!JSON.stringify(keys).includes('sensitive-token'));
  for (let i = 0; i < 5; i++) assert.equal((await request('/api/planning', { method: 'GET' })).status, 200);
  assert.equal((await request('/api/login', { body: { email: 'a@test' } })).status, 200);
});

test('admin limiter applies before secret verification and includes no-store on rejected responses', async t => {
  const { request, reached } = await fixture(t);
  for (let i = 0; i < 2; i++) {
    const response = await request('/api/admin/company-invitations');
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await request('/api/admin/company-invitations', { headers: { 'x-admin-secret': 'test-secret' } })).status, 429);
  assert.equal(reached.length, 2);
});

test('no-store covers all sensitive endpoints, malformed JSON, CORS errors and private invite responses', async t => {
  const { request } = await fixture(t);
  for (const path of ['/api/login', '/api/register', '/api/invitations/token', '/api/admin/company-invitations',
    '/api/public/payments', '/api/public/payments/mercadopago/preference', '/api/public/register-company', '/api/users/invite']) {
    const response = await request(path, { method: 'GET' });
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
  }
  const denied = await request('/api/login', { headers: { origin: 'https://evil.example' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  // Sending text as JSON reaches the parser error path before rate limiting.
  const malformed = await request('/api/login', { rawBody: '{"password":' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('cache-control'), 'no-store');
});

test('Helmet API headers, no CSP/COEP, HSTS production only', async t => {
  const { request } = await fixture(t);
  const headers = (await request('/api/health', { method: 'GET' })).headers;
  const expected = {
    'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'cross-origin', 'origin-agent-cluster': '?1',
    'x-dns-prefetch-control': 'off', 'x-download-options': 'noopen',
    'x-permitted-cross-domain-policies': 'none', 'x-xss-protection': '0',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(headers.get(name), value, name);
  for (const name of ['x-powered-by', 'content-security-policy', 'cross-origin-embedder-policy']) assert.equal(headers.get(name), null);
  const local = await fixture(t, { env: { NODE_ENV: 'development' } });
  assert.equal((await local.request('/api/health')).headers.get('strict-transport-security'), null);
});

test('CORS uses exact explicit origins in production, local origins only in development; preflight preserves token headers', async t => {
  assert.deepEqual(allowedOrigins({ NODE_ENV: 'production', FRONTEND_URL: 'https://app.example.test', CORS_ALLOWED_ORIGINS: 'https://extra.example.test' }),
    ['https://app.example.test', 'https://extra.example.test']);
  assert.ok(allowedOrigins({ NODE_ENV: 'development' }).includes('http://localhost:5173'));
  assert.ok(!allowedOrigins({ RENDER: 'true' }).includes('http://localhost:5173'));
  assert.throws(() => allowedOrigins({ CORS_ALLOWED_ORIGINS: '*' }));
  assert.throws(() => allowedOrigins({ FRONTEND_URL: 'https://app.example.test/path' }));
  const { request } = await fixture(t);
  for (const origin of ['http://localhost:5173', 'https://tesis-seven-phi.vercel.app', 'https://app.example.test.evil.test']) {
    assert.equal((await request('/api/login', { headers: { origin } })).status, 403);
  }
  const preflight = await request('/api/public/register-company', { method: 'OPTIONS', headers: {
    origin: 'https://app.example.test', 'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type,x-registration-token,x-registration-reference',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.test');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-registration-token/);
});

test('proxy trust is explicit and bounded: direct mode ignores XFF, one-hop mode ignores spoofed leftmost IP', async t => {
  assert.equal(trustProxySetting({}), false);
  assert.throws(() => trustProxySetting({ RENDER: 'true' }), /TRUST_PROXY_HOPS/);
  assert.throws(() => trustProxySetting({ RENDER: 'true', TRUST_PROXY_HOPS: '0' }), /TRUST_PROXY_HOPS/);
  assert.equal(trustProxySetting({ RENDER: 'true', TRUST_PROXY_HOPS: '1' }), 1);
  for (const value of ['true', 'false', '-1', '6', '1.5']) assert.throws(() => trustProxySetting({ TRUST_PROXY_HOPS: value }));
  const direct = await fixture(t);
  const directResponse = await direct.request('/api/health', { headers: { 'x-forwarded-for': '192.0.2.9' } });
  assert.equal((await directResponse.json()).ip, '127.0.0.1');
  const { request } = await fixture(t, { env: { TRUST_PROXY_HOPS: '1' } });
  for (let i = 0; i < 2; i++) assert.equal((await request('/api/register', { headers: { 'x-forwarded-for': `198.51.100.${i}, 192.0.2.10` } })).status, 200);
  assert.equal((await request('/api/register', { headers: { 'x-forwarded-for': '198.51.100.99, 192.0.2.10' } })).status, 429);
  assert.equal((await request('/api/register', { headers: { 'x-forwarded-for': '192.0.2.11' } })).status, 200);
});

test('IPv6 addresses in the same /56 share a login identity budget', async t => {
  const { request } = await fixture(t, { env: { TRUST_PROXY_HOPS: '1' } });
  for (let i = 1; i <= 2; i++) assert.equal((await request('/api/login', { body: { email: 'a@test' }, headers: { 'x-forwarded-for': `2001:db8:abcd:1200::${i}` } })).status, 200);
  assert.equal((await request('/api/login', { body: { email: 'a@test' }, headers: { 'x-forwarded-for': '2001:db8:abcd:1200::3' } })).status, 429);
});

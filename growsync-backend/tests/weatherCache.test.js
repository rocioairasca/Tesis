const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createWeatherCache, weatherCacheKey, WEATHER_TTL_MS, MAX_RETRY_AFTER_MS } = require('../services/weatherCache');
const current = { temperature_2m: 21, relative_humidity_2m: 65, weather_code: 61, wind_speed_10m: 12, wind_direction_10m: 90, time: 1792152000 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness({ maxEntries } = {}) {
  let time = Date.parse('2026-10-16T12:00:00Z');
  const stats = { calls: 0, writes: 0, logs: [], queries: [] };
  const state = { error: null, data: { current }, gate: null, dbError: null };
  const logger = Object.fromEntries(['debug', 'warn', 'error'].map(level => [level, (...args) => stats.logs.push({ level, args })]));
  const cache = createWeatherCache({ now: () => time, logger, ...(maxEntries ? { maxEntries } : {}) });
  const stubs = {
    dotenv: { config() {} },
    '../services/weatherCache': { weatherCache: cache },
    axios: { get: async (url, config) => { stats.calls++; stats.queries.push(config.params); await state.gate?.promise; if (state.error) throw state.error; return { data: state.data }; } },
    '../db/supabaseClient': { from(table) {
      assert.equal(table, 'weather');
      return { insert(rows) {
        stats.writes++;
        return { select: () => ({ single: async () => ({ error: state.dbError, data: { ...rows[0], id: stats.writes, created_at: '2026-10-16T12:00:00Z', company_id: 'must-not-cache', user_id: 'must-not-cache' } }) }) };
      } };
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/openWeatherMap.js'), 'utf8'), {
    module, exports: module.exports, console: logger, require: id => { if (!(id in stubs)) throw Error('Unexpected dependency ' + id); return stubs[id]; },
  });
  async function request(latitude = -32.414542, longitude = -63.253653, company = 'company-a') {
    const result = { status: 200, headers: {} };
    await module.exports.fetchWeather({ query: { latitude, longitude }, body: {}, user: { company_id: company } }, {
      status(code) { result.status = code; return this; },
      setHeader(name, value) { result.headers[name] = value; },
      json(body) { result.body = body; return this; },
    });
    return result;
  }
  return { state, stats, request, advance: ms => { time += ms; }, now: () => time };
}
const rateLimit = header => Object.assign(new Error('internal provider body / location'), { response: { status: 429, data: { reason: 'Daily API request limit exceeded' }, headers: { 'retry-after': header } } });

test('cold request: one provider call and insert; hit shares rounded zone, original coordinates and public contract', async () => {
  const x = harness();
  const first = await x.request();
  assert.equal(first.status, 200); assert.equal(first.body.cache, false); assert.equal(first.body.source, 'open-meteo');
  assert.equal(first.body.latitude, -32.414542); assert.equal(first.body.longitude, -63.253653);
  x.advance(WEATHER_TTL_MS - 1);
  const next = await x.request(-32.414549, -63.253659, 'company-b');
  assert.equal(next.body.cache, true); assert.equal(next.body.id, first.body.id); assert.equal(next.body.observed_at, first.body.observed_at);
  assert.equal(next.body.latitude, first.body.latitude); assert.equal(x.stats.calls, 1); assert.equal(x.stats.writes, 1);
  assert.equal(Object.hasOwn(next.body, 'company_id'), false); assert.equal(Object.hasOwn(next.body, 'user_id'), false);
  assert.equal(x.stats.queries[0].latitude, -32.414542);
  assert.ok(x.stats.logs.some(entry => entry.args[0] === 'Weather cache hit'));
  assert.ok(!JSON.stringify(x.stats.logs).includes('-32.414542'));
});

test('TTL expires at 15 minutes and successful in-flight promise is removed', async () => {
  const x = harness(); await x.request(); x.advance(WEATHER_TTL_MS);
  const fresh = await x.request(); assert.equal(fresh.body.cache, false); assert.equal(x.stats.calls, 2); assert.equal(x.stats.writes, 2);
});

test('different zones do not share cache and coordinate validation runs before the provider', async () => {
  const x = harness(); await x.request(-32, -63); await x.request(-33, -63);
  assert.equal(x.stats.calls, 2);
  for (const coords of [[91, 0], [0, 181], ['', 0], [null, 0]]) assert.equal((await x.request(...coords)).status, 400);
  assert.equal(x.stats.calls, 2); assert.equal(weatherCacheKey(-0.0001, 0), weatherCacheKey(0.0001, 0));
});

test('20 simultaneous requests coalesce through provider AND persistence: 1 call, 1 row', async () => {
  const x = harness(); x.state.gate = deferred();
  const requests = Array.from({ length: 20 }, () => x.request());
  await Promise.resolve(); assert.equal(x.stats.calls, 1);
  x.state.gate.resolve(); const responses = await Promise.all(requests);
  assert.equal(x.stats.writes, 1); assert.equal(responses.filter(r => !r.body.cache).length, 1);
  assert.equal(responses.filter(r => r.body.cache).length, 19);
  assert.ok(responses.every(r => r.body.id === responses[0].body.id));
  assert.equal(x.stats.logs.filter(entry => entry.args[0] === 'Weather request joined in-flight').length, 19);
});

test('failed in-flight promise is removed; joined failures do not poison subsequent requests', async () => {
  const x = harness(); x.state.gate = deferred(); x.state.error = Object.assign(Error('offline'), { response: { status: 503 } });
  const requests = Array.from({ length: 20 }, () => x.request()); await Promise.resolve(); x.state.gate.resolve();
  const responses = await Promise.all(requests); assert.ok(responses.every(r => r.status === 502)); assert.equal(x.stats.calls, 1); assert.equal(x.stats.writes, 0);
  x.state.error = null; assert.equal((await x.request()).status, 200); assert.equal(x.stats.calls, 2); assert.equal(x.stats.writes, 1);
});

test('429 cooldown is global across zones; default 15 minutes, typed response, no provider details', async () => {
  const x = harness(); x.state.error = rateLimit(); const limited = await x.request();
  assert.equal(limited.status, 429); assert.equal(limited.body.error, 'WeatherRateLimited'); assert.equal(limited.body.retry_after_seconds, 900); assert.equal(limited.headers['Retry-After'], '900');
  assert.ok(!JSON.stringify(limited.body).includes('Daily API')); assert.ok(!JSON.stringify(x.stats.logs).includes('internal provider'));
  x.advance(60000); const cooldown = await x.request(-20, -50); assert.equal(cooldown.status, 429); assert.equal(cooldown.body.retry_after_seconds, 840);
  assert.equal(x.stats.calls, 1); assert.equal(x.stats.writes, 0);
  x.state.error = null; x.advance(14 * 60000); assert.equal((await x.request()).status, 200); assert.equal(x.stats.calls, 2);
});

test('Retry-After delta seconds, HTTP date, invalid/past headers and upper bound', async () => {
  for (const [header, seconds] of [['120',120], ['Fri, 16 Oct 2026 12:02:00 GMT',120], ['bad',900], ['0',900], ['-1',900], ['Fri, 16 Oct 2026 11:00:00 GMT',900], ['999999999',MAX_RETRY_AFTER_MS / 1000]]) {
    const x = harness(); x.state.error = rateLimit(header); assert.equal((await x.request()).body.retry_after_seconds, seconds, String(header));
  }
  const x = harness(); x.state.error = rateLimit(); x.state.error.response.headers = { get: () => '60' };
  assert.equal((await x.request()).body.retry_after_seconds, 60);
});

test('fresh cached entries still serve during cooldown; expired cache never becomes current or stale', async () => {
  const x = harness(); await x.request(); x.state.error = rateLimit('1800'); await x.request(-20,-50);
  assert.equal((await x.request()).body.cache, true); assert.equal(x.stats.calls, 2);
  x.advance(WEATHER_TTL_MS); const expired = await x.request(); assert.equal(expired.status, 429); assert.equal(expired.body.temperature, undefined); assert.equal(x.stats.calls, 2);
});

test('HTTP non-429, timeout, malformed response and DB failure do not activate cooldown or cache failures', async () => {
  for (const error of [Object.assign(Error('http'), { response: { status: 500 } }), Object.assign(Error('timeout'), { code: 'ECONNABORTED' })]) {
    const x = harness(); x.state.error = error; assert.equal((await x.request()).body.error, 'FetchWeatherError'); x.state.error = null; assert.equal((await x.request()).status, 200); assert.equal(x.stats.calls, 2);
  }
  const missing = harness(); missing.state.data = {}; assert.equal((await missing.request()).body.error, 'IncompleteWeather'); assert.equal(missing.stats.writes, 0); missing.state.data = { current }; assert.equal((await missing.request()).status, 200); assert.equal(missing.stats.calls, 2);
  const db = harness(); db.state.dbError = { code: 'DB' }; assert.equal((await db.request()).status, 500); db.state.dbError = null; assert.equal((await db.request()).status, 200); assert.equal(db.stats.calls, 2);
});

test('cache memory is bounded by LRU capacity and expiration is lazy, without timers', async () => {
  const x = harness({ maxEntries: 2 }); await x.request(1,1); await x.request(2,2); await x.request(1,1); await x.request(3,3);
  assert.equal(x.stats.calls, 3); assert.equal((await x.request(1,1)).body.cache, true);
  assert.equal((await x.request(2,2)).body.cache, false); assert.equal(x.stats.calls, 4);
  x.advance(WEATHER_TTL_MS); assert.equal((await x.request(1,1)).body.cache, false); assert.equal((await x.request(2,2)).body.cache, false);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
// GS_BROWSER_CHANNEL=default launches the bundled Chromium; otherwise Edge, like the other browser suites.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
let server, browser, origin, cache;
before(async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  cache = mkdtempSync(join(tmpdir(), 'growsync-harvest-'));
  server = await createServer({
    root, configFile: false, cacheDir: cache,
    plugins: [{ name: 'harvest-fixture', configureServer(s) {
      s.middlewares.use((req, res, next) => {
        if (req.url.split('?')[0] !== '/') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/harvest.fixture.jsx"></script>');
      });
    } }],
    optimizeDeps: { entries: ['tests/harvest.fixture.jsx'], include: ['react', 'react-dom/client', 'react-router-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'antd', 'axios', 'dayjs', 'react-responsive', 'recharts', '@ant-design/v5-patch-for-react-19', '@hugeicons/react', '@hugeicons/core-free-icons', 'leaflet', 'react-leaflet'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root + '/..', realpathSync(root + '/node_modules')] } },
  });
  await server.listen(); origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const channel = process.env.GS_BROWSER_CHANNEL || 'msedge';
  browser = await chromium.launch({ headless: true, ...(channel === 'default' ? {} : { channel }) });
});
after(async () => { await browser?.close(); await server?.close(); if (cache?.startsWith(join(tmpdir(), 'growsync-harvest-'))) rmSync(cache, { recursive: true, force: true }); });

async function open(t, width = 1440, flags = '') {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(origin + '/' + flags, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Cosechas', exact: true }).first().waitFor({ timeout: 60000 });
  await page.getByRole('tab', { name: 'Registros' }).waitFor();
  return page;
}
const requests = (page, path) => page.evaluate(p => window.__requests.filter(r => r.path === p), path);
const resultsReady = page => page.waitForFunction(() => document.querySelector('.gs-harvest-table[aria-busy="false"]'));
const unit = (page, label) => page.locator('.gs-harvest-viewtools .ant-segmented-item', { hasText: label }).click();
const goResults = async page => { await page.getByRole('tab', { name: 'Resultados por lote' }).click(); await resultsReady(page); await page.waitForSelector('.gs-harvest-results-table tr[data-row-key], .gs-harvest-result-cards li'); };

test('desktop: pestañas Registros/Resultados, acciones existentes y campaña preseleccionada', async t => {
  const page = await open(t);
  assert.ok(await page.getByRole('button', { name: /Registrar cosecha histórica/ }).isVisible());
  assert.ok(await page.getByRole('button', { name: /^Registrar cosecha$|Registrar cosecha(?! histórica)/ }).first().isVisible());
  for (const header of ['Fecha', 'Lote / subdivisión', 'Cultivo', 'Superficie', 'Producción', 'Rendimiento', 'Campaña']) {
    assert.ok(await page.locator('.gs-harvest-table th', { hasText: header }).first().isVisible(), header);
  }
  assert.equal(await page.locator('.gs-harvest-table th', { hasText: 'Registrado por' }).count(), 0);
  await goResults(page);
  const sent = (await requests(page, '/harvest-records/results')).at(-1);
  assert.equal(sent.params.campaign, 'cmp-1'); assert.equal(sent.params.page, 1);
  assert.ok(await page.getByText('Lote 02').isVisible());
  const text = await page.locator('.gs-harvest').innerText();
  assert.doesNotMatch(text, /Gasto|Costo|USD|Estado económico|Margen/i); // FIN-01A: no economic data in this view
});

test('filtros compartidos: crop y campaña viajan de una vista a la otra', async t => {
  const page = await open(t);
  await page.getByLabel('Cultivo').first().click();
  await page.locator('.ant-select-item-option', { hasText: 'Soja' }).click();
  await goResults(page);
  const sent = (await requests(page, '/harvest-records/results')).at(-1);
  assert.equal(sent.params.crop, 'Soja'); assert.equal(sent.params.campaign, 'cmp-1');
  await page.getByRole('tab', { name: 'Registros' }).click();
  assert.ok(await page.locator('.ant-tag', { hasText: 'Soja' }).first().isVisible());
  assert.ok(await page.locator('.ant-tag', { hasText: 'Gruesa 2026/27' }).first().isVisible());
});

test('rendimiento kg/ha, qq/ha y tn/ha son solo presentación en ambas vistas', async t => {
  const page = await open(t);
  const record = () => page.locator('.gs-harvest-table tbody tr.ant-table-row').first().innerText();
  assert.match(await record(), /100 kg\/ha/);
  await unit(page, 'qq/ha');
  assert.match(await record(), /1 qq\/ha/);
  await goResults(page);
  const row = () => page.locator('.gs-harvest-results-table tr[data-row-key="lot-1|cmp-1|crop-1"]').innerText();
  assert.match(await row(), /89,31 qq\/ha/);
  await unit(page, 'tn/ha');
  assert.match(await row(), /8,93 tn\/ha/);
  await unit(page, 'kg/ha');
  assert.match(await row(), /8\.931,19 kg\/ha/);
  assert.doesNotMatch(await row(), /\.00\b|,00\b/); // integers never show .00
  const calls = await requests(page, '/harvest-records/results');
  assert.ok(calls.every(call => !('unit' in call.params) && !('yield_unit' in call.params)));
});

test('fila padre con subdivisiones expandibles y producción pendiente sin inventar cero', async t => {
  const page = await open(t);
  await goResults(page);
  const parent = page.locator('.gs-harvest-results-table tr[data-row-key="lot-1|cmp-1|crop-1"]');
  assert.match(await parent.innerText(), /610\.000 kg/);
  assert.match(await parent.innerText(), /Prorrateada/);
  await parent.locator('.ant-table-row-expand-icon').click();
  const north = page.locator('.gs-harvest-results-table tr[data-row-key="lot-1|sub-1|cmp-1|crop-1"]');
  const south = page.locator('.gs-harvest-results-table tr[data-row-key="lot-1|sub-2|cmp-1|crop-1"]');
  assert.match(await north.innerText(), /Subdivisión Norte/);
  assert.match(await south.innerText(), /Pendiente/);
  assert.match(await south.innerText(), /Sin cosecha/);
  assert.doesNotMatch(await south.innerText(), /\b0 kg\b/);
});

test('paginación del servidor y "Ver los N registros": volver conserva filtros, página y expansión', async t => {
  const page = await open(t);
  await goResults(page);
  await page.locator('.gs-harvest-results-table tr[data-row-key="lot-1|cmp-1|crop-1"] .ant-table-row-expand-icon').click();
  await page.locator('.ant-pagination-item-2').click();
  await page.waitForFunction(() => window.__requests.some(r => r.path === '/harvest-records/results' && r.params.page === 2));
  await resultsReady(page);
  assert.ok(await page.getByText('Lote 26').isVisible());
  await page.locator('.ant-pagination-item-1').click();
  await resultsReady(page);
  await page.locator('.gs-harvest-results-table tr[data-row-key="lot-1|sub-1|cmp-1|crop-1"] .gs-harvest-records-link').click();
  await page.getByRole('tab', { name: 'Registros', selected: true }).waitFor();
  assert.ok(await page.locator('.gs-harvest-keyfilter', { hasText: 'T4 · Norte · Soja' }).isVisible());
  const sent = (await requests(page, '/harvest-records')).at(-1);
  assert.deepEqual([sent.params.campaign_id, sent.params.crop_id, sent.params.lot_id, sent.params.sub_lot_id], ['cmp-1', 'crop-1', 'lot-1', 'sub-1']);
  await page.getByRole('button', { name: 'Volver a Resultados por lote' }).click();
  await page.getByRole('tab', { name: 'Resultados por lote', selected: true }).waitFor();
  await resultsReady(page);
  assert.ok(await page.locator('.gs-harvest-results-table tr[data-row-key="lot-1|sub-1|cmp-1|crop-1"]').isVisible()); // expansion kept
  assert.equal((await requests(page, '/harvest-records/results')).at(-1).params.campaign, 'cmp-1');
});

test('Registros: paginación local, detalle individual y volver sin perder la página', async t => {
  const page = await open(t);
  await page.waitForSelector('.gs-harvest-table tbody tr.ant-table-row');
  assert.equal(await page.locator('.gs-harvest-table tbody tr.ant-table-row').count(), 10);
  await page.locator('.gs-harvest-table .ant-pagination-item-2').click();
  assert.equal(await page.locator('.gs-harvest-table tbody tr.ant-table-row').count(), 2);
  await page.locator('.gs-harvest-table tbody tr.ant-table-row').first().locator('.gs-ui-entity, button').first().click();
  await page.getByText('Detalle de cosecha').waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('Detalle de cosecha').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.gs-harvest-table tbody tr.ant-table-row').count(), 2);
  assert.ok(await page.locator('.gs-harvest-table .ant-pagination-item-2.ant-pagination-item-active').isVisible());
});

test('gráficos secundarios: panel lateral plegable, la tabla sigue primero', async t => {
  const page = await open(t, 1440);
  await page.waitForSelector('.gs-harvest-workspace aside');
  assert.ok(await page.getByRole('button', { name: 'Ocultar gráficos' }).isVisible());
  await page.getByRole('button', { name: 'Ocultar gráficos' }).click();
  assert.equal(await page.locator('.gs-harvest-workspace aside').count(), 0);
  await page.getByRole('button', { name: 'Gráficos' }).click();
  await page.waitForSelector('.gs-harvest-workspace aside');
});

test('390 px: resultados como tarjetas, sin tabla horizontal ni desborde', async t => {
  const page = await open(t, 390);
  await goResults(page);
  assert.equal(await page.locator('.gs-harvest-results-table').count(), 0);
  const card = page.locator('.gs-harvest-result-cards li').first();
  const text = await card.innerText();
  assert.match(text, /T4/); assert.match(text, /Producción: 610\.000 kg/); assert.match(text, /Rendimiento: 8\.931,19 kg\/ha/); assert.match(text, /En curso/);
  await card.getByRole('button', { name: /Ver 2 subdivisiones/ }).click();
  assert.ok(await page.locator('.gs-harvest-result-child').first().isVisible());
  assert.match(await page.locator('.gs-harvest-result-child').nth(1).innerText(), /Producción: Pendiente/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `desborde horizontal ${overflow}px`);
  await unit(page, 'tn/ha');
  assert.match(await card.innerText(), /8,93 tn\/ha/);
  await page.getByRole('button', { name: /^Ver los 4 registros/ }).first().click();
  await page.getByRole('tab', { name: 'Registros', selected: true }).waitFor();
});

test('estado vacío y registros no clasificados se informan sin asignarse', async t => {
  const page = await open(t, 1440, '?unclassified');
  await goResults(page);
  assert.ok(await page.getByRole('status').filter({ hasText: '2 cosechas no se pueden clasificar' }).isVisible());
  const empty = await open(t, 1440, '?empty');
  await empty.getByRole('tab', { name: 'Resultados por lote' }).click();
  await empty.getByText('No hay resultados para esta selección').waitFor();
});

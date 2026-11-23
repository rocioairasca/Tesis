// FIN-01B: real costs from Planning in "Resultados por lote". Same synthetic fixture as FIN-01A (?costs grants economic access).
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
  cache = mkdtempSync(join(tmpdir(), 'growsync-harvest-costs-'));
  server = await createServer({
    root, configFile: false, cacheDir: cache,
    plugins: [{ name: 'harvest-costs-fixture', configureServer(s) {
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
after(async () => { await browser?.close(); await server?.close(); if (cache?.startsWith(join(tmpdir(), 'growsync-harvest-costs-'))) rmSync(cache, { recursive: true, force: true }); });

async function open(t, width = 1440, flags = '?costs') {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(origin + '/' + flags, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Registros' }).waitFor({ timeout: 60000 });
  await page.getByRole('tab', { name: 'Resultados por lote' }).click();
  await page.waitForSelector('.gs-harvest-results-table tr[data-row-key], .gs-harvest-result-cards li');
  return page;
}
const requests = (page, path) => page.evaluate(p => window.__requests.filter(r => r.path === p), path);
const row = (page, key) => page.locator(`.gs-harvest-results-table tr[data-row-key="${key}"]`);
const T4 = 'lot-1|cmp-1|crop-1';

test('con permiso económico: columnas, valores con ≥, Pendiente, cero confirmado y nunca "Completo"', async t => {
  const page = await open(t);
  for (const header of ['Gastos', 'Gasto / ha', 'Costo / tn', 'Estado económico']) assert.ok(await page.locator('.gs-harvest-results-table th', { hasText: header }).first().isVisible(), header);
  const t4 = await row(page, T4).innerText();
  assert.match(t4, /68,3 ha/);                                                  // surface stays visible in the row (secondary info)
  assert.match(t4, /USD 5\.420 conocidos/); assert.match(t4, /≥ USD 99,45\/ha/); assert.match(t4, /≥ USD 12,43\/t/); assert.match(t4, /Parcial/); assert.match(t4, /prov\./);
  const pending = await row(page, 'lot-02|cmp-1|crop-1').innerText();
  assert.match(pending, /Pendiente/); assert.doesNotMatch(pending, /USD/);                       // absence is never USD 0
  const zero = await row(page, 'lot-03|cmp-1|crop-1').innerText();
  assert.match(zero, /USD 0 conocidos/); assert.match(zero, /Parcial/); assert.doesNotMatch(zero, /Pendiente.*Pendiente/s);
  const text = await page.locator('.gs-harvest').innerText();
  assert.doesNotMatch(text, /\bCompleto\b|Costo completo|promedio|Margen|ROI|Rentabilidad|Ingreso/i);
  assert.ok(!/\.\d{3}\b,\d{3}/.test(t4)); // at most 2 decimals, no ".00"
  assert.doesNotMatch(t4, /,00\b/);
});

test('resumen superior: gasto conocido con ayuda y cantidad de lotes incompletos, sin costo promedio', async t => {
  const page = await open(t);
  const summary = await page.locator('.gs-harvest-summary').innerText();
  assert.match(summary, /Gasto conocido/); assert.match(summary, /USD 91\.795/); assert.match(summary, /Costos registrados hasta el momento/); assert.match(summary, /30 lotes con costos incompletos/);
  assert.doesNotMatch(summary, /promedio|Costo \/ ha/i);
});

test('sin permiso económico: ni columnas ni importes en la UI', async t => {
  const page = await open(t, 1440, '');
  assert.equal(await page.locator('.gs-harvest-results-table th', { hasText: /Gastos|Costo|Estado económico/ }).count(), 0);
  const text = await page.locator('.gs-harvest').innerText();
  assert.doesNotMatch(text, /USD|Gasto conocido|conocidos/);
  const sent = (await requests(page, '/harvest-records/results')).at(-1);
  assert.ok(!Object.keys(sent.params).some(key => /cost|usd|econom/i.test(key)));
  await page.getByRole('button', { name: /Ver detalle de T4/ }).click();
  await page.locator('.gs-harvest-result-detail').waitFor();
  const detail = await page.locator('.gs-harvest-result-detail').innerText();
  assert.match(detail, /Producción acumulada/); assert.doesNotMatch(detail, /Gastos conocidos|USD|Estado económico|Relación costo/);
});

test('detalle desktop: gastos, advertencia, producción, relación mínima y provisoria, desglose y volver sin perder estado', async t => {
  const page = await open(t);
  await page.locator('.ant-pagination-item-2').click();
  await page.waitForSelector('.gs-harvest-results-table tr[data-row-key="lot-26|cmp-1|crop-1"]');
  await page.locator('.ant-pagination-item-1').click();
  await page.waitForSelector(`.gs-harvest-results-table tr[data-row-key="${T4}"]`);
  await page.getByRole('button', { name: /Ver detalle de T4$/ }).click();
  const panel = page.locator('.gs-harvest-result-detail');
  await panel.waitFor();
  assert.ok(await page.locator('.gs-harvest-results-table').isVisible()); // docked, not modal: the table stays usable
  const text = await panel.innerText();
  for (const expected of ['Gastos conocidos', 'Productos', 'USD 3.980', 'Labor', 'USD 1.440', 'Total conocido', 'USD 5.420', 'Líneas pendientes', 'Pueden existir otros gastos aún no imputados',
    'Producción acumulada', '610.000 kg', 'Superficie cosechada', 'Rendimiento', 'Registros de cosecha', 'Gasto conocido / ha', '≥ USD 99,45/ha', 'Gasto conocido / tn', '≥ USD 12,43/t',
    'La cosecha sigue en curso: el costo por tonelada es provisional.', 'Desglose por Planning', 'Fumigación', 'Esta Planning está deshabilitada actualmente; su costo sigue formando parte del resultado.', 'Glifosato', 'Coadyuvante · 2 L: Pendiente']) {
    assert.ok(text.includes(expected), `falta «${expected}» en el detalle`);
  }
  assert.doesNotMatch(text, /Costo total|Costo completo|Margen/);
  const detailCall = (await requests(page, '/harvest-records/results/detail')).at(-1);
  assert.deepEqual(detailCall.params, { campaign_id: 'cmp-1', crop_id: 'crop-1', lot_id: 'lot-1' });
  await panel.getByRole('button', { name: /^Ver los 4 registros/ }).click();
  await page.getByRole('tab', { name: 'Registros', selected: true }).waitFor();
  assert.ok(await page.locator('.gs-harvest-keyfilter', { hasText: 'T4 · Soja' }).isVisible());
  await page.getByRole('button', { name: 'Volver a Resultados por lote' }).click();
  await page.getByRole('tab', { name: 'Resultados por lote', selected: true }).waitFor();
  await page.locator('.gs-harvest-result-detail').waitFor();                         // selection kept
  assert.equal((await requests(page, '/harvest-records/results')).at(-1).params.page, 1);
});

test('subdivisión: el detalle pide la clave exacta de la hija', async t => {
  const page = await open(t);
  await row(page, T4).locator('.ant-table-row-expand-icon').click();
  await page.getByRole('button', { name: /Ver detalle de T4 Norte/ }).click();
  await page.locator('.gs-harvest-result-detail').waitFor();
  const call = (await requests(page, '/harvest-records/results/detail')).at(-1);
  assert.equal(call.params.sub_lot_id, 'sub-1');
  assert.match(await page.locator('.gs-harvest-result-detail').innerText(), /USD 100,5/);
});

test('390 px con permiso: tarjetas con gasto conocido, costo/tn y estado; detalle a pantalla completa', async t => {
  const page = await open(t, 390);
  assert.equal(await page.locator('.gs-harvest-results-table').count(), 0);
  const card = (await page.locator('.gs-harvest-result-cards li').first().innerText());
  assert.match(card, /Gasto conocido: USD 5\.420 conocidos/); assert.match(card, /Costo \/ tn: ≥ USD 12,43\/t \(prov\.\)/); assert.match(card, /Estado económico:\s*Parcial/);
  assert.doesNotMatch(card, /Gasto \/ ha/); // compact: not every desktop metric
  assert.match(await page.locator('.gs-harvest-result-cards li').nth(1).innerText(), /Gasto conocido: Pendiente/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `desborde horizontal ${overflow}px`);
  await page.getByRole('button', { name: /Ver detalle de T4$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Detalle del resultado' });
  await dialog.waitFor();
  const box = await dialog.boundingBox();
  assert.ok(box.width >= 389 && box.height >= 600, 'pantalla completa');
  assert.match(await dialog.innerText(), /Total conocido/);
  await dialog.getByRole('button', { name: 'Volver a resultados' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await page.locator('.gs-harvest-result-cards li').first().isVisible());
});

test('390 px sin permiso: las tarjetas no muestran datos económicos', async t => {
  const page = await open(t, 390, '');
  const text = await page.locator('.gs-harvest-result-cards').innerText();
  assert.doesNotMatch(text, /Gasto|Costo|USD|económico/);
});

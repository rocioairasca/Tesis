// FIN-01C: additional expenses and explicit completeness. Same synthetic fixture (?costs = economic read, ?edit = economic edit).
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
  cache = mkdtempSync(join(tmpdir(), 'growsync-harvest-economic-'));
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
after(async () => { await browser?.close(); await server?.close(); if (cache?.startsWith(join(tmpdir(), 'growsync-harvest-economic-'))) rmSync(cache, { recursive: true, force: true }); });

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
const T4 = 'lot-1|cmp-1|crop-1', DONE = 'lot-04|cmp-1|crop-1', READY = 'lot-05|cmp-1|crop-1';
const posts = page => page.evaluate(() => window.__posts);
const detail = async (page, name) => { await page.getByRole('button', { name: new RegExp(`Ver detalle de ${name}$`) }).click(); const panel = page.locator('.gs-harvest-result-detail, .gs-harvest-result-detail--full').first(); await panel.waitFor(); await panel.getByText('Estado de los gastos').waitFor(); return panel; };

test('fila Completa: sin ≥, con costo/tn provisional y estado Completo; las parciales conservan ≥', async t => {
  const page = await open(t, 1440, '?costs&edit');
  const done = await row(page, DONE).innerText();
  assert.match(done, /Completo/); assert.doesNotMatch(done, /≥/); assert.match(done, /USD 14\/t · prov\./);
  const ready = await row(page, READY).innerText();
  assert.match(ready, /Parcial/); assert.match(ready, /≥ USD 20\/t/);
});

test('detalle completo: otros gastos por categoría, revisor y fecha; sin ≥ ni advertencia de gastos no imputados', async t => {
  const page = await open(t, 1440, '?costs&edit');
  const panel = await detail(page, 'Lote 04');
  const text = await panel.innerText();
  for (const expected of ['Otros gastos', 'Flete', 'Flete a puerto', 'Remito 123', 'Secado', 'Pendiente: falta la cotización del día de pago', 'Estado de los gastos', 'Completo', 'Revisado por Ana Pérez · 05/03/2027', 'Reabrir gastos'])
    assert.ok(text.includes(expected), `falta «${expected}»`);
  assert.doesNotMatch(text, /Pueden existir otros gastos aún no imputados/);
  assert.doesNotMatch(text, /≥ USD 14/);
  assert.equal(await panel.getByRole('button', { name: 'Marcar gastos como completos' }).count(), 0);
});

test('marcar completos: resumen, advertencia exacta, un POST idempotente y la fila pasa a Completo', async t => {
  const page = await open(t, 1440, '?costs&edit');
  const panel = await detail(page, 'Lote 05');
  await panel.getByRole('button', { name: 'Marcar gastos como completos' }).click();
  const dialog = page.getByRole('dialog', { name: 'Marcar gastos como completos' });
  const text = await dialog.innerText();
  assert.match(text, /Gasto conocido: USD 2\.000/); assert.match(text, /Pendientes: 0/);
  assert.ok(text.includes('Confirmás que revisaste los gastos de este lote, campaña y cultivo y que no quedan gastos conocidos por registrar.'));
  await dialog.getByRole('button', { name: 'Marcar como completos' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const sent = (await posts(page)).filter(p => p.path === '/harvest-records/results/completeness');
  assert.equal(sent.length, 1); assert.ok(sent[0].key && sent[0].key.length > 8);
  assert.deepEqual(sent[0].body, { action: 'complete', campaign_id: 'cmp-1', crop_id: 'crop-1', lot_id: 'lot-05' });
  await panel.getByRole('button', { name: 'Reabrir gastos' }).waitFor();
  assert.match(await row(page, READY).innerText(), /Completo/);
});

test('con pendientes no se puede completar y se explican los bloqueos', async t => {
  const page = await open(t, 1440, '?costs&edit');
  const panel = await detail(page, 'T4');
  assert.ok(await panel.getByRole('button', { name: 'Marcar gastos como completos' }).isDisabled());
  const text = await panel.innerText();
  assert.match(text, /Hay líneas de planificaciones pendientes de valorizar/); assert.match(text, /Hay gastos pendientes de cotización/);
  assert.equal((await posts(page)).length, 0);
});

test('reabrir exige motivo y queda registrado; la fila vuelve a Parcial con ≥', async t => {
  const page = await open(t, 1440, '?costs&edit');
  const panel = await detail(page, 'Lote 04');
  await panel.getByRole('button', { name: 'Reabrir gastos' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reabrir gastos' });
  const confirm = dialog.getByRole('button', { name: 'Reabrir gastos' });
  assert.ok(await confirm.isDisabled());
  await dialog.getByLabel('Motivo').fill('Falta una factura de flete');
  await confirm.click(); await dialog.waitFor({ state: 'hidden' });
  const sent = (await posts(page)).at(-1);
  assert.equal(sent.body.action, 'reopen'); assert.equal(sent.body.reason, 'Falta una factura de flete');
  const after = await row(page, DONE).innerText();
  assert.match(after, /Parcial/); assert.match(after, /≥/);
});

test('un error del servidor al declarar se muestra y no cambia el estado', async t => {
  const page = await open(t, 1440, '?costs&edit');
  const panel = await detail(page, 'Lote 05');
  await page.evaluate(() => { window.__failNext = true; });
  await panel.getByRole('button', { name: 'Marcar gastos como completos' }).click();
  const dialog = page.getByRole('dialog', { name: 'Marcar gastos como completos' });
  await dialog.getByRole('button', { name: 'Marcar como completos' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').innerText(), /Hay gastos pendientes/);
  assert.match(await row(page, READY).innerText(), /Parcial/);
});

test('formulario de gasto: advertencia de duplicación, USD directo, ARS con FX, campaña completa y envío con Idempotency-Key', async t => {
  const page = await open(t, 1440, '?costs&edit');
  await page.getByRole('button', { name: 'Registrar gasto' }).first().click();
  const form = page.getByRole('form', { name: 'Registrar gasto' });
  await form.waitFor();
  assert.ok((await form.innerText()).includes('Verificá que este gasto no esté ya registrado mediante una planificación ejecutada.'));
  assert.ok(await form.getByRole('button', { name: 'Registrar gasto' }).isDisabled());
  assert.equal(await form.getByLabel('Cotización').count(), 0);                                   // USD: no FX
  const pick = async (label, option) => { await form.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: label, exact: true }) }).click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(option, { exact: true }).click(); };
  await pick('Campaña', 'Gruesa 2026/27'); await pick('Cultivo', 'Soja'); await pick('Categoría', 'Flete');
  await form.getByLabel('Descripción').fill('Flete a puerto'); await form.getByLabel('Fecha del gasto').fill('2027-03-01'); await form.getByLabel('Importe').fill('500000');
  await pick('Moneda', 'ARS');
  assert.ok(await form.getByLabel('Cotización', { exact: true }).isVisible());
  assert.match(await form.innerText(), /Pendiente: falta la cotización del día de pago/);
  await form.getByLabel('Fecha de pago').fill('2027-03-02'); await form.getByLabel('Cotización', { exact: true }).fill('1000'); await form.getByLabel('Fuente de la cotización').fill('BCRA A3500');
  assert.doesNotMatch(await form.innerText(), /Pendiente: falta la cotización/);
  await form.getByText('Toda la campaña').click();
  assert.ok((await form.innerText()).includes('El gasto se distribuirá entre los destinos actuales de la campaña.'));
  await form.getByRole('button', { name: 'Registrar gasto' }).click();
  await form.waitFor({ state: 'hidden' });
  const sent = (await posts(page)).find(p => p.path === '/cost-entries');
  assert.ok(sent.key);
  assert.deepEqual(sent.body, { campaign_id: 'cmp-1', category: 'freight', description: 'Flete a puerto', expense_date: '2027-03-01', currency: 'ARS', amount: '500000',
    payment_date: '2027-03-02', fx_rate: '1000', fx_date: '2027-03-02', fx_source: 'BCRA A3500', supplier_name: null, reference: null, notes: null,
    destination: { scope: 'campaign', crop_id: 'crop-1', method: 'area_proportional' } });
  assert.ok(!('company_id' in sent.body) && !('created_by' in sent.body));
});

test('porcentaje manual: exige sumar 100 y envía los porcentajes por destino', async t => {
  const page = await open(t, 1440, '?costs&edit');
  await page.getByRole('button', { name: 'Registrar gasto' }).first().click();
  const form = page.getByRole('form', { name: 'Registrar gasto' }); await form.waitFor();
  const pick = async (label, option) => { await form.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: label, exact: true }) }).click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(option, { exact: true }).click(); };
  await pick('Campaña', 'Gruesa 2026/27'); await pick('Cultivo', 'Soja'); await pick('Categoría', 'Semilla');
  await form.getByLabel('Descripción').fill('Semilla'); await form.getByLabel('Fecha del gasto').fill('2027-01-05'); await form.getByLabel('Importe').fill('1000');
  await form.getByRole('combobox', { name: 'Lotes o sublotes' }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('T4', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('T5', { exact: true }).click();
  await page.keyboard.press('Escape');
  await form.getByText('Porcentaje manual').click();
  await form.getByLabel('Porcentaje T4').fill('60'); await form.getByLabel('Porcentaje T5').fill('30');
  assert.match(await form.innerText(), /Los porcentajes deben sumar exactamente 100/);
  assert.ok(await form.getByRole('button', { name: 'Registrar gasto' }).isDisabled());
  await form.getByLabel('Porcentaje T5').fill('40');
  await form.getByRole('button', { name: 'Registrar gasto' }).click(); await form.waitFor({ state: 'hidden' });
  const sent = (await posts(page)).find(p => p.path === '/cost-entries');
  assert.deepEqual(sent.body.destination, { scope: 'lots', crop_id: 'crop-1', method: 'manual_percent', targets: [{ lot_id: 'lot-1', sub_lot_id: null, percent: '60' }, { lot_id: 'lot-2', sub_lot_id: null, percent: '40' }] });
});

test('desde el detalle el gasto llega con campaña, cultivo y lote preseleccionados', async t => {
  const page = await open(t, 1440, '?costs&edit');
  const panel = await detail(page, 'Lote 05');
  await panel.getByRole('button', { name: 'Registrar gasto' }).click();
  const form = page.getByRole('form', { name: 'Registrar gasto' }); await form.waitFor();
  await form.getByText('Gruesa 2026/27').first().waitFor();
  assert.ok(await form.getByText('Soja').first().isVisible());
});

test('sin permiso de edición económica: ni acciones de gasto ni de completitud, aunque vea los importes', async t => {
  const page = await open(t, 1440, '?costs');
  assert.equal(await page.getByRole('button', { name: 'Registrar gasto' }).count(), 0);
  const panel = await (async () => { await page.getByRole('button', { name: /Ver detalle de T4$/ }).click(); const p = page.locator('.gs-harvest-result-detail'); await p.waitFor(); return p; })();
  assert.equal(await panel.getByRole('button', { name: /Registrar gasto|Marcar gastos|Reabrir gastos/ }).count(), 0);
});

test('390 px: formulario y detalle sin desborde horizontal', async t => {
  const page = await open(t, 390, '?costs&edit');
  await page.getByRole('button', { name: 'Más acciones de la página' }).click();
  await page.getByText('Registrar gasto', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Registrar gasto' }); await form.waitFor();
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  await form.getByRole('button', { name: 'Cancelar' }).click(); await form.waitFor({ state: 'hidden' });
  const panel = await detail(page, 'Lote 04');
  const box = await panel.boundingBox();
  assert.ok(box.width >= 389);
  assert.match(await panel.innerText(), /Revisado por Ana Pérez/);
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
});

test('declaración obsoleta por evidencia nueva: vuelve a Parcial con ≥, sin revisor vigente y pide una nueva revisión', async t => {
  const page = await open(t, 1440, '?costs&edit');
  const stale = await row(page, 'lot-06|cmp-1|crop-1').innerText();
  assert.match(stale, /Parcial/); assert.match(stale, /≥/); assert.doesNotMatch(stale, /Completo/);
  const panel = await detail(page, 'Lote 06');
  const text = await panel.innerText();
  assert.match(text, /Hubo cambios en los gastos desde la última revisión/);
  assert.doesNotMatch(text, /Revisado por/); assert.doesNotMatch(text, /Completo/);
  assert.ok(await panel.getByRole('button', { name: 'Marcar gastos como completos' }).isEnabled());
});

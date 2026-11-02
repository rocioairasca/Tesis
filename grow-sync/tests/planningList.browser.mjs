import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { createServer } from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
let server, browser, origin;
before(async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  server = await createServer({
    root, configFile: false,
    plugins: [conversion(), { name: 'planning-list-fixture', configureServer(s) {
      s.middlewares.use((req, res, next) => {
        if (req.url.split('?')[0] !== '/planificaciones') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/planningList.fixture.jsx"></script>');
      });
    } }],
    cacheDir: '../.test-tools/vite-planning-list',
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root + '/..', realpathSync(root + '/node_modules')] } },
    optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react-router-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'antd', 'axios', 'dayjs', 'react-responsive', 'leaflet', 'react-leaflet', '@ant-design/v5-patch-for-react-19', '@hugeicons/react', '@hugeicons/core-free-icons'] },
  });
  await server.listen(); origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
const rows = page => page.locator('.gs-planning-table tr[data-row-key], .gs-planning-cards .inventory-card');
const drawer = page => page.locator('.planning-detail-drawer');
const calls = page => page.evaluate(() => window.__requests.filter(r => r.path === '/planning'));
const ready = page => page.waitForFunction(() => document.querySelector('.gs-planning-results[aria-busy="false"]') && document.querySelector('.gs-planning-pagination'));
// Observe the new request before checking idle UI: idle alone can belong to the old render.
async function waitForListRequest(page, beforeCount, expected) {
  await page.waitForFunction(({ beforeCount, expected }) => {
    const requests = window.__requests.filter(r => r.path === '/planning');
    const last = requests.at(-1);
    return requests.length > beforeCount && last &&
      Object.keys(last.params).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) => last.params[key] === value);
  }, { beforeCount, expected });
  return (await calls(page)).length - 1;
}
async function waitForListResult(page, requestIndex) {
  await page.waitForFunction(index => {
    const requests = window.__requests.filter(r => r.path === '/planning');
    const request = requests[index];
    if (index !== requests.length - 1 || !request?.response ||
        !document.querySelector('.gs-planning-results[aria-busy="false"]')) return false;
    if (new URLSearchParams(location.search).get('view') === 'calendar') {
      return Boolean(document.querySelector('.gs-planning-calendar'));
    }
    const result = request.response;
    const table = document.querySelector('.gs-planning-table');
    const displayed = [...document.querySelectorAll(table ? '.gs-planning-table tr[data-row-key]' : '.gs-planning-cards .inventory-card')];
    if (displayed.length !== result.data.length) return false;
    if (!document.querySelector('.gs-planning-pagination .ant-pagination-total-text')?.textContent.includes(result.total + ' planificaciones')) return false;
    return displayed.every((element, i) => table
      ? element.getAttribute('data-row-key') === result.data[i].id
      : element.querySelector('h3')?.textContent === result.data[i].crop_name + ' - Mantenimiento');
  }, requestIndex);
}
async function changeList(page, expected, action) {
  const beforeCount = (await calls(page)).length;
  await action();
  const requestIndex = await waitForListRequest(page, beforeCount, expected);
  await waitForListResult(page, requestIndex);
}
async function open(width = 1440, query = '') {
  const page = await browser.newPage({ viewport: { width, height: 950 }, reducedMotion: 'reduce', timezoneId: 'America/Argentina/Buenos_Aires' });
  page.setDefaultTimeout(15000);
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin + '/planificaciones' + query, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.locator('.gs-planning').waitFor({ timeout: 15000 }); }
  catch { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); await page.locator('.gs-planning').waitFor({ timeout: 60000 }); }
  if (!query.includes('denied')) { await page.getByText('45 planificaciones', { exact: true }).waitFor(); await ready(page); }
  return page;
}
async function fits(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.locator('.gs-shell-scroll').evaluate(el => el.scrollWidth <= el.clientWidth));
}
async function openDetail(page) {
  const first = rows(page).first();
  const planningId = await first.getAttribute('data-row-key');
  if (!planningId) {
    // Cards expose an explicit accessible detail action, without a positional button selector.
    await first.getByRole('button', { name: /^Ver detalle de / }).evaluate(el => el.click());
  } else await page.evaluate(id => {
    const url = new URL(location.href);
    url.searchParams.set('planningId', id);
    window.__navigate(url.pathname + url.search);
  }, planningId);

  await drawer(page).getByText('Juan Pérez', { exact: true }).waitFor();
}
async function closeDetail(page) {
  await drawer(page).getByRole('button', { name: /Close|Cerrar/ }).click();
  await drawer(page).waitFor({ state: 'hidden' });
}
for (const width of [1440, 1024, 390]) test(`detail retains page, rows, filters, scroll and zero list GETs at ${width}`, async t => {
  const page = await open(width, '?page=3&pageSize=8&search=Trabajo&status=pendiente');
  t.after(() => page.close());
  assert.equal(await rows(page).count(), 8);
  await page.evaluate(() => {
    window.__emptyFlash = false;
    window.__watchRows = new MutationObserver(() => {
      if (!document.querySelector('.gs-planning-table tr[data-row-key], .gs-planning-cards .inventory-card')) window.__emptyFlash = true;
    });
    window.__watchRows.observe(document.querySelector('.gs-planning-results'), { childList: true, subtree: true });
    document.querySelector('.gs-shell-scroll').scrollTop = 500;
  });
  const scroll = await page.locator('.gs-shell-scroll').evaluate(el => el.scrollTop);
  if (width < 1440) assert.equal(scroll, 500);
  const before = await rows(page).allTextContents(), beforeCalls = (await calls(page)).length;
  await openDetail(page);
  assert.equal((await calls(page)).length, beforeCalls, 'open adds zero list GETs');
  await closeDetail(page);
  assert.equal((await calls(page)).length, beforeCalls, 'close adds zero list GETs');
  assert.deepEqual(await rows(page).allTextContents(), before);
  assert.equal(await page.locator('.gs-shell-scroll').evaluate(el => el.scrollTop), scroll);
  assert.equal(await page.evaluate(() => window.__emptyFlash), false);
  const query = new URL(page.url()).searchParams;
  for (const [key, value] of Object.entries({ page: '3', pageSize: '8', search: 'Trabajo', status: 'pendiente' })) assert.equal(query.get(key), value);
  await page.goBack(); await drawer(page).getByText('Juan Pérez', { exact: true }).waitFor();
  await page.goForward(); await drawer(page).waitFor({ state: 'hidden' });
  assert.equal((await calls(page)).length, beforeCalls, 'history detail navigation adds zero list GETs');
  await fits(page);
  t.diagnostic(`list GETs before/open/close/back/forward: ${beforeCalls}/${beforeCalls}/${beforeCalls}/${beforeCalls}/${beforeCalls}; scroll: ${scroll}px preserved`);
});
test('45 active rows: server pages 1/2/3/6, >20, size change, partial last page, responsive and reload', async t => {
  const page = await open(); t.after(() => page.close());
  for (const number of [1, 2, 3, 6]) {
    if (number !== 1) {
      await changeList(page, { page: number, pageSize: 8 }, () => page.locator(`.gs-planning-pagination [title="${number}"]`).click());
    }
    assert.equal(await rows(page).count(), number === 6 ? 5 : 8);
    const first = await rows(page).first().getAttribute('data-row-key');
    assert.ok(first.endsWith(String((number - 1) * 8 + 1).padStart(12, '0')));
    assert.equal((await calls(page)).at(-1).params.page, number);
    assert.equal((await calls(page)).at(-1).params.pageSize, 8);
  }
  await page.locator('.gs-planning-pagination .ant-select').click();
  await changeList(page, { page: 1, pageSize: 16 }, () => page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^16 / }).click());
  assert.equal(await rows(page).count(), 16);
  await changeList(page, { page: 3, pageSize: 16 }, () => page.locator('.gs-planning-pagination [title="3"]').click());
  assert.equal(await rows(page).count(), 13);
  const beforeCalls = (await calls(page)).length;
  for (const width of [1024, 390, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForFunction(w => Boolean(document.querySelector('.gs-planning-table')) === (w === 1440), width);
    assert.equal(await rows(page).count(), 13); assert.equal((await calls(page)).length, beforeCalls);
    assert.equal(new URL(page.url()).searchParams.get('page'), '3'); await fits(page);
  }
  await page.reload(); await page.getByText('45 planificaciones', { exact: true }).waitFor(); await ready(page);
  assert.equal(await rows(page).count(), 13); assert.equal((await calls(page))[0].params.page, 3);
});
test('search and filters issue requests, mine shares pagination, URL detail loads independently and calendar is complete', async t => {
  const page = await open(1024, '?page=3&pageSize=8&planningId=11111111-1111-4111-8111-000000000024');
  t.after(() => page.close()); await drawer(page).getByText('Juan Pérez', { exact: true }).waitFor(); await closeDetail(page);
  await changeList(page, { mine: true, page: 1, pageSize: 8 }, () => page.getByRole('button', { name: 'Mis tareas', exact: true }).click());
  assert.equal((await calls(page)).at(-1).params.mine, true); assert.equal((await calls(page)).at(-1).params.page, 1);
  await changeList(page, { mine: true, page: 3, pageSize: 8 }, () => page.locator('.gs-planning-pagination [title="3"]').click());
  assert.equal((await calls(page)).at(-1).params.page, 3);
  await changeList(page, { mine: true, search: 'Trabajo 4', page: 1, pageSize: 8 }, () => page.evaluate(() => window.__navigate('/planificaciones?mine=1&search=Trabajo+4')));
  await page.getByText('7 planificaciones', { exact: true }).waitFor();
  assert.equal(await rows(page).count(), 7);
  await page.getByRole('heading', { name: 'Planificaciones', exact: true }).click();
  await changeList(page, { page: 1, pageSize: 8 }, () => page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click());
  await page.getByText('45 planificaciones', { exact: true }).waitFor();
  await page.locator('.gs-planning-filters .ant-select').filter({ hasText: 'Todos los estados' }).click();
  await changeList(page, { status: 'completado', page: 1, pageSize: 8 }, () => page.locator('.ant-select-dropdown:visible').getByText('Completado', { exact: true }).click());
  await page.getByText('0 planificaciones', { exact: true }).waitFor();
  assert.equal((await calls(page)).at(-1).params.status, 'completado');
  await changeList(page, { page: 1, pageSize: 8 }, () => page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click());
  await changeList(page, { page: 1, pageSize: 1000 }, () => page.getByText('Calendario', { exact: true }).click());
  assert.equal(new URL(page.url()).searchParams.get('view'), 'calendar');
  await changeList(page, { page: 1, pageSize: 8 }, () => page.goBack()); assert.equal(await rows(page).count(), 8);
});
test('edit refresh keeps rows and context; cancel last row clamps to the last valid page', async t => {
  const page = await open(1440, '?page=5&pageSize=11&search=Trabajo&status=pendiente');
  t.after(() => page.close()); assert.equal(await rows(page).count(), 1);
  await rows(page).first().getByRole('button', { name: 'Editar planificación', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar Planificación', exact: true });
  await editor.getByLabel('Descripción', { exact: true }).fill('Trabajo actualizado');
  await page.evaluate(() => { window.__delay = 900; });
  const beforeEdit = (await calls(page)).length;
  await editor.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const refreshIndex = await waitForListRequest(page, beforeEdit, { search: 'Trabajo', status: 'pendiente', page: 5, pageSize: 11 });
  assert.equal(await rows(page).count(), 1, 'refresh never clears rows');
  await waitForListResult(page, refreshIndex);
  assert.equal(new URL(page.url()).searchParams.get('page'), '5');
  assert.equal(new URL(page.url()).searchParams.get('search'), 'Trabajo');
  assert.equal((await page.evaluate(() => window.__mutations))[0].method, 'patch');
  await rows(page).first().getByRole('button', { name: 'Más acciones', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Cancelar', exact: true }).click();
  await changeList(page, { search: 'Trabajo', status: 'pendiente', page: 4, pageSize: 11 }, () => page.getByRole('button', { name: 'Cancelar planificación', exact: true }).click());
  assert.equal(new URL(page.url()).searchParams.get('page'), '4'); await page.getByText('44 planificaciones', { exact: true }).waitFor();
  assert.equal(await rows(page).count(), 11);
  assert.equal(new URL(page.url()).searchParams.get('status'), 'pendiente');
  assert.deepEqual((await calls(page)).slice(-2).map(r => r.params.page), [5, 4]);
});
test('editing out of the active search updates total without resetting a valid page', async t => {
  const page = await open(1440, '?page=2&pageSize=8&search=sintético');
  t.after(() => page.close());
  await rows(page).first().getByRole('button', { name: 'Editar planificación', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar Planificación', exact: true });
  await editor.getByLabel('Descripción', { exact: true }).fill('Otra descripción');
  await changeList(page, { search: 'sintético', page: 2, pageSize: 8 }, () => editor.getByRole('button', { name: 'Actualizar', exact: true }).click());
  await editor.waitFor({ state: 'hidden' });
  await page.getByText('44 planificaciones', { exact: true }).waitFor(); await ready(page);
  assert.equal(new URL(page.url()).searchParams.get('page'), '2');
  assert.ok(!(await rows(page).first().getAttribute('data-row-key')).endsWith('000000000009'));
  await rows(page).first().getByRole('button', { name: 'Más acciones', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Cancelar', exact: true }).click();
  await changeList(page, { search: 'sintético', page: 2, pageSize: 8 }, () => page.getByRole('button', { name: 'Cancelar planificación', exact: true }).click());
  await page.getByText('43 planificaciones', { exact: true }).waitFor(); await ready(page);
  assert.equal(new URL(page.url()).searchParams.get('page'), '2');
  assert.equal(new URL(page.url()).searchParams.get('search'), 'sintético');
});
test('page back/forward restores rows; a late old response cannot replace the current page', async t => {
  const page = await open(1440, '?page=2&pageSize=8'); t.after(() => page.close());
  await changeList(page, { page: 3, pageSize: 8 }, () => page.locator('.gs-planning-pagination [title="3"]').click());
  assert.ok((await rows(page).first().getAttribute('data-row-key')).endsWith('000000000017'));
  await changeList(page, { page: 2, pageSize: 8 }, () => page.goBack());
  assert.ok((await rows(page).first().getAttribute('data-row-key')).endsWith('000000000009'));
  await changeList(page, { page: 3, pageSize: 8 }, () => page.goForward());
  assert.ok((await rows(page).first().getAttribute('data-row-key')).endsWith('000000000017'));
  const beforeCount = (await calls(page)).length;
  await page.evaluate(() => { window.__delay = 600; window.__navigate('/planificaciones?page=4&pageSize=8'); });
  const staleIndex = await waitForListRequest(page, beforeCount, { page: 4, pageSize: 8 });
  await changeList(page, { page: 5, pageSize: 8 }, () => page.evaluate(() => { window.__delay = 0; window.__navigate('/planificaciones?page=5&pageSize=8'); }));
  await page.waitForFunction(index => Boolean(window.__requests.filter(r => r.path === '/planning')[index].response), staleIndex);
  assert.ok((await rows(page).first().getAttribute('data-row-key')).endsWith('000000000033'));
});
test('new security scope hides previous rows immediately and ignores in-flight responses; denied scope makes no list request', async t => {
  const page = await open(390); t.after(() => page.close());
  await page.evaluate(() => { window.__delay = 900; window.__setUser({ company_id: 'other' }); });
  await page.waitForFunction(() => document.querySelectorAll('.gs-planning-cards .inventory-card').length === 0);
  assert.equal(await rows(page).count(), 0);
  await page.evaluate(() => window.__setUser({ custom_permissions: [] }));
  await page.waitForTimeout(1100);
  assert.equal(await rows(page).count(), 0);
  const count = (await calls(page)).length;
  await page.evaluate(() => window.__navigate('/planificaciones?page=2'));
  await page.waitForTimeout(100);
  assert.equal((await calls(page)).length, count);
  const denied = await open(390, '?denied=1'); t.after(() => denied.close());
  assert.equal((await calls(denied)).length, 0); assert.equal(await rows(denied).count(), 0);
});

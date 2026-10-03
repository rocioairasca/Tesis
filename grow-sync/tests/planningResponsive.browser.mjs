// node --test tests/planningResponsive.browser.mjs
// PLAYWRIGHT_MODULE can point to an existing Playwright installation. Uses local Edge headless.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { createServer } from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
import { PLANNING_TABLE_WIDTH } from '../src/features/planning/planningLayout.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
let server, browser, origin;
before(async () => {
  server = await createServer({ root, configFile: false, plugins: [conversion(), {
    name: 'planning-layout-fixture', configureServer(s) {
      s.middlewares.use((req, res, next) => {
        if (req.url.split('?')[0] !== '/') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<div id="root"></div><script type="module" src="/tests/planningResponsive.fixture.jsx"></script>');
      });
    },
  }], cacheDir: '../.test-tools/vite-responsive', server: { host: '127.0.0.1', port: 0, hmr: false,
    fs: { allow: [root + '/..', realpathSync(root + '/node_modules')] } },
    optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react-router-dom', 'react/jsx-runtime',
      'react/jsx-dev-runtime', 'antd', 'axios', 'dayjs', 'react-responsive', 'socket.io-client',
      '@ant-design/v5-patch-for-react-19', '@hugeicons/react', '@hugeicons/core-free-icons'] },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
async function openPage(width, height, query = '') {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  page.on('pageerror', error => console.error('Fixture error:', error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin + '/' + query);
  await page.locator('.gs-workspace-surface').waitFor({ timeout: 60000 });
  // Expose overflow that legacy global clipping could otherwise conceal.
  await page.addStyleTag({ content: 'html, body, #root { overflow-x: visible !important; } .gs-shell { overflow: visible !important; }' });
  return page;
}
async function assertFits(page, includeHeaders = true) {
  const metrics = await page.evaluate(() => {
    const selectors = ['html', 'body', '#root', '.gs-shell', '.gs-shell-main', '.gs-shell-scroll', '.gs-workspace', '.gs-workspace-surface', '.gs-planning'];
    return selectors.flatMap(selector => {
      const el = document.querySelector(selector);
      return el ? [{ selector, scroll: el.scrollWidth, client: el.clientWidth }] : [];
    });
  });
  for (const { selector, scroll, client } of metrics) assert.ok(scroll <= client, `${selector}: ${scroll} > ${client}`);
  const outside = await page.locator('.gs-planning-header button, .gs-planning-header .ant-segmented, .gs-planning-filters .ant-select, .gs-planning-filters button, .gs-planning-cards .card-icons' + (includeHeaders ? ', .gs-planning-table th' : '')).evaluateAll(elements => elements.filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width && (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1);
  }).map(el => el.textContent));
  assert.deepEqual(outside, []);
}
async function assertLayout(page) {
  await page.waitForFunction(threshold => {
    const el = document.querySelector('.gs-planning');
    if (!el) return false;
    const s = getComputedStyle(el);
    const width = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    return Boolean(el.querySelector(width < threshold ? '.gs-planning-cards .inventory-card' : '.gs-planning-table tbody tr'));
  }, PLANNING_TABLE_WIDTH);
  await assertFits(page);
  return await page.locator('.gs-planning-table').count() ? 'table' : 'cards';
}
for (const [width, height] of [[1600,900],[1366,768],[1280,720],[1106,700],[1024,768],[768,1024],[390,844]]) {
  test(`Planning ${width}x${height}: sidebar, filters, actions, calendar and drawer`, async () => {
    const page = await openPage(width, height);
    try {
      const layouts = [];
      for (const collapsed of width >= 768 ? [false, true] : [false]) {
        if (collapsed) await page.getByRole('button', { name: 'Colapsar menú' }).click();
        layouts.push(await assertLayout(page));
        if (!collapsed && [1600, 1106, 390].includes(width)) {
          await page.screenshot({ path: fileURLToPath(new URL(`../../.test-tools/planning-${width}.png`, import.meta.url)) });
        }
        await page.getByRole('button', { name: width < 768 ? 'Nueva planificacion' : 'Nueva Planificación', exact: true }).waitFor();
        const edit = page.locator('.gs-planning button[aria-label^="Editar"]').first();
        await edit.click();
        const drawer = page.locator('.ant-drawer-open');
        await drawer.waitFor();
        assert.ok((await drawer.getAttribute('class')).includes(width < 768 ? 'ant-drawer-bottom' : 'ant-drawer-right'));
        await drawer.getByRole('button', { name: /Close|Cerrar/ }).click();
        await drawer.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Más filtros', exact: true }).click();
        const popover = page.locator('.ant-popover:visible');
        await popover.waitFor();
        const box = await popover.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width);
        await assertFits(page);
        await page.getByRole('heading', { name: 'Planificaciones', exact: true }).click();
        await page.getByText('Calendario', { exact: true }).click();
        await page.locator('.gs-planning-calendar .ant-picker-calendar').waitFor();
        assert.equal(await page.locator('.gs-planning-cards').count(), 0);
        assert.equal(await page.locator('.gs-planning-table').count(), 0);
        await assertFits(page);
        await page.getByText('Tabla', { exact: true }).click();
        await assertLayout(page);
      }
      console.log(`${width}x${height}: ${layouts.join(' / ')}, document and workspace without horizontal overflow`);
    } catch (error) {
      console.error(error);
      console.error(await page.locator('.gs-planning *').evaluateAll(elements => elements.filter(el =>
        el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 20).map(el => ({
        tag: el.tagName, class: el.className, width: getComputedStyle(el).width,
        minWidth: getComputedStyle(el).minWidth, tableLayout: getComputedStyle(el).tableLayout,
      }))));
      await page.screenshot({ path: fileURLToPath(new URL(`../../.test-tools/planning-failure-${width}.png`, import.meta.url)) });
      throw error;
    } finally { await page.close(); }
  });
}
test('ResizeObserver switches both ways on sidebar changes and container-only resizing', async () => {
  const page = await openPage(1366, 768);
  try {
    assert.equal(await assertLayout(page), 'cards');
    await page.getByRole('button', { name: 'Colapsar menú' }).click();
    assert.equal(await assertLayout(page), 'cards');
    await page.setViewportSize({ width: 1600, height: 900 });
    assert.equal(await assertLayout(page), 'table');
    await page.locator('.gs-workspace-surface').evaluate(el => { el.style.width = '900px'; });
    assert.equal(await assertLayout(page), 'cards');
    await page.locator('.gs-workspace-surface').evaluate(el => { el.style.width = ''; });
    assert.equal(await assertLayout(page), 'table');
    // At this width, collapsing the sidebar alone crosses the table threshold.
    await page.setViewportSize({ width: 1450, height: 900 });
    assert.equal(await assertLayout(page), 'table');
    await page.getByRole('button', { name: 'Expandir menú' }).click();
    assert.equal(await assertLayout(page), 'cards');
    await page.getByRole('button', { name: 'Colapsar menú' }).click();
    assert.equal(await assertLayout(page), 'table');
  } finally { await page.close(); }
});
test('standalone table scroll is contained and Acciones remains reachable', async () => {
  const page = await openPage(1106, 700, '?fallback');
  try {
    await page.locator('.gs-planning-table .ant-table-row').first().waitFor();
    await assertFits(page, false);
    const scroll = page.locator('.gs-planning-table .ant-table-content');
    assert.ok(await scroll.evaluate(el => el.scrollWidth > el.clientWidth));
    await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    const edit = page.getByRole('button', { name: 'Editar planificación', exact: true }).first();
    await edit.click();
    assert.equal(await page.evaluate(() => window.__actionReached), true);
    await assertFits(page, false);
  } finally { await page.close(); }
});
test('non-Admin with planning permissions can select self and every returned responsible', async () => {
  const page = await openPage(1106, 700, '?nonadmin');
  try {
    await assertLayout(page);
    let sent = 0;
    for (const [id, name] of [['colleague', 'Compañero habilitado'], ['supervisor', 'Supervisor habilitado'], ['admin', 'Admin habilitado'], ['user', 'Responsable de prueba']]) {
      await page.locator('.gs-planning button[aria-label^="Editar"]').first().click();
      const drawer = page.locator('.ant-drawer-open');
      await drawer.waitFor();
      await drawer.locator('.ant-select-selector').filter({ has: page.locator('#responsible_user') }).click();
      const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option-content');
      await options.first().waitFor();
      assert.deepEqual((await options.allTextContents()).sort(), ['Responsable de prueba', 'Compañero habilitado', 'Supervisor habilitado', 'Admin habilitado'].sort());
      await page.locator('.ant-select-dropdown:visible').getByText(name, { exact: true }).click();
      await drawer.getByRole('button', { name: 'Actualizar', exact: true }).click();
      sent += 1;
      await page.waitForFunction(count => window.__planningPatches.length === count, sent);
      assert.equal(await page.evaluate(() => window.__planningPatches.at(-1).responsible_user), id);
      await drawer.waitFor({ state: 'hidden' });
    }
  } finally { await page.close(); }
});

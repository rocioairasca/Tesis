import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import inventoryConversionPlugin from '../vite/inventoryConversionPlugin.mjs';

test('apertura inicial: contratos, estado, permisos, manifiesto e idempotencia', async () => {
  const { createServer, build } = await import('vite');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, configFile: false, plugins: [inventoryConversionPlugin()],
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const m = await server.ssrLoadModule('/src/features/inventory/stockInitialModel.mjs');
    const { monthlyInputEdit } = await server.ssrLoadModule('/src/features/inventory/components/MonthlyExpirationInput.jsx');
    for (const [text, previous, type, expected] of [
      ['0', '', '', '0'], ['01', '0', '', '01/'], ['01/2', '01/', '', '01/2'],
      ['01/20', '', '', '01/20'], ['01/202', '', '', '01/202'], ['01/2027', '', '', '01/2027'],
      ['012027', '', 'insertFromPaste', '01/2027'], ['01//2027', '', '', '01/2027'],
      ['01', '01/', 'deleteContentBackward', '0'], ['01/202', '01/2027', 'deleteContentBackward', '01/202'],
      ['', '0', 'deleteContentBackward', '']]) {
      assert.equal(monthlyInputEdit(text, text.length, previous, type).value, expected);
    }
    const products = [{ id: 'p', name: 'Glifosato', unit: 'L', enabled: true }, { id: 'off', enabled: false }];
    assert.equal(m.enabledProducts(products).length, 1);
    const status = { inventory_control_start_date: null, opening: { exists: false }, can_confirm: false };
    assert.equal(m.canOpenInitial(false, status), false);
    assert.equal(m.canOpenInitial(true, status), true);
    assert.throws(() => m.initialManifest(null, [], products), /fecha/);
    const row = { product_id: 'p', quantity: '250', unit: 'cc', expiration_period: dayjs('2027-09-01'), notes: 'excluded' };
    const manifest = m.initialManifest('2026-09-24', [row, { ...row, quantity: '' }, { ...row, quantity: '0' }, { quantity: '0' }], products);
    assert.deepEqual(manifest, { date: '2026-09-24', entries: [{ product_id: 'p', quantity: '250', unit: 'cc', expiration_year: 2027, expiration_month: 9 }] });
    assert.throws(() => m.initialManifest(manifest.date, [row, row], products), /repetidos/);
    assert.equal(m.initialManifest(manifest.date, [row, { ...row, expiration_period: null }], products).entries.length, 2);
    assert.throws(() => m.initialManifest(manifest.date, [{ ...row, unit: 'kg' }], products), /compatible/);
    const preview = { date: manifest.date, preview_hash: 'a'.repeat(64), inventory_v1_enabled: true,
      entries: [{ ...manifest.entries[0], quantity: '0.250000', unit: 'L', entered_quantity: '250', entered_unit: 'mL', expiration_date: null }] };
    assert.equal(m.canConfirmInitial({ ...status, can_confirm: true }, preview), true);
    assert.equal(m.canConfirmInitial(status, preview), false);
    assert.equal(m.canConfirmInitial({ ...status, can_confirm: true }, { ...preview, preview_hash: '' }), false);
    const calls = [];
    let fail = true;
    const service = m.initialApi({
      get: async url => { calls.push({ url }); return { data: status }; },
      put: async (url, body) => { calls.push({ url, body }); return { data: body }; },
      post: async (url, body, config) => {
        calls.push({ url, body: JSON.stringify(body), config });
        if (url.endsWith('/prepare')) return { data: preview };
        if (fail) { fail = false; throw new Error('Network timeout'); }
        return { data: { persisted: true, replayed: true } };
      },
    });
    assert.equal((await service.status()).inventory_control_start_date, null);
    await service.setDate(manifest.date);
    assert.deepEqual(calls[1], { url: '/history/inventory-control-start', body: { inventory_control_start_date: manifest.date } });
    await service.prepare(manifest);
    assert.equal(manifest.entries[0].unit, 'cc');
    assert.equal(manifest.entries[0].quantity, '250');
    const attempt = m.confirmationAttempt(manifest, preview, 'stable-key');
    await assert.rejects(service.confirm(attempt), /timeout/);
    assert.equal((await service.confirm(attempt)).replayed, true);
    assert.deepEqual(calls.at(-1), calls.at(-2));
    assert.deepEqual(attempt.body, { ...manifest, confirmed: true, preview_hash: preview.preview_hash });
    assert.equal(calls.at(-1).config.headers['Idempotency-Key'], 'stable-key');
    assert.equal(m.canOpenInitial(true, { opening: { exists: true } }), false);
    assert.equal(m.canConfirmInitial({ can_confirm: true, opening: { exists: true } }, preview), false);
    for (const code of ['CONTROL_DATE_MISSING','OPENING_ALREADY_EXISTS','INVENTORY_NOT_EMPTY']) assert.ok(m.initialBlockers[code]);
    const { InitialPreview, InitialEntries, availableInitialProducts, initialSummary, newInitialRow, addInitialProduct, initialSearchKeyDown, initialSearchSelect, restoreInitialSearch, default: StockInitial } = await server.ssrLoadModule('/src/features/inventory/components/StockInitial.jsx');
    const { Form } = await import('antd');
    const manyProducts = Array.from({ length: 49 }, (_, i) => ({ id: String(i), name: `Producto ${i}`, unit: 'L', enabled: true }));
    const renderEntries = rows => renderToStaticMarkup(React.createElement(Form, { initialValues: { entries: rows } },
      React.createElement(InitialEntries, { products: manyProducts, rows })));
    const empty = renderEntries([]);
    assert.ok(empty.includes('Todavía no agregaste productos'));
    assert.ok(empty.includes('Agregá los productos que tenían existencias al inicio del control.'));
    assert.ok(empty.includes('Buscar producto'));
    assert.ok(!empty.includes('stock-initial-row'));
    assert.equal(availableInitialProducts(manyProducts, []).length, 49);
    const added = [newInitialRow(manyProducts[0])];
    assert.equal(availableInitialProducts(manyProducts, added).length, 48);
    assert.ok(!availableInitialProducts(manyProducts, added).some(p => p.id === '0'));
    assert.equal(initialSummary(added), '1 productos');
    const another = [...added, newInitialRow(manyProducts[0])];
    assert.equal(initialSummary(another), '1 productos · 2 registros');
    assert.equal(availableInitialProducts(manyProducts, another.slice(1)).length, 48);
    assert.equal(availableInitialProducts(manyProducts, another.slice(2)).length, 49);
    const filled = renderEntries(another);
    for (const term of ['Unidad base', 'Otra partida', 'Inventory V1', 'STOCK_INITIAL']) assert.ok(!filled.includes(term));
    const converted = renderEntries([{ ...added[0], quantity: '250', unit: 'mL' }]);
    assert.ok(converted.includes('250 mL'));
    assert.ok(converted.includes('se registrarán 0,25 L'));
    for (const message of Object.values(m.initialBlockers)) assert.ok(!/partida|Inventory V1|STOCK_INITIAL/.test(message));
    assert.ok(filled.includes('Producto 0'));
    assert.equal((filled.match(/class="stock-initial-row"/g) || []).length, 1);
    assert.ok(filled.includes('2 vencimientos'));
    assert.ok(filled.includes('stock-initial-expiry-pill'));
    assert.ok(!filled.includes('Otra cantidad'));
    assert.ok(!filled.includes('Otro vencimiento'));
    const separated = renderEntries([added[0], newInitialRow(manyProducts[1]), added[0]]);
    assert.equal((separated.match(/class="stock-initial-row"/g) || []).length, 2);
    const single = renderEntries(added);
    assert.ok(single.includes('aria-label="Quitar producto"'));
    assert.ok(!single.includes('stock-initial-expiry-pill'));
    assert.ok(single.includes('aria-label="Más acciones de Producto 0"'));
    for (const markup of [single, filled]) {
      assert.ok(markup.includes('ant-btn-dangerous'));
      assert.ok(markup.includes('min-width:40px;min-height:40px'));
      const removeButton = markup.match(/<button[^>]*aria-label="Quitar (?:producto|registro)"[^>]*>[\s\S]*?<\/button>/)?.[0];
      assert.ok(removeButton?.includes('<svg'));
      assert.ok(!removeButton.includes('×'));
    }
    assert.ok(!filled.includes('<table'));
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(`${root}/src/features/inventory/components/StockInitial.jsx`, 'utf8');
    const css = await readFile(`${root}/src/features/inventory/components/StockInitial.css`, 'utf8');
    assert.ok(source.includes('<FocusModal'));
    assert.ok(!source.includes('FormDrawer'));
    assert.ok(!source.includes('entries: catalog.map'));
    assert.ok(css.includes('max-height: 85vh'));
    assert.ok(css.includes('@media (max-width: 767px)'));
    assert.ok(css.includes('overflow-y: auto'));
    assert.ok(css.includes('position: sticky; top: 0; z-index: 2'));
    assert.ok(source.includes('background: token.colorBgElevated'));
    assert.ok(source.includes("label: 'Dividir por vencimiento'"));
    assert.ok(css.includes('background: rgba(135, 174, 206, 0.16)'));
    const groups = await server.ssrLoadModule('/src/features/inventory/stockInitialGroups.mjs');
    const kg = { id: '0', name: 'Finesse', unit: 'kg', enabled: true };
    const march = { product_id: '0', quantity: '1.05', unit: 'kg', expiration_period: dayjs('2027-03-01') };
    const august = { product_id: '0', quantity: '500', unit: 'g', expiration_period: dayjs('2027-08-01') };
    const original = [march, { product_id: '1', quantity: '1', unit: 'L' }];
    const split = groups.replaceInitialProductEntries(original, kg.id, [march, august]);
    assert.equal(original.length, 2); // editor copy cannot mutate the parent on Cancel
    assert.equal(split.length, 3);
    assert.equal(groups.initialProductGroups(split).length, 2);
    assert.deepEqual(groups.initialProductGroups(split)[0].indices, [0, 1]);
    assert.equal(groups.initialProductTotal([march, august], kg), '1.550000');
    assert.equal(groups.initialProductTotal([{ ...march, quantity: '0.1' }, { ...march, quantity: '0.2' }], kg), '0.300000');
    assert.equal(groups.initialProductTotal([{ ...march, quantity: '250', unit: 'cc' }, { ...march, quantity: '0.5', unit: 'L' }], { unit: 'L' }), '0.750000');
    assert.throws(() => groups.validateInitialProductEntries([march, march], kg), /repetidos/);
    assert.throws(() => groups.validateInitialProductEntries([{ ...march, quantity: '0' }], kg), /mayor a cero/);
    assert.throws(() => groups.validateInitialProductEntries([{ ...march, unit: 'L' }], kg), /compatible/);
    assert.doesNotThrow(() => groups.validateInitialProductEntries([march, { ...august, expiration_period: null }], kg));
    const simpleAgain = groups.replaceInitialProductEntries(split, kg.id, [august]);
    assert.equal(groups.initialProductGroups(simpleAgain)[0].indices.length, 1);
    assert.equal(simpleAgain[0].expiration_period.format('MM/YYYY'), '08/2027');
    assert.ok(!renderEntries(simpleAgain).includes('stock-initial-expiry-pill'));
    const groupedMarkup = renderToStaticMarkup(React.createElement(Form, { initialValues: { entries: [march, august] } },
      React.createElement(InitialEntries, { products: [kg], rows: [march, august] })));
    assert.ok(groupedMarkup.includes('1,55 kg'));
    assert.equal((groupedMarkup.match(/class="stock-initial-row"/g) || []).length, 1);
    const flatManifest = m.initialManifest(manifest.date, [march, august], [kg]);
    const groupedManifest = m.initialManifest(manifest.date, split.filter(row => row.product_id === kg.id), [kg]);
    assert.deepEqual(groupedManifest, flatManifest);
    assert.deepEqual(m.confirmationAttempt(groupedManifest, preview, 'same-key'), m.confirmationAttempt(flatManifest, preview, 'same-key'));
    const selection = { current: null }, inserted = [];
    let resets = 0, focuses = 0, prevented = 0, stopped = 0;
    const add = (row, index) => inserted.splice(index, 0, row);
    const commit = () => addInitialProduct(selection, manyProducts, add, () => resets++, () => focuses++);
    const enter = (repeat = false) => initialSearchKeyDown({ key: 'Enter', repeat,
      preventDefault() { prevented++; }, stopPropagation() { stopped++; } }, selection, commit);
    enter();
    assert.equal(inserted.length, 0);
    selection.current = '0'; enter(); enter(); commit();
    assert.equal(inserted.length, 1);
    assert.equal(selection.current, null);
    assert.equal(resets, 1); assert.equal(focuses, 1);
    selection.current = '1'; enter(true);
    assert.equal(inserted.length, 1);
    enter();
    assert.deepEqual(inserted.map(row => row.product_id), ['1', '0']);
    assert.ok(prevented >= 4); assert.ok(stopped >= 2);
    add(newInitialRow(manyProducts[1]), 1);
    assert.deepEqual(inserted.map(row => row.product_id), ['1', '1', '0']);
    const payload = m.initialManifest(manifest.date, inserted.map((row, i) => ({ ...row, quantity: '1', expiration_period: dayjs(`2027-0${i + 1}-01`) })), manyProducts);
    assert.deepEqual(payload.entries.map(row => row.product_id), ['1', '1', '0']);
    assert.equal(payload.entries.length, 3);
    const focusCalls = [];
    restoreInitialSearch({ closest(selector) { assert.equal(selector, '.ant-modal-body'); return { scrollTo(value) { focusCalls.push(value); } }; } },
      { focus(value) { focusCalls.push(value); } });
    assert.deepEqual(focusCalls, [{ top: 0, behavior: 'instant' }, { preventScroll: true }]);
    // Ant Design resolves the highlighted result AFTER key capture, then calls
    // onChange followed by onSelect, all in the same Enter dispatch.
    const pending = { current: false }, current = { current: null }, keyboardRows = [];
    let keyboardResets = 0, keyboardFocuses = 0;
    const commitKeyboard = () => addInitialProduct(current, manyProducts,
      (row, index) => keyboardRows.splice(index, 0, row), () => keyboardResets++, () => keyboardFocuses++);
    const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };
    initialSearchKeyDown(event, current, commitKeyboard, pending);
    assert.equal(keyboardRows.length, 0);
    current.current = '0'; // Select.onChange
    initialSearchSelect('0', pending, current, commitKeyboard); // same Enter, Select.onSelect
    assert.equal(keyboardRows.length, 1);
    assert.equal(current.current, null);
    initialSearchSelect('0', pending, current, commitKeyboard); // duplicate callback
    initialSearchKeyDown({ ...event, repeat: true }, current, commitKeyboard, pending);
    assert.equal(keyboardRows.length, 1);
    assert.equal(keyboardResets, 1); assert.equal(keyboardFocuses, 1);
    initialSearchKeyDown(event, current, commitKeyboard, pending); // no valid option emitted
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(pending.current, false);
    assert.equal(keyboardRows.length, 1);
    initialSearchSelect('1', pending, current, commitKeyboard); // mouse selection must not auto-add
    assert.equal(keyboardRows.length, 1);
    const html = renderToStaticMarkup(React.createElement(InitialPreview, { manifest, preview, products }));
    for (const text of ['Glifosato', '250 cc', '0,25 L', '09/2027', '24/09/2026', '1 productos']) assert.ok(html.includes(text), text);
    assert.equal(renderToStaticMarkup(React.createElement(StockInitial, { user: { custom_permissions: [] }, products, ready: true })), '');
    await build({ root, configFile: false, plugins: [inventoryConversionPlugin()], logLevel: 'error',
      build: { write: false, minify: false, rolldownOptions: { input: `${root}/src/features/inventory/Inventory.jsx` } } });
  } finally { await server.close(); }
});

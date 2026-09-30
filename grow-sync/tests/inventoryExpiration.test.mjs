import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { fileURLToPath } from 'node:url';
import { expirationLabel, expiration, receiptExpirationPayload, batchState } from '../src/features/inventory/inventoryModel.mjs';
import inventoryConversionPlugin from '../vite/inventoryConversionPlugin.mjs';

test('selección mensual: septiembre 2027, cambios de mes/año y vencimiento opcional', () => {
  const selected = dayjs('2027-09-01');
  assert.deepEqual(receiptExpirationPayload(selected), { expiration_year: 2027, expiration_month: 9 });
  assert.deepEqual(receiptExpirationPayload(selected.month(11).year(2028)), { expiration_year: 2028, expiration_month: 12 });
  assert.deepEqual(receiptExpirationPayload(null), { expiration_year: null, expiration_month: null });
  assert.deepEqual(receiptExpirationPayload(undefined), { expiration_year: null, expiration_month: null });
  assert.equal(Object.hasOwn(receiptExpirationPayload(selected), 'expiration_date'), false);
  for (const year of [1999, 2101]) assert.throws(() => receiptExpirationPayload(selected.year(year)));
  for (const year of [2000, 2100]) assert.equal(receiptExpirationPayload(selected.year(year)).expiration_year, year);
});

test('presentación mensual, histórica y ausente; nunca usa adquisición ni fecha efectiva', () => {
  assert.equal(expirationLabel({ expiration_year: 2027, expiration_month: 9, effective_expiration_date: '2027-09-30' }), '09/2027');
  assert.equal(expirationLabel({ expiration_year: 2027, expiration_month: 9, expiration_date: '2027-09-15' }), '09/2027');
  assert.equal(expirationLabel({ expiration_date: '2027-09-15' }), '15/09/2027');
  assert.equal(expirationLabel('2027-09-15'), '15/09/2027');
  assert.equal(expirationLabel(null), 'Sin vencimiento');
  const acquired = { acquisition_date: '2027-09-15' };
  for (const enabled of [true, false]) assert.equal(expirationLabel(expiration(acquired, enabled)), 'Sin vencimiento');
  assert.equal(expirationLabel({ effective_expiration_date: '2027-09-30' }), 'Sin vencimiento');
  assert.equal(expirationLabel(expiration({ next_expiration_year: 2027, next_expiration_month: 9 }, true)), '09/2027');
});

test('estado mensual: vigente durante todo el mes y vencido desde el siguiente', () => {
  const batch = { enabled: true, available_quantity: 1, expiration_year: 2026, expiration_month: 9 };
  assert.equal(batchState(batch, new Date(2026, 8, 30, 23, 59)), 'Disponible');
  assert.equal(batchState(batch, new Date(2026, 9, 1)), 'Vencida');
  assert.equal(batchState({ ...batch, effective_expiration_date: '2026-09-30' }, new Date(2026, 9, 1)), 'Vencida');
  for (const [year, lastDay] of [[2027, 28], [2028, 29]]) {
    const february = { ...batch, expiration_year: year, expiration_month: 2 };
    assert.equal(batchState(february, new Date(year, 1, lastDay, 23, 59)), 'Disponible');
    assert.equal(batchState(february, new Date(year, 2, 1)), 'Vencida');
  }
  assert.equal(batchState({ enabled: true, available_quantity: 1, acquisition_date: '2000-01-01' }), 'Disponible');
});

test('campo Ant Design mensual opcional renderiza 09/2027 y conserva el valor para el payload', async () => {
  const { createServer } = await import('vite');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Form } = await import('antd');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    plugins: [inventoryConversionPlugin()], optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { ReceiptExpirationField } = await server.ssrLoadModule('/src/features/inventory/components/ReceiptModal.jsx');
    const field = ReceiptExpirationField();
    assert.equal(field.props.name, 'expiration_period');
    assert.equal(field.props.rules, undefined);
    const picker = field.props.children;
    assert.equal(picker.props.picker, 'month');
    assert.equal(picker.props.format, 'MM/YYYY');
    assert.equal(picker.props.allowClear, true);
    for (const [value, label, year, month] of [[dayjs('2027-09-01'), '09/2027', 2027, 9], [dayjs('2028-02-01'), '02/2028', 2028, 2], [null, '', null, null]]) {
      const html = renderToStaticMarkup(React.createElement(Form, { initialValues: { expiration_period: value } }, React.createElement(ReceiptExpirationField)));
      assert.ok(html.includes(`value="${label}"`));
      assert.deepEqual(receiptExpirationPayload(value), { expiration_year: year, expiration_month: month });
    }
    // Compile the changed inventory views as well as the form, without a full app build.
    await server.ssrLoadModule('/src/features/inventory/components/ProductDetailDrawer.jsx');
    await server.ssrLoadModule('/src/features/inventory/DisabledInventory.jsx');
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
    try {
      const { default: ProductTable } = await server.ssrLoadModule('/src/features/inventory/components/ProductTable.jsx');
      const { default: ProductListMobile } = await server.ssrLoadModule('/src/features/inventory/components/ProductListMobile.jsx');
      const cases = [
        [{ expiration_year: 2027, expiration_month: 9, effective_expiration_date: '2027-09-30' }, '09/2027'],
        [{ expiration_date: '2027-09-15' }, '15/09/2027'],
        [{ acquisition_date: '2027-09-15' }, 'Sin vencimiento'],
      ];
      const props = { pagination: { current: 1 }, rowKey: p => p.id, formatUnit: u => u };
      const column = ProductTable(props).props.columns.find(c => c.key === 'expiration_date');
      for (const [fields, label] of cases) {
        const product = { id: 'test', name: 'Producto', unit: 'L', available_quantity: 1, ...fields };
        assert.ok(renderToStaticMarkup(column.render(null, product)).includes(label));
        assert.ok(renderToStaticMarkup(React.createElement(ProductListMobile, { ...props, products: [product] })).includes(label));
      }
      assert.ok(column.sorter(cases[1][0], cases[0][0]) < 0);
      assert.ok(column.sorter(cases[2][0], cases[0][0]) > 0);
      // Effective API dates govern comparison, without being used as display values.
      assert.ok(column.sorter({ effective_expiration_date: '2027-09-01' }, cases[1][0]) < 0);
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else delete globalThis.localStorage;
    }
  } finally { await server.close(); }
});

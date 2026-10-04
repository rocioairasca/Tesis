import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import { buildHistoricalPayload, canEditPlanning } from '../src/features/planning/historicalPlanning.mjs';

const row = {
  inventory_impact_mode: 'HISTORICAL_NO_STOCK', status: 'completado', title: 'Antecedente',
  start_at: '2021-02-03T00:00:00Z', end_at: '2021-02-04T00:00:00Z', effective_date: '2021-02-04',
  lots: [{ lot_id: 'lot', sub_lot_id: 'sub', name: 'Lote / Sublote', area_ha: '1.25' }],
  products: [{ id: 'pp', product_id: 'product', name: 'Producto existente', unit: 'kg', amount: '5', actual_amount: '4', usage_id: 'usage' }],
};
const values = () => ({
  title: row.title, description: 'Corregido', responsible_user: 'user',
  date_range: [dayjs('2021-02-03'), dayjs('2021-02-04')], effective_date: dayjs('2021-02-04'),
  historical_lots: [{ area_ha: '1.25' }], products: [{ ...row.products[0] }],
});

test('historical payload uses existing planning product IDs and explicit historical area only', () => {
  const form = values();
  form.products[0] = { planning_product_id: 'tampered', product_id: 'other', unit: 'L', amount: '9', actual_amount: '8' };
  form.historical_lots[0] = { lot_id: 'other', sub_lot_id: 'other', area_ha: '0.75' };
  form.status = 'pendiente'; form.inventory_impact_mode = 'NORMAL';
  const payload = buildHistoricalPayload(row, form);
  assert.deepEqual(payload.products, [{ planning_product_id: 'pp', actual_amount: '8', amount: '9' }]);
  assert.deepEqual(payload.lot_selections, [{ lot_id: 'lot', sub_lot_id: 'sub', area_ha: '0.75' }]);
  assert.deepEqual(Object.keys(payload).sort(), ['title', 'description', 'responsible_user', 'products', 'lot_selections'].sort());
});

test('unchanged dates and areas are omitted so quantity/title edits work with linked cycles', () => {
  const form = values();
  form.historical_lots[0].area_ha = 1.25;
  assert.deepEqual(buildHistoricalPayload(row, form), { title: row.title, description: 'Corregido', responsible_user: 'user' });
  form.date_range[0] = dayjs('2021-02-02');
  form.effective_date = dayjs('2021-02-03');
  const payload = buildHistoricalPayload(row, form);
  assert.equal(payload.start_at, '2021-02-02T00:00:00.000Z');
  assert.equal(payload.effective_date, '2021-02-03');
  assert.equal('end_at' in payload, false);
});

test('missing usages stay read only, NORMAL cannot use historical payload, both permissions are required', () => {
  const missing = { ...row, products: [{ ...row.products[0], usage_id: null, actual_amount: null }] };
  assert.equal('products' in buildHistoricalPayload(missing, values()), false);
  for (const edit of [false, true]) for (const history of [false, true]) {
    assert.equal(canEditPlanning(row, edit, history), edit && history);
    assert.equal(canEditPlanning({ inventory_impact_mode: 'NORMAL' }, edit, history), edit);
  }
  assert.throws(() => buildHistoricalPayload({ ...row, inventory_impact_mode: 'NORMAL' }, values()), /no es histórica/);
});

test('rendered historical form, desktop/mobile permissions, and friendly error integration', async () => {
  const { createServer } = await import('vite');
  const React = await import('react');
  const { Form } = await import('antd');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { default: Fields } = await server.ssrLoadModule('/src/features/planning/components/HistoricalPlanningFields.jsx');
    const html = renderToStaticMarkup(React.createElement(Form, { initialValues: values() },
      React.createElement(Fields, { editing: row, responsibleOptions: [{ value: 'user', label: 'Responsable' }] })));
    for (const label of ['Corrección de antecedente', 'Los cambios no modifican el inventario', 'Superficie histórica', 'Cantidad planificada', 'Cantidad real utilizada', 'Producto existente']) assert.ok(html.includes(label), label);
    assert.ok(html.includes('Agregar producto histórico'));
    assert.ok(html.includes('Productos registrados'));
    assert.ok(!html.includes('Eliminar'));
    assert.match(html, /readonly/i);
    const { getUserFriendlyError } = await server.ssrLoadModule('/src/utils/userFriendlyErrors.js');
    const message = 'El antecedente tiene ciclos vinculados: requiere corrección histórica integral, sin reasignación automática.';
    assert.equal(getUserFriendlyError({ response: { status: 409, data: { message } } }), message);
    assert.ok(!getUserFriendlyError({ response: { status: 500, data: { message: 'SQL constraint violation' } } }).includes('SQL'));
    const source = fs.readFileSync(new URL('../src/features/planning/Planning.jsx', import.meta.url), 'utf8');
    assert.ok(source.indexOf('if (isEditingHistorical)') < source.indexOf('if (isEditingCompleted)'));
    assert.match(source, /api\.patch\(`\/planning\/\$\{getId\(editing\)\}`, historicalPayload\)/);
    assert.match(source, /message: getUserFriendlyError\(e,/);
    assert.match(source, /placement=\{isMobile \? "bottom" : "right"\}/);
    for (const component of ['PlanningTable', 'PlanningListMobile']) {
      for (const history of [false, true]) {
        globalThis.localStorage = { getItem: () => JSON.stringify({ custom_permissions: history ? ['planning.edit', 'history.import'] : ['planning.edit'] }) };
        server.moduleGraph.invalidateAll();
        const { default: View } = await server.ssrLoadModule(`/src/features/planning/components/${component}.jsx`);
        const markup = renderToStaticMarkup(React.createElement(View, { list: [{ ...row, id: 'planning' }], rowKey: r => r.id,
          userIx: {}, cropIx: {}, statusTag: () => 'Completado' }));
        assert.ok(markup.includes('Histórico'));
        assert.equal(markup.includes('Editar'), history);
        assert.ok(!markup.includes('Reabrir planificación'));
      }
    }
  } finally { delete globalThis.localStorage; await server.close(); }
});

test('quantities added without a consumption record remain editable',()=>{
  const historical={...row,products:[{...row.products[0],usage_id:null}]};
  const form=values();form.products[0].actual_amount='4613.05';form.products[0].amount='4613.05';
  assert.deepEqual(buildHistoricalPayload(historical,form).products,[{planning_product_id:'pp',actual_amount:'4613.05',amount:'4613.05'}]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildLotRows, filterLotRows, selectedRow, flattenRows, listRows, overviewMetrics, displayGeometry, lotActions, areaLabel } from '../src/features/lots/lotsOverviewModel.mjs';
import { fixtureLots, fixtureProductive } from './lotsOverview.fixtures.mjs';

test('Lotes: jerarquía vigente preserva padre, sublotes e identidades', () => {
  const original = JSON.stringify(fixtureLots);
  const rows = buildLotRows(fixtureLots, fixtureProductive);
  assert.equal(rows[0].children.length, 2); assert.equal(rows[1].children.length, 0);
  assert.equal(listRows(rows)[0].children, undefined); assert.equal(listRows(rows)[0].divisions.length, 2);
  assert.equal(rows[0].children[0].lot, fixtureLots[0]); assert.equal(rows[0].children[0].area, 19.23);
  assert.deepEqual(rows[0].children[0].crops, ['Maíz']); assert.equal(selectedRow(rows, 'sub:lot-15:15-b').name, '15-B');
  assert.equal(JSON.stringify(fixtureLots), original);
  for (const status of ['draft', 'locked', 'archived']) assert.equal(buildLotRows([{ ...fixtureLots[0], active_layout: { ...fixtureLots[0].active_layout, status } }], fixtureProductive)[0].children.length, 0);
});
test('Lotes: filtros coherentes y selección invisible descartada; cultivo/campaña en la misma unidad', () => {
  const rows = buildLotRows(fixtureLots, fixtureProductive);
  const filtered = filterLotRows(rows, { state: 'enabled', search: '15-a' });
  assert.deepEqual(filtered.map(row => row.name), ['Lote 15']); assert.equal(flattenRows(filtered).length, 3);
  assert.equal(selectedRow(filtered, 'lot:north'), null);
  assert.deepEqual(filterLotRows(rows, { state: 'enabled', crop: 'Soja', campaign: '2026/27' }).map(row => row.name), ['Lote Norte']);
  assert.deepEqual(filterLotRows(rows, { state: 'disabled' }).map(row => row.name), ['Lote Oeste']);
  assert.equal(filterLotRows(rows, { state: 'enabled', divided: 'yes' }).length, 1);
  assert.equal(filterLotRows(rows, { state: 'enabled', search: 'ubicacion' }).length, 1);
});
test('Lotes: superficies existentes sin doble conteo, ausencia y contexto no disponible', () => {
  const rows = buildLotRows(fixtureLots, fixtureProductive);
  const active = rows.filter(row => row.enabled);
  assert.ok(Math.abs(overviewMetrics(active).area - 71.96) < 1e-9);
  assert.equal(areaLabel(overviewMetrics(active).area), '71,96 ha');
  assert.equal(overviewMetrics(active).crops, 2); assert.equal(rows[2].productiveAvailable, false);
  assert.equal(buildLotRows(fixtureLots, {}, false)[0].productiveAvailable, false);
  assert.equal(overviewMetrics(buildLotRows([{ id: 'missing', name: 'Sin área', area: null }])).area, null);
  assert.equal(areaLabel(null), '— ha');
});
test('Lotes: geometrías de consulta no reparan ni redondean ni descartan huecos', () => {
  const geometry = { type: 'Polygon', coordinates: [[[1,1],[4,1],[4,4],[1,1]], [[2,2],[3,2],[3,3],[2,2]]] };
  assert.equal(displayGeometry(geometry), geometry);
  assert.deepEqual(displayGeometry(JSON.stringify({ type: 'Feature', geometry })), geometry);
  assert.deepEqual(displayGeometry(fixtureLots[0].location).coordinates[0][0], [-63.25,-32.41]);
  assert.equal(displayGeometry('{'), null); assert.equal(displayGeometry({ type: 'Polygon', coordinates: [[[200,1],[4,1],[4,4],[200,1]]] }), null);
  assert.equal(displayGeometry({ type: 'Point', coordinates: [0,0] }).type, 'Point');
});
test('Lotes: acciones respetan permisos y estado, sin mutaciones de sublotes', () => {
  const rows = buildLotRows(fixtureLots, fixtureProductive);
  const readonly = { view: true }, editor = { view: true, edit: true, enable: true, disable: true };
  assert.deepEqual(lotActions(rows[0], readonly).filter(a => !a.hidden).map(a => a.key), ['detail']);
  assert.equal(lotActions(rows[2], editor).find(a => a.key === 'edit').disabled, true);
  assert.deepEqual(lotActions(rows[2], editor).filter(a => !a.hidden && !a.disabled).map(a => a.key), ['enable']);
  assert.deepEqual(lotActions(rows[0].children[0], editor).filter(a => !a.hidden).map(a => a.key), ['detail']);
});
test('Lotes: lectura paginada, permisos efectivos, árbol y contexto accesibles', async () => {
  const { createServer } = await import('vite'); const React = await import('react'); const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { readLots } = await server.ssrLoadModule('/src/features/lots/lotsOverviewSource.js');
    const calls = [];
    const client = { get: async (path, config) => { calls.push({ path, config }); return { data: { data: [fixtureLots[config.params.page - 1]], total: 2 } }; } };
    assert.equal((await readLots(client, false)).length, 2); assert.equal(calls[0].path, '/lots'); assert.equal(calls[0].config.params.includeActiveLayout, true); assert.equal(calls[0].config.params.includeDisabled, undefined); assert.equal(calls[1].config.params.page, 2); assert.equal(calls[0].config.params.company_id, undefined);
    calls.length = 0; await readLots(client, true); assert.equal(calls[0].config.params.includeDisabled, true);
    await assert.rejects(readLots({ get: async () => ({ data: {} }) }, false));
    const controller = new AbortController(); controller.abort(); await assert.rejects(readLots(client, false, controller.signal), { name: 'AbortError' });
    const { lotsAccess, default: Overview } = await server.ssrLoadModule('/src/features/lots/LotsOverview.jsx');
    const readonly = lotsAccess({ role: 2, custom_permissions: ['lots.view'] }); assert.equal(readonly.edit, false); assert.equal(readonly.viewDisabled, false); assert.equal(readonly.view, true);
    const { default: Tree } = await server.ssrLoadModule('/src/features/lots/components/LotsOverviewTree.jsx');
    const { default: Context } = await server.ssrLoadModule('/src/features/lots/components/LotOverviewContext.jsx');
    const { MemoryRouter } = await server.ssrLoadModule('/node_modules/react-router-dom/dist/index.mjs');
    const rows = buildLotRows(fixtureLots, fixtureProductive);
    const tree = renderToStaticMarkup(React.createElement(Tree, { rows, selection: rows[0].children[0], expanded: [rows[0].key], onExpand: () => {}, onSelect: () => {} }));
    assert.ok(tree.includes('15-A')); assert.ok(tree.includes('Seleccionado')); assert.ok(tree.includes('role="tree"'));
    const context = renderToStaticMarkup(React.createElement(Context, { row: rows[2], actions: row => lotActions(row, readonly) })); assert.ok(context.includes('Deshabilitado')); assert.ok(context.includes('No disponible')); assert.ok(!context.includes('Habilitar lote'));
    const empty = renderToStaticMarkup(React.createElement(Context, { row: null })); assert.ok(empty.includes('Seleccioná un lote'));
    const overview = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Overview, { user: { role: 0, custom_permissions: ['lots.view'] } })));
    assert.ok(overview.includes('Mapa')); assert.ok(overview.includes('Lista')); assert.ok(overview.includes('Cargando lotes')); assert.ok(!overview.includes('Nuevo lote'));
  } finally { await server.close(); }
});

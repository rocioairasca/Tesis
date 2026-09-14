import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { formatNumber, numberValue, workWindow, workRows, inventoryAlerts, filteredHarvest, readAllPages } from '../src/features/dashboard/dashboardModel.mjs';

test('Dashboard: números argentinos y datos ausentes no se convierten en cero', () => {
  assert.equal(formatNumber(3121382), '3.121.382');
  assert.equal(formatNumber('616.36'), '616,36');
  for (const missing of [null, undefined, '', 'NaN']) { assert.equal(numberValue(missing), null); assert.equal(formatNumber(missing), '—'); }
  assert.equal(numberValue('0'), 0);
});
test('Dashboard: días de planificación, orden y estados efectivos del servidor', () => {
  assert.deepEqual(workWindow('2026-09-28'), { from: '2026-09-28T00:00:00.000Z', to: '2026-10-05T23:59:59.999Z', today: '2026-09-28', end: '2026-10-05' });
  const rows = workRows([
    { id: 3, start_at: '2026-09-14T00:00:00Z', end_at: '2026-09-14T00:00:00Z', status_effective: 'planificado' },
    { id: 2, start_at: '2026-09-13T00:00:00Z', end_at: '2026-09-13T00:00:00Z', status: 'planificado', status_effective: 'en_demora' },
    { id: 1, start_at: '2026-09-12T00:00:00Z', end_at: '2026-09-13T00:00:00Z', status_effective: 'completado' },
  ], '2026-09-13');
  assert.deepEqual(rows.map(row => row.id), [2, 3]);
  assert.equal(rows[0].isToday, true); assert.equal(rows[0].status_effective, 'en_demora'); assert.equal(rows[1].isToday, false);
});
test('Dashboard: alertas legacy/V1, umbral existente y vencimientos sin inventar fechas', () => {
  const legacy = inventoryAlerts([
    { available_quantity: 0, expiration_date: '2025-01-01' },
    { available_quantity: 2, acquisition_date: '2020-01-01' },
    { available_quantity: 10, expiration_date: '2026-09-12' },
    { available_quantity: 10, expiration_date: '2026-09-28T00:00:00.000Z' },
    { available_quantity: 10, expiration_date: '2026-09-29' },
    { available_quantity: null },
    { available_quantity: 0, enabled: false },
  ], false, '2026-09-13');
  assert.deepEqual(legacy, { empty: 1, low: 1, expired: 1, expiring: 1, unknown: 1 });
  const v1 = inventoryAlerts([{ on_hand_quantity: 4, available_quantity: 0, minimum_stock: 3, next_expiration_date: '2026-09-12' }, { on_hand_quantity: 3, minimum_stock: 3, next_expiration_date: '2026-09-13' }], true, '2026-09-13');
  assert.deepEqual(v1, { empty: 0, low: 1, expired: 1, expiring: 1, unknown: 0 });
});
test('Dashboard: ambos gráficos respetan ambos filtros sin reconvertir ni promediar', () => {
  const summary = { total_records: 2, total_production_kg: '1250', total_area_ha: '100', avg_yield_kg_ha: '12.5' };
  const result = filteredHarvest(summary, [{ crop: 'soja', production_kg: '1250', yield_kg_ha: '12.5' }, { crop: 'maíz', production_kg: '500' }], [{ campaign: '2025/26', production_kg: '1250' }, { campaign: '2024/25', production_kg: '900' }], { campaign: '2025/26', crop: ' Soja ', unit: 'tn' });
  assert.equal(result.summary, summary); assert.equal(result.byCrop.length, 1); assert.equal(result.byCampaign.length, 1);
  assert.equal(result.byCrop[0].production_kg, 1250); assert.equal(result.byCrop[0].yield_kg_ha, 12.5);
  assert.equal(filteredHarvest(summary, [], [], {}).byCrop.length, 0);
});
test('Dashboard: listados paginados completos, cancelación y errores parciales', async () => {
  const pages = [];
  const result = await readAllPages(async params => { pages.push(params); return { total: 2, inventory_v1_enabled: true, data: [{ id: params.page }] }; }, { status: 'en_demora' });
  assert.equal(result.data.length, 2); assert.equal(result.inventory_v1_enabled, true); assert.equal(pages[1].page, 2);
  assert.equal(pages[1].status, 'en_demora'); assert.equal(pages[1].pageSize, 1000);
  await assert.rejects(readAllPages(async () => ({ data: [], total: 2 })), /incompleto/);
  await assert.rejects(readAllPages(async () => ({ data: [] })), /incompleta/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readAllPages(() => assert.fail('No debe consultar'), {}, controller.signal), { name: 'AbortError' });
});
test('Dashboard: adaptadores existentes, clima simulado, permisos y estados renderizados', async () => {
  const { createServer } = await import('vite');
  const React = await import('react'); const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { createDashboardSource } = await server.ssrLoadModule('/src/features/dashboard/dashboardSource.js');
    const calls = [];
    const client = { get: async (path, config) => { calls.push({ path, config }); return { data: path === '/stats' ? { kpis: { lots: 7 } } : path === '/weather/latest' ? { temperature: null, id: 61 } : { data: [], total: 0, inventory_v1_enabled: true } }; }, post: async (path, body, config) => { calls.push({ path, body, config }); return { data: { temperature: 0, weather_code: 0 } }; } };
    const harvest = {
      getHarvestFilters: async () => ({ campaigns: [], crops: [] }),
      getHarvestSummary: async params => { calls.push({ summary: params }); return { total_records: 1, total_production_kg: 100 }; },
      getHarvestByCrop: async params => { calls.push({ byCrop: params }); return [{ crop: 'soja', production_kg: 100 }]; },
      getHarvestByCampaign: async params => { calls.push({ byCampaign: params }); return [{ campaign: '2025/26', production_kg: 100 }]; },
    };
    const source = createDashboardSource(client, harvest, () => ({ getCurrentPosition: success => success({ coords: { latitude: -34, longitude: -60 } }) }));
    assert.deepEqual(await source.field({}), { lots: 7 });
    assert.deepEqual(await source.fieldMap({}), { lots:0, area:0, divisions:0, geometries:[], missing:0 });
    const fieldCall = calls.find(call => call.path === '/lots');
    assert.equal(fieldCall.config.params.includeActiveLayout, true);
    assert.equal(fieldCall.config.params.includeDisabled, undefined); await source.delayed({}); await source.work({ today: '2026-09-13' }); await source.inventory({});
    const delayedCall = calls.find(call => call.config?.params?.status === 'en_demora'); assert.equal(delayedCall.config.params.pageSize, 1); assert.equal(delayedCall.config.params.from, undefined);
    for (const call of calls) { assert.equal(call.config.params?.company_id, undefined); assert.equal(call.config.params?.includeDisabled, undefined); }
    await source.production({ filters: { campaign: '2025/26', crop: 'soja', unit: 'qq' } });
    assert.deepEqual(calls.find(call => call.summary).summary, { campaign: '2025/26', crop: 'soja', unit: 'qq' });
    assert.deepEqual(calls.find(call => call.byCrop).byCrop, { campaign: '2025/26', unit: 'qq' });
    assert.deepEqual(calls.find(call => call.byCampaign).byCampaign, { crop: 'soja', unit: 'qq' });
    assert.equal((await source.weather({})).fallback, false);
    assert.deepEqual(calls.find(call => call.path === '/weather/update').config.params, { latitude: -34, longitude: -60 });
    const fallback = await createDashboardSource(client, harvest, () => null).weather({}); assert.equal(fallback.fallback, true);
    const noWeather = await createDashboardSource({ get: async () => ({ data: {} }) }, harvest, () => null).weather({}); assert.equal(noWeather.reading, null);
    const denied = createDashboardSource(client, harvest, () => ({ getCurrentPosition: (success, reject) => reject({ code: 1 }) })); assert.equal((await denied.weather({})).fallback, true);
    const failedUpdate = createDashboardSource({ ...client, post: async () => { throw new Error('Offline'); } }, harvest, () => ({ getCurrentPosition: success => success({ coords: { latitude: 1, longitude: 1 } }) })); assert.equal((await failedUpdate.weather({})).fallback, true);
    const aborted = new AbortController(); aborted.abort(); const before = calls.length;
    await assert.rejects(source.weather({ signal: aborted.signal }), { name: 'AbortError' }); assert.equal(calls.length, before);
    const { dashboardAccess } = await server.ssrLoadModule('/src/features/dashboard/Dashboard.jsx');
    assert.deepEqual(dashboardAccess({ role: 0, custom_permissions: ['inventory.view'] }), { planning: false, inventory: true, field: false, production: false, harvest: false, rain: false });
    assert.equal(dashboardAccess({ role: 1, custom_permissions: [] }).production, true); // Existing stats role rule.
    const { getWeatherPresentation } = await server.ssrLoadModule('/src/features/dashboard/weatherPresentation.jsx');
    assert.equal(getWeatherPresentation({ weather_code: 0, temperature: null }).label, 'Despejado');
    assert.notEqual(getWeatherPresentation({ id: 61 }).label, 'Lluvia leve');
    const { default: View } = await server.ssrLoadModule('/src/features/dashboard/DashboardView.jsx');
    const { MemoryRouter } = await server.ssrLoadModule('/node_modules/react-router-dom/dist/index.mjs');
    const ready = data => ({ status: 'success', data });
    const props = { user: { name: 'Ana' }, today: '2026-09-13', access: dashboardAccess({ role: 2 }), delayed: ready(0), inventory: ready({}), work: ready([]), field: ready({ lots: 0 }), options: ready({ campaigns: [], crops: [] }), production: ready({ summary: { total_records: 0 } }), weather: ready(fallback), filters: { unit: 'kg' }, onFiltersChange: () => {} };
    const render = changes => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(View, { ...props, ...changes })));
    assert.ok(render({ user: { full_name: 'Rocío Airasca' } }).includes('¡Hola, Rocío!'));
    const empty = render({}); assert.ok(empty.includes('No hay cosechas para esta selección')); assert.ok(empty.includes('ubicación no verificada')); assert.ok(!empty.includes('0 mm')); assert.ok(!empty.includes('Lluvia leve'));
    for (const route of ['/inventario', '/planificaciones', '/lotes', '/harvest', '/registro-lluvias']) { if (route !== '/inventario') assert.ok(empty.includes(`href="${route}"`)); }
    const errored = render({ field: { status: 'error', error: new Error('Network Error') }, production: { status: 'loading' } }); assert.ok(!errored.includes('Todavía no hay lotes activos')); assert.ok(errored.includes('Cargando producción'));
    const noArea = render({ production: ready({ summary: { total_records: 1, total_production_kg: 100, total_area_ha: 0, avg_yield_kg_ha: 0 }, byCrop: [], byCampaign: [] }) }); assert.ok(noArea.includes('Requiere superficie cosechada')); assert.ok(!noArea.includes('>0 kg/ha<'));
    const restricted = render({ access: dashboardAccess({ role: 0, custom_permissions: ['inventory.view'] }) }); assert.ok(!restricted.includes('Trabajo de hoy')); assert.ok(!restricted.includes('Producción y cosecha')); assert.ok(!restricted.includes('href="/lotes"'));
  } finally { await server.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { YIELD_UNIT_OPTIONS, convertYield, formatYield, formatProduction, formatArea, harvestStatus, resultParams, parseSurface, recordsFilterFor,
  surfaceOptionsFromLots, mergeOptions, treeRows, unclassifiedNote, resultLabel } from '../src/features/harvest/harvestResults.mjs';

test('unidades de rendimiento: solo presentación, kg/ha es la base', () => {
  assert.deepEqual(YIELD_UNIT_OPTIONS.map(o => o.value), ['kg', 'qq', 'tn']);
  assert.equal(convertYield('8931.19', 'kg'), 8931.19);
  assert.equal(convertYield('8931.19', 'qq'), 89.3119);
  assert.equal(convertYield('8931.19', 'tn'), 8.93119);
  assert.equal(convertYield(null, 'tn'), null); // unknown is never zero
  assert.equal(formatYield('8931.19', 'qq'), '89,31 qq/ha');
  assert.equal(formatYield('8931.19', 'tn'), '8,93 tn/ha');
  assert.equal(formatYield('8931.19', 'kg'), '8.931,19 kg/ha');
  assert.equal(formatYield('8000', 'kg'), '8.000 kg/ha'); // integers never show .00
  assert.equal(formatYield('8000', 'tn'), '8 tn/ha');
  assert.equal(formatYield(null), '—');
  assert.equal(formatYield('8931.19', 'zzz'), '8.931,19 kg/ha'); // unknown unit falls back to the base unit
  assert.equal(formatYield('1234.5', 'kg', { withUnit: false }), '1.234,5');
});

test('producción y superficie: pendiente y máximo 2 decimales', () => {
  assert.equal(formatProduction(null), 'Pendiente');
  assert.equal(formatProduction('610000.00'), '610.000 kg');
  assert.equal(formatProduction('0.00'), '0 kg'); // an explicit zero is not "pending"
  assert.equal(formatArea('68.30'), '68,3 ha');
  assert.equal(formatArea('68.299'), '68,3 ha');
  assert.equal(formatArea(null), '—');
});

test('estado de cosecha: etiquetas y valor desconocido', () => {
  assert.equal(harvestStatus('in_progress').label, 'En curso');
  assert.equal(harvestStatus('closed').label, 'Finalizada');
  assert.equal(harvestStatus('not_started').label, 'Sin cosecha');
  assert.equal(harvestStatus(null), null);
});

test('filtros compartidos → parámetros de la API; sin unidades ni datos económicos', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  assert.deepEqual(resultParams({ campaign: 'c1', crop: 'Soja', surface: `sub:${id}`, search: ' t4 ' }, { page: 2, pageSize: 25 }),
    { page: 2, pageSize: 25, sub_lot_id: id, campaign: 'c1', crop: 'Soja', search: 't4' });
  assert.deepEqual(resultParams({}), { page: 1, pageSize: 25 });
  assert.deepEqual(parseSurface(`lot:${id}`), { lot_id: id });
  assert.deepEqual(parseSurface('lot:no-es-uuid'), {});
  assert.deepEqual(parseSurface(undefined), {});
  assert.ok(!Object.keys(resultParams({ campaign: 'c', state: 'all', origin: 'historical' })).some(k => ['state', 'origin', 'unit'].includes(k)));
});

test('"Ver los N registros": filtro exacto por ids de la clave', () => {
  const parent = { lot: { id: 'l', name: 'T4' }, sub_lot: null, campaign: { id: 'c' }, crop: { id: 'k', name: 'Soja' } };
  assert.deepEqual(recordsFilterFor(parent), { campaign_id: 'c', crop_id: 'k', lot_id: 'l', label: 'T4 · Soja' });
  const child = { ...parent, sub_lot: { id: 's', name: 'Norte' } };
  assert.deepEqual(recordsFilterFor(child), { campaign_id: 'c', crop_id: 'k', lot_id: 'l', sub_lot_id: 's', label: 'T4 · Norte · Soja' });
  assert.equal(resultLabel(child), 'T4 · Norte · Soja');
});

test('opciones de lote/subdivisión, mezcla sin duplicados y filas sin expansor vacío', () => {
  const options = surfaceOptionsFromLots([{ id: '1', name: 'T4', active_layout: { sub_lots: [{ id: '9', name: 'Norte' }] } }, { id: '2', name: 'T5' }]);
  assert.deepEqual(options.map(o => o.value), ['lot:1', 'sub:9', 'lot:2']);
  assert.deepEqual(options[1], { value: 'sub:9', label: 'T4 · Norte' });
  assert.equal(mergeOptions(options, [{ value: 'lot:1', label: 'Otro' }, { value: 'lot:3', label: 'T6' }]).length, 4);
  const rows = treeRows([{ key: 'a', children: [] }, { key: 'b', children: [{ key: 'c' }] }]);
  assert.equal('children' in rows[0], false);
  assert.equal(rows[1].children.length, 1);
});

test('registros no clasificados: mensaje solo cuando corresponde', () => {
  assert.equal(unclassifiedNote({ unclassified: { records: 0 } }), null);
  assert.match(unclassifiedNote({ unclassified: { records: 1 } }), /1 cosecha no se puede clasificar/);
  assert.match(unclassifiedNote({ unclassified: { records: 3 } }), /3 cosechas no se pueden clasificar.*suposición/);
});

// ---- FIN-01B: real costs (known floor, never a total) ---------------------------------------------------------------
import { formatUsd, formatKnownCost, formatCostPerHa, formatCostPerTn, costStatus, hasKnownCost, hasCostAccess, resultKeyParams, sameResult, costDisclaimer, provisionalNote } from '../src/features/harvest/harvestResults.mjs';

test('USD: máximo 2 decimales (half up sobre enteros), enteros sin ,00, separador de miles', () => {
  assert.equal(formatUsd('5420.000000'), 'USD 5.420');
  assert.equal(formatUsd('99.449541'), 'USD 99,45');
  assert.equal(formatUsd('12.431193'), 'USD 12,43');
  assert.equal(formatUsd('0.000000'), 'USD 0');            // a confirmed zero is a known amount
  assert.equal(formatUsd('0.005000'), 'USD 0,01');          // half up, no float artifacts
  assert.equal(formatUsd('1234567.995'), 'USD 1.234.568');
  assert.equal(formatUsd(null), '—');                       // NULL is never zero
  assert.equal(formatUsd(undefined), '—');
  assert.equal(formatUsd('abc'), '—');
});

test('costos conocidos, relaciones mínimas con ≥ y provisorio; Pendiente sin importes', () => {
  const known = { status: 'partial', known_total_usd: '5420.000000', per_ha_usd: '99.449541', per_tn_usd: '12.431193', is_minimum: true, is_provisional: true, pending_lines: 1 };
  assert.equal(formatKnownCost(known), 'USD 5.420 conocidos');
  assert.equal(formatCostPerHa(known), '≥ USD 99,45/ha');
  assert.equal(formatCostPerTn(known), '≥ USD 12,43/t');
  assert.equal(formatKnownCost({ known_total_usd: '0.000000' }), 'USD 0 conocidos');
  const pending = { status: 'pending', known_total_usd: null, per_ha_usd: null, per_tn_usd: null, is_minimum: false };
  assert.equal(formatKnownCost(pending), 'Pendiente');
  assert.equal(formatCostPerHa(pending), '—'); assert.equal(formatCostPerTn(pending), '—');
  assert.equal(formatCostPerTn({ ...known, per_tn_usd: null }), '—'); // no harvest: no ratio
  assert.equal(formatCostPerHa({ ...known, is_minimum: false }), 'USD 99,45/ha');
  assert.equal(hasKnownCost(known), true); assert.equal(hasKnownCost(pending), false); assert.equal(hasKnownCost(null), false);
});

test('estado económico: Pendiente, Parcial y (FIN-01C) Completo solo si el servidor lo declara', () => {
  assert.equal(costStatus({ status: 'pending' }).label, 'Pendiente');
  assert.equal(costStatus({ status: 'partial' }).label, 'Parcial');
  assert.equal(costStatus({ status: 'complete' }).label, 'Completo');   // FIN-01C: explicit declaration made by the server
  assert.equal(costStatus({ status: 'anything-else' }), null);
  assert.equal(costStatus(null), null);
});

test('acceso económico viene del servidor y la clave del resultado es exacta', () => {
  assert.equal(hasCostAccess({ summary: { cost_access: true } }), true);
  assert.equal(hasCostAccess({ summary: { cost_access: false } }), false);
  assert.equal(hasCostAccess({ summary: {} }), false);
  assert.equal(hasCostAccess(null), false);
  const row = { lot: { id: 'l' }, sub_lot: { id: 's' }, campaign: { id: 'c' }, crop: { id: 'k' } };
  assert.deepEqual(resultKeyParams(row), { campaign_id: 'c', crop_id: 'k', lot_id: 'l', sub_lot_id: 's' });
  assert.deepEqual(resultKeyParams({ ...row, sub_lot: null }), { campaign_id: 'c', crop_id: 'k', lot_id: 'l' });
  assert.equal(sameResult(row, resultKeyParams(row)), true);
  assert.equal(sameResult({ ...row, sub_lot: null }, resultKeyParams(row)), false);
  assert.equal(sameResult(row, null), false);
  assert.match(costDisclaimer, /Pueden existir otros gastos aún no imputados/); assert.match(provisionalNote, /provisional/);
});

// ---- FIN-01C: additional expenses and completeness helpers ----
import { COST_CATEGORIES, buildCostPayload, categoryLabel, blockerText, percentUnits, percentsSumToHundred, revisedBy } from '../src/features/harvest/harvestResults.mjs';

test('categorías cerradas en español', () => {
  assert.deepEqual(COST_CATEGORIES.map(item => item.label), ['Semilla', 'Contratista', 'Labor', 'Combustible / maquinaria', 'Alquiler', 'Flete', 'Secado', 'Otro']);
  assert.equal(categoryLabel('fuel_machinery'), 'Combustible / maquinaria');
});

test('Completo: sin ≥ y costo/tn provisional solo mientras la cosecha no cierra', () => {
  const complete = { status: 'complete', is_minimum: false, is_provisional: true, per_tn_usd: '14.000000', per_ha_usd: '20.497802' };
  assert.equal(costStatus(complete).label, 'Completo');
  assert.equal(formatCostPerTn(complete), 'USD 14/t · prov.');
  assert.equal(formatCostPerHa(complete), 'USD 20,50/ha');
  assert.equal(formatCostPerTn({ ...complete, is_provisional: false }), 'USD 14/t');
  assert.equal(formatCostPerTn({ status: 'partial', is_minimum: true, is_provisional: true, per_tn_usd: '14.000000' }), '≥ USD 14/t');
});

test('porcentajes exactos sin flotantes y bloqueos legibles', () => {
  assert.equal(percentUnits('33.3333'), 333333); assert.equal(percentUnits('100'), 1000000); assert.equal(percentUnits('abc'), null);
  assert.ok(percentsSumToHundred(['33.3333', '33.3333', '33.3334']));
  assert.ok(!percentsSumToHundred(['60', '30'])); assert.ok(!percentsSumToHundred([]));
  assert.deepEqual(blockerText(['pending_entries']), ['Hay gastos pendientes de cotización.']);
  assert.equal(revisedBy({ declared_by: 'Ana Pérez', declared_at: '2027-03-05T12:00:00Z' }), 'Revisado por Ana Pérez · 05/03/2027');
});

test('payload del gasto: USD sin FX, ARS con FX en la fecha de pago, nunca empresa ni actor', () => {
  const base = { campaign_id: 'c', crop_id: 'k', category: 'seed', description: ' Semilla ', expense_date: '2027-01-05', amount: '1000,5', currency: 'USD', scope: 'lots', method: 'area_proportional',
    targets: [{ lot_id: 'l', sub_lot_id: '' }], payment_date: '', fx_rate: '', fx_source: '' };
  const usd = buildCostPayload(base);
  assert.equal(usd.amount, '1000.5'); assert.equal(usd.description, 'Semilla'); assert.ok(!('fx_rate' in usd) && !('company_id' in usd));
  assert.deepEqual(usd.destination, { scope: 'lots', crop_id: 'k', method: 'area_proportional', targets: [{ lot_id: 'l', sub_lot_id: null }] });
  const ars = buildCostPayload({ ...base, currency: 'ARS', payment_date: '2027-01-06', fx_rate: '1000,5', fx_source: 'BCRA' });
  assert.deepEqual([ars.payment_date, ars.fx_rate, ars.fx_date], ['2027-01-06', '1000.5', '2027-01-06']);
  const pending = buildCostPayload({ ...base, currency: 'ARS' });
  assert.deepEqual([pending.fx_rate, pending.fx_date, pending.payment_date], [null, null, null]);
  const campaign = buildCostPayload({ ...base, scope: 'campaign', method: 'manual_percent' });
  assert.deepEqual(campaign.destination, { scope: 'campaign', crop_id: 'k', method: 'area_proportional' });
  const manual = buildCostPayload({ ...base, method: 'manual_percent', targets: [{ lot_id: 'l', sub_lot_id: 's', percent: '100' }] });
  assert.deepEqual(manual.destination.targets, [{ lot_id: 'l', sub_lot_id: 's', percent: '100' }]);
});

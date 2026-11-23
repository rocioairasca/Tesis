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

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialLotViewport} from '../src/features/lots/lotsMapViewport.mjs';
import {buildLotRows,filterLotRows,selectedRow,flattenRows} from '../src/features/lots/lotsOverviewModel.mjs';
import {geometryBounds} from '../src/utils/mapGeometry.mjs';
import {fixtureLots} from './lotsOverview.fixtures.mjs';
const far={id:'far',name:'Lote distante',enabled:true,location:[[{lng:-58,lat:-28},{lng:-57.99,lat:-28},{lng:-57.99,lat:-27.99},{lng:-58,lat:-28}]]};
test('encuadre inicial prioriza mayoría cercana sin eliminar el lote distante',()=>{
 const rows=buildLotRows([...fixtureLots.filter(l=>l.enabled),far]),before=JSON.stringify(rows);
 const result=initialLotViewport(rows);assert.equal(result.omittedCount,1);assert.equal(result.bounds.east,-63.233);
 assert.equal(selectedRow(rows,'lot:far').geometry.coordinates[0][0][0],-58);
 assert.equal(geometryBounds(flattenRows(rows).map(r=>r.geometry)).east,-57.99);
 assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(initialLotViewport([...rows].reverse()),result);
});
test('un filtro por lote distante lo encuadra; vacío no inventa región',()=>{
 const rows=buildLotRows([...fixtureLots,far]);const only=filterLotRows(rows,{state:'enabled',search:'distante'});
 assert.equal(initialLotViewport(only).bounds.west,-58);assert.equal(initialLotViewport(only).omittedCount,0);
 assert.deepEqual(initialLotViewport([]),{bounds:null,omittedCount:0});
});
test('sin mayoría clara no excluye lotes arbitrariamente y divisiones no sesgan conteo',()=>{
 const rows=buildLotRows([fixtureLots[0],far]);assert.equal(initialLotViewport(rows).omittedCount,0);
 const nearby=buildLotRows(fixtureLots.filter(l=>l.enabled));assert.equal(initialLotViewport(nearby).omittedCount,0);
});

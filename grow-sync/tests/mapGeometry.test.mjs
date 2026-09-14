import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayGeometry, geometryBounds, leafletBounds, geometryPolygons, geometryFeatures } from '../src/utils/mapGeometry.mjs';
import { buildLotRows, filterLotRows, flattenRows, selectedRow } from '../src/features/lots/lotsOverviewModel.mjs';
import { fieldOverview } from '../src/features/dashboard/fieldOverview.mjs';
import { projectField } from '../src/features/dashboard/staticFieldGeometry.mjs';
import { fixtureLots } from './lotsOverview.fixtures.mjs';
const open = [{lat:-32,lng:-63},{lat:-32,lng:-62.99},{lat:-31.99,lng:-62.99}];

test('compatibilidad legacy: triángulos abiertos y números en texto sin mutar el origen', () => {
  for (const ring of [open,open.map(({lat,lng})=>({lat:String(lat),lng:String(lng)}))]) {
    const value = [ring], before = JSON.stringify(value), g = displayGeometry(value);
    assert.deepEqual(g.coordinates[0], [[-63,-32],[-62.99,-32],[-62.99,-31.99],[-63,-32]]);
    assert.deepEqual(displayGeometry(JSON.stringify(value)),g);
    assert.equal(JSON.stringify(value),before);
    assert.equal(projectField([g]).count,1);
  }
});
test('inválidos/vacíos no arrojan excepciones ni inventan bounds', () => {
  for (const value of [null, '', '{', [], [[]], [[null,null,null,null]], [[{}, {}, {}]], [[{lat:'',lng:0},...open]], {type:'Polygon',coordinates:null}, {type:'MultiPolygon',coordinates:{}}, {type:'Polygon',coordinates:[[[0,0],[1,1],[2,2],[0,0]]]}, {type:'Polygon',coordinates:[[[0,0],[1,0],[1,1]]]}]) {
    assert.equal(displayGeometry(value),null);
    assert.equal(geometryBounds([value]),null);
  }
  assert.equal(leafletBounds(null),null);
  assert.deepEqual(geometryFeatures([null]),{type:'FeatureCollection',features:[]});
});
test('Polygon/MultiPolygon/Feature conservan huecos y orden lng-lat', () => {
  const g = displayGeometry([open]);
  const hole = [[-62.999,-31.999],[-62.998,-31.999],[-62.998,-31.998],[-62.999,-31.999]];
  const multi = {type:'MultiPolygon',coordinates:[[g.coordinates[0],hole],g.coordinates]};
  assert.equal(displayGeometry(multi),multi);
  assert.deepEqual(geometryPolygons({type:'Feature',geometry:multi}),multi.coordinates);
  assert.deepEqual(leafletBounds(geometryBounds([multi])),[[-32,-63],[-31.99,-62.99]]);
  assert.equal(geometryFeatures([multi,null]).features.length,1);
});
test('bounds combinan todos los lotes y sublotes vigentes, filtros y selección coherentes', () => {
  const rows = buildLotRows(fixtureLots);
  const active = filterLotRows(rows,{state:'enabled'});
  assert.deepEqual(geometryBounds(flattenRows(active).map(r=>r.geometry)),{west:-63.25,south:-32.41,east:-63.233,north:-32.401});
  const only = filterLotRows(rows,{state:'enabled',search:'norte'});
  assert.equal(selectedRow(only,'sub:lot-15:15-a'),null);
  assert.deepEqual(geometryBounds(flattenRows(only).map(r=>r.geometry)),{west:-63.239,south:-32.407,east:-63.233,north:-32.401});
  for(const status of ['draft','locked','archived']) assert.equal(buildLotRows([{...fixtureLots[0],active_layout:{...fixtureLots[0].active_layout,status}}])[0].children.length,0);
});
test('sublotes válidos conservan bounds si el padre no tiene ubicación', () => {
  const rows=buildLotRows([{...fixtureLots[0],location:null}]);
  assert.equal(rows[0].geometry,null);
  assert.deepEqual(geometryBounds(flattenRows(rows).map(r=>r.geometry)),{west:-63.25,south:-32.41,east:-63.242,north:-32.402});
});
test('Dashboard y Lotes comparten interpretación, incluso si geom inválido tiene location válida', () => {
  const lots=[{id:'legacy',enabled:true,geom:'invalid',location:JSON.stringify([open])}];
  const rows=buildLotRows(lots), field=fieldOverview(lots);
  assert.deepEqual(field.geometries,[rows[0].geometry]);
  assert.equal(field.missing,0);
  assert.equal(projectField(field.geometries).count,1);
  assert.equal(fieldOverview([{id:1,location:[[null,null,null,null]]}]).missing,1);
});

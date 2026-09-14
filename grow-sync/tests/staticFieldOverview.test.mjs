import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectField } from '../src/features/dashboard/staticFieldGeometry.mjs';
const polygon = (x,y) => ({type:'Polygon',coordinates:[[[x,y],[x+.01,y],[x+.01,y+.01],[x,y+.01],[x,y]]]});
test('Field SVG: bounds combinados, norte arriba, proporciones y sin mutar coordenadas',()=>{
  const shapes=[polygon(-64,-33),polygon(-63.98,-32.98)];const before=JSON.stringify(shapes);
  for(const width of [240,640,900]) {
    const result=projectField(shapes,width,160);assert.equal(result.count,2);
    const points=result.paths.flatMap(path=>[...path.matchAll(/([\d.]+),([\d.]+)/g)].map(match=>[Number(match[1]),Number(match[2])]));
    assert.ok(points.every(([x,y])=>x>=15.999&&x<=width-15.999&&y>=15.999&&y<=144.001));
    assert.ok(!result.paths.join('').includes('NaN'));
    assert.ok(Number(result.paths[1].match(/^M([\d.]+)/)[1]) > Number(result.paths[0].match(/^M([\d.]+)/)[1]));
  }
  assert.equal(JSON.stringify(shapes),before);
});
test('Field SVG: preserva huecos y piezas de MultiPolygon',()=>{
  const outer=polygon(-64,-33),hole=polygon(-63.998,-32.998).coordinates[0];
  const result=projectField([{type:'MultiPolygon',coordinates:[[outer.coordinates[0],hole],polygon(-63,-32).coordinates]}]);
  assert.equal(result.count,1);assert.equal((result.paths[0].match(/M/g)||[]).length,3);
});
test('Field SVG: geometrías ausentes, inválidas o degeneradas no generan vista regional por defecto',()=>{
  for(const shapes of [[],[null],[{type:'Point',coordinates:[-64,-33]}],[{type:'Polygon',coordinates:[[[0,0],[1,1],[2,2],[0,0]]]}],[{type:'Polygon',coordinates:[[[NaN,0],[1,0],[1,1],[NaN,0]]]}]]) assert.deepEqual(projectField(shapes),{paths:[],count:0});
});

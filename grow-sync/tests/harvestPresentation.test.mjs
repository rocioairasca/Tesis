import test from 'node:test';
import assert from 'node:assert/strict';
import { authorLabel, campaignLabel, surfaceLabel, filterHarvestRows, readHarvestPages, harvestGeometry } from '../src/features/harvest/harvestPresentation.mjs';
import { campaignChartRows, yieldChartRows } from '../src/features/dashboard/chartPresentation.mjs';
const rows = [{id:1,lot_id:'lot',lot_name:'Lote 15',sub_lot_id:'sub',sub_lot_name:'Lote 15-A',crop_name:'Maíz',campaign_name:'Gruesa',registered_retroactively:true},{id:2,lot_id:'lot',lot_name:'Lote 15',crop_name:'Soja',registered_retroactively:false},{id:3,lot_id:'lot',lot_name:'Lote 15',sub_lot_id:'sub',sub_lot_name:'Lote 15-A',crop_name:'Maíz'}];
test('autor: nombre, email y fallback; nunca UUID',()=>{
 const record={created_by:'d35f3c58-1111-4444-aaaa-abc123456789'};
 assert.equal(authorLabel(record),'No informado');
 assert.equal(authorLabel(record,[null,{id:record.created_by,email:'ana@example.com'}]),'ana@example.com');
 assert.equal(authorLabel(record,[{id:record.created_by,full_name:'Ana Pérez',email:'ana@example.com'}]),'Ana Pérez');
});
test('unidad efectiva primero, campaña real sin inventar año',()=>{
 assert.equal(surfaceLabel(rows[0]),'Lote 15-A');assert.equal(surfaceLabel(rows[1]),'Lote 15');
 assert.equal(campaignLabel({...rows[0],campaign:'2026/27'}),'Gruesa');
 assert.equal(campaignChartRows([{campaign:'Gruesa'}]).chronological,false);
 assert.equal(yieldChartRows([{area_ha:2,yield_kg_ha:123.45}])[0].chartYield,123.45);
});
test('búsqueda integral, acentos y cosechas parciales repetidas conservadas',()=>{
 assert.deepEqual(filterHarvestRows(rows,{search:'maiz'}).map(row=>row.id),[1,3]);
 assert.deepEqual(filterHarvestRows(rows,{surface:'sub:sub'}).map(row=>row.id),[1,3]);
 assert.equal(filterHarvestRows(rows,{origin:'unknown'}).length,1);
 assert.equal(filterHarvestRows([],{search:'maiz'}).length,0);
});
test('búsqueda incluye otras páginas y falla ante respuesta truncada',async()=>{
 const result=await readHarvestPages(async({page})=>({data:[rows[page-1]],pagination:{total:3}}));
 assert.equal(result.length,3);
 assert.equal(filterHarvestRows(result,{origin:'unknown'})[0].id,3);
 await assert.rejects(readHarvestPages(async()=>({data:[],pagination:{total:2}})),/incompleto/);
});
test('geometría exacta: sublote faltante no usa lote padre',()=>{
 const geom={type:'Polygon',coordinates:[]};
 const lots=[{id:'lot',geom,active_layout:{sub_lots:[{id:'sub',geom}]}}];
 assert.equal(harvestGeometry(rows[0],lots),geom);
 assert.equal(harvestGeometry({...rows[0],sub_lot_id:'old'},lots),null);
 assert.equal(harvestGeometry(rows[1],lots),geom);
});

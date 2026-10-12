import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FIELD_CONTEXT_OPTIONS,cropRequired,contextCropLabel,fieldSituation} from '../src/features/planning/fieldContext.mjs';
import {getCropDisplayName,getPlanningContextLabel,getPlanningDisplayName,getPlanningEventLabel} from '../src/features/planning/planningDisplay.js';
import fs from 'node:fs';
test('labels and crop requirement match the field situation',()=>{
 assert.deepEqual(FIELD_CONTEXT_OPTIONS.map(o=>o.label),['Cultivo implantado','Rastrojo','Barbecho','Pre-siembra','Otro']);
 for(const c of ['growing_crop','stubble'])assert.equal(cropRequired('fumigacion',c),true);
 for(const c of ['fallow','pre_sowing','other'])assert.equal(cropRequired('fumigacion',c),false);
 assert.equal(cropRequired('siembra','fallow'),true);assert.equal(cropRequired('fumigacion',null),true);
 assert.equal(contextCropLabel('stubble'),'Rastrojo de');assert.equal(contextCropLabel('pre_sowing'),'Cultivo previsto');
});
test('crop names and compact context remain separate in display names and events',()=>{
 const row={activity_type:'fumigacion',field_context:'stubble',crop_name:'Maíz',lots:[]};
 assert.equal(fieldSituation(row),'Rastrojo de Maíz');assert.equal(getPlanningDisplayName(row),'Maíz - Fumigación');
 assert.equal(getPlanningEventLabel(row),'Maíz');
 assert.equal(fieldSituation({...row,field_context:'growing_crop',crop_name:'Trigo'}),'Cultivo implantado: Trigo');
 assert.equal(fieldSituation({field_context:'fallow'}),'Barbecho');assert.equal(fieldSituation({field_context:'pre_sowing'}),'Pre-siembra');
 assert.equal(getPlanningDisplayName({...row,field_context:null}),'Maíz - Fumigación');
 assert.equal(getPlanningDisplayName({...row,activity_type:'siembra'}),'Maíz - Siembra');
 const source=fs.readFileSync(new URL('../src/features/planning/Planning.jsx',import.meta.url),'utf8');
 assert.match(source,/label="Situación del lote"/);assert.match(source,/label=\{contextCropLabel/);assert.match(source,/field_context: row.field_context/);
});

for(const [context,label] of [['growing_crop','Implantado'],['stubble','Rastrojo'],['pre_sowing','Pre-siembra'],['fallow','Barbecho'],['other','Otro']]) {
 test(`crop column contains only the crop name for ${context}`,()=>{
  for(const crop of ['Trigo','Maíz','Soja','Cebada']) {
   const row={activity_type:'fumigacion',field_context:context,crop_id:'crop',crop_name:crop,lots:[]};
   const before=structuredClone(row);
   assert.equal(getCropDisplayName(row),crop);
   assert.equal(getPlanningContextLabel(row),label);
   assert.equal(getPlanningDisplayName(row),`${crop} - Fumigación`);
   assert.equal(getPlanningEventLabel(row),crop);
   assert.equal(getCropDisplayName({...row,crop_name:null},{crop}),crop);
   assert.deepEqual(row,before);
  }
 });
}

test('missing crop is a dash in the crop column, with independent context and event fallback',()=>{
 const row={activity_type:'fumigacion',field_context:'fallow',title:'Trabajo sin cultivo',lots:[{lot_name:'Lote T3'}]};
 assert.equal(getCropDisplayName(row),'—');assert.equal(getPlanningContextLabel(row),'Barbecho');
 assert.equal(getPlanningDisplayName(row),'Barbecho - Fumigación');
 assert.equal(getPlanningEventLabel(row),'Barbecho · Lote T3');
 assert.equal(getPlanningContextLabel({...row,field_context:null}),null);
 assert.equal(getPlanningContextLabel({...row,activity_type:'siembra'}),null);
 assert.equal(getCropDisplayName({crop_id:'unknown',title:'Actividad histórica'}),'—');
 assert.equal(getPlanningDisplayName({activity_type:'riego',title:'Riego especial'}),'Riego especial');
});

test('table uses crop-only label; mobile, calendar popover and detail display context separately',()=>{
 const read=file=>fs.readFileSync(new URL('../src/features/planning/'+file,import.meta.url),'utf8');
 const table=read('components/PlanningTable.jsx');
 const cropColumn=table.slice(table.indexOf('title: "Cultivo"'),table.indexOf('title: "Actividad"'));
 assert.match(cropColumn,/getCropDisplayName/);assert.doesNotMatch(cropColumn,/fieldSituation|getPlanningContextLabel/);
 const mobile=read('components/PlanningListMobile.jsx');
 assert.match(mobile,/<h3>\{getPlanningDisplayName\(r, cropIx\)\}<\/h3>/);
 assert.match(mobile,/getPlanningContextLabel\(r\) && <p/);
 const planning=read('Planning.jsx');
 assert.match(planning,/<Descriptions.Item label="Cultivo">\{getCropDisplayName\(viewing, cropIx\)\}/);
 assert.match(planning,/label="Situación del lote">\{getPlanningContextLabel\(viewing\)\}/);
 assert.match(planning,/getPlanningContextLabel\(ev\) && <div/);
});
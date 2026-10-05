import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FIELD_CONTEXT_OPTIONS,cropRequired,contextCropLabel,fieldSituation} from '../src/features/planning/fieldContext.mjs';
import {getPlanningDisplayName,getPlanningEventLabel} from '../src/features/planning/planningDisplay.js';
import fs from 'node:fs';
test('labels and crop requirement match the field situation',()=>{
 assert.deepEqual(FIELD_CONTEXT_OPTIONS.map(o=>o.label),['Cultivo implantado','Rastrojo','Barbecho','Pre-siembra','Otro']);
 for(const c of ['growing_crop','stubble'])assert.equal(cropRequired('fumigacion',c),true);
 for(const c of ['fallow','pre_sowing','other'])assert.equal(cropRequired('fumigacion',c),false);
 assert.equal(cropRequired('siembra','fallow'),true);assert.equal(cropRequired('fumigacion',null),true);
 assert.equal(contextCropLabel('stubble'),'Rastrojo de');assert.equal(contextCropLabel('pre_sowing'),'Cultivo previsto');
});
test('detail, list and calendar show rastrojo without implying a growing crop; legacy stays unchanged',()=>{
 const row={activity_type:'fumigacion',field_context:'stubble',crop_name:'Maíz',lots:[]};
 assert.equal(fieldSituation(row),'Rastrojo de Maíz');assert.equal(getPlanningDisplayName(row),'Rastrojo de Maíz - Fumigación');
 assert.equal(getPlanningEventLabel(row),'Rastrojo de Maíz');
 assert.equal(fieldSituation({...row,field_context:'growing_crop',crop_name:'Trigo'}),'Cultivo implantado: Trigo');
 assert.equal(fieldSituation({field_context:'fallow'}),'Barbecho');assert.equal(fieldSituation({field_context:'pre_sowing'}),'Pre-siembra');
 assert.equal(getPlanningDisplayName({...row,field_context:null}),'Maíz - Fumigación');
 assert.equal(getPlanningDisplayName({...row,activity_type:'siembra'}),'Maíz - Siembra');
 const source=fs.readFileSync(new URL('../src/features/planning/Planning.jsx',import.meta.url),'utf8');
 assert.match(source,/label="Situación del lote"/);assert.match(source,/label=\{contextCropLabel/);assert.match(source,/field_context: row.field_context/);
});

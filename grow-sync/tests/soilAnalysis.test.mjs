import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {extractionValues,extractionMessages,reportPayload,resultText,editedResult,depthText,highlights,emptySample,historyRows,safePdfUrl,validatePdf,MAX_PDF_BYTES} from '../src/features/lots/soilAnalysis/soilAnalysisModel.mjs';
const sample={id:'sample',lot_id:'lot',sub_lot_id:null,sample_date:'2026-09-22',depth_from_cm:'0.00',depth_to_cm:'20.00',results:[{parameter_name:'pH',raw_value:' 7,1 ',numeric_value:'7.1',result_status:'measured'},{parameter_name:'Zinc',raw_value:'N.R.',result_status:'not_requested',numeric_value:null},{parameter_name:'pH aproximado',raw_value:'7',result_status:'measured'}]};
test('original results remain distinct; highlights only match configured exact names',()=>{assert.equal(resultText(sample.results[1]),'N.R.');assert.equal(resultText(sample.results[0]),'7,1');assert.deepEqual(highlights(sample).map(r=>r.name),['pH']);assert.equal(depthText(sample),'Profundidad 0–20 cm');assert.equal(depthText({depth_from_cm:20,depth_to_cm:40}),'Profundidad 20–40 cm');});
test('multiple samples payload preserves raw text, drops untrusted IDs/tenant/path and clears nonrequested numeric values',()=>{const before=structuredClone(sample),body=reportPayload({company_id:'foreign',storage_path:'evil',samples:[sample,{...sample,sub_lot_id:'sub',results:[{...sample.results[1],numeric_value:'99'}]}]});assert.equal(body.samples.length,2);assert.equal(body.samples[0].results[0].raw_value,' 7,1 ');assert.equal(body.samples[1].results[0].numeric_value,null);assert.ok(!Object.hasOwn(body,'storage_path'));assert.ok(!Object.hasOwn(body.samples[0],'id'));assert.deepEqual(sample,before);assert.deepEqual(emptySample('lot','sub'),{lot_id:'lot',sub_lot_id:'sub',results:[{result_status:'measured'}]});});
test('history filters whole lot/division and sorts individual samples newest first',()=>{const reports=[{id:'r',samples:[sample,{...sample,id:'s2',sub_lot_id:'sub',sample_date:'2026-09-23'},{...sample,id:'other',lot_id:'foreign'}]}];assert.equal(historyRows(reports,'lot')[0].id,'s2');assert.deepEqual(historyRows(reports,'lot','full').map(s=>s.id),['sample']);assert.deepEqual(historyRows(reports,'lot','sub').map(s=>s.id),['s2']);});
test('PDF local limits and preview URL validation prevent executable schemes or persistence',()=>{validatePdf({type:'application/pdf',size:MAX_PDF_BYTES});for(const file of [null,{type:'text/plain',size:2},{type:'application/pdf',size:0},{type:'application/pdf',size:MAX_PDF_BYTES+1}])assert.throws(()=>validatePdf(file));assert.equal(safePdfUrl('javascript:alert(1)'),null);assert.equal(safePdfUrl('data:text/html,<script>'),null);assert.equal(safePdfUrl('https://storage.invalid/doc.pdf'),'https://storage.invalid/doc.pdf');const source=fs.readFileSync(new URL('../src/features/lots/soilAnalysis/SoilPdfPreview.jsx',import.meta.url),'utf8');assert.ok(!source.includes('localStorage'));assert.ok(!source.includes('sessionStorage'));assert.ok(source.includes('clearTimeout'));assert.ok(source.includes('noopener noreferrer'));});
test('specific permissions and defaults are reflected in lot entry, guarded route and permission editor',()=>{const frontend=fs.readFileSync(new URL('../src/constants/permissions.jsx',import.meta.url),'utf8').replaceAll('export const ','const '),ctx={};vm.runInNewContext(frontend+';globalThis.permissions=PERMISSIONS;globalThis.roles=ROLE_PERMISSIONS;',ctx);assert.equal(Object.values(ctx.permissions).filter(p=>p.startsWith('soil_analysis.')).length,6);for(const [role,n] of [[0,0],[1,2],[2,6]])assert.equal(ctx.roles[role].filter(p=>p.startsWith('soil_analysis.')).length,n);const route=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8'),lots=fs.readFileSync(new URL('../src/features/lots/LotsOverview.jsx',import.meta.url),'utf8');assert.ok(route.includes('path="/lotes/:lotId/analisis-suelo"'));assert.ok(route.includes('requiredPermission={PERMISSIONS.SOIL_ANALYSIS_VIEW}'));assert.ok(lots.includes("label:'Análisis de suelo'"));assert.ok(lots.includes('row.subLot.id'));});

test('global rows include multiple lots; combined filters/search never expose sibling samples accidentally',()=>{
 const reports=[{id:'report',report_number:'INF-Á',laboratory:'Laboratorio',samples:[{...sample,sample_name:'Campo norte'},{...sample,id:'second',lot_id:'lot2',sub_lot_id:'division',sample_name:'Sur'}]}];
 assert.equal(historyRows(reports).length,2);assert.equal(historyRows(reports,'lot2')[0].id,'second');assert.equal(historyRows(reports,'lot2','division','inf-a').length,1);assert.equal(historyRows(reports,'lot2',undefined,'norte').length,0);assert.equal(historyRows(reports,undefined,undefined,'LABORATORIO').length,2);
 const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');assert.ok(app.includes('path="/analisis-suelo"'));assert.ok(app.includes('requiredPermission={PERMISSIONS.SOIL_ANALYSIS_VIEW}><SoilAnalysis key="global"'));
});

test('extraction proposals never preselect lot/division and preserve original versus numeric values',()=>{
 const value=extractionValues({report_number:'SYN',laboratory:null,received_date:null,notes:null,samples:[{lot_id:'guessed',sub_lot_id:'guessed-sub',sample_date:'2026-05-22',results:[{raw_value:'7,1',numeric_value:7.1}]}]},value=>value);
 assert.equal(value.samples[0].lot_id,null);assert.equal(value.samples[0].sub_lot_id,null);assert.equal(value.samples[0].results[0].raw_value,'7,1');assert.equal(value.samples[0].results[0].numeric_value,7.1);
});

test('manual qualitative raw values survive payload preparation; filtered extraction does not reintroduce rows',()=>{
 const values=['N.R.','<0,1','Trazas','Negativo','Positivo','Ausente'],results=values.map(raw_value=>({parameter_name:'Ensayo',raw_value,numeric_value:null,result_status:'qualitative'}));
 const payload=reportPayload({samples:[{...sample,results}]});assert.deepEqual(payload.samples[0].results.map(r=>[r.raw_value,r.result_status]),values.map(v=>[v,'qualitative']));
 for(const filtered of [[],[results[1]]])assert.deepEqual(extractionValues({samples:[{results:filtered}]},v=>v).samples[0].results,filtered);
});

test('one result presentation uses es-AR without redundant zeroes and retains qualitative text',()=>{
 for(const [numeric_value,expected] of [[7.1,'7,1'],['3.000000','3'],[0.015,'0,015'],[0.18,'0,18'],[28.3,'28,3'],[0.8,'0,8'],[1,'1'],[1.25,'1,25'],[0,'0'],['99999999999999.999999','99.999.999.999.999,999999']])assert.equal(resultText({numeric_value,raw_value:'documental'}),expected);
 for(const raw_value of ['<0,1','Trazas','Negativo','Positivo','Ausente','N.R.'])assert.equal(resultText({numeric_value:null,raw_value}),raw_value);
 for(const result of [{},{raw_value:null},{raw_value:undefined}])assert.equal(resultText(result),'');
});
test('single-result editing synchronizes metadata without changing the meaning or rounding decimals',()=>{
 for(const [raw_value,numeric_value] of [['7,1',7.1],['7.1',7.1],[' 3,0 ',3],['+1.25',1.25],['-0,015',-0.015],['0',0],['99999999999999.999999','99999999999999.999999']])assert.deepEqual(editedResult(raw_value),{raw_value,numeric_value,result_status:'measured'});
 for(const raw_value of ['<0,1','Trazas','Negativo','N.R.','7,','7.','1.234,5','1,234.5','1e3','Infinity','0.1234567',''])assert.deepEqual(editedResult(raw_value),{raw_value,numeric_value:null,result_status:'qualitative'});
 const untouched=structuredClone(sample);resultText(sample.results[0]);assert.deepEqual(sample,untouched);
});

test('extraction messages separate explicit information from review while keeping legacy string warnings compatible',()=>{
 assert.deepEqual(extractionMessages(['Información: Profundidad: el informe indica NO CONSIGNA.','Fecha de muestreo: revisala antes de guardar.','Advertencia anterior']),{info:['Profundidad: el informe indica NO CONSIGNA.'],review:['Fecha de muestreo: revisala antes de guardar.','Advertencia anterior']});assert.deepEqual(extractionMessages(),{info:[],review:[]});
});

test('sample chronology preserves report tie order and places absent dates last without inventing dates',()=>{
 const reports=[{id:'r1',samples:[{...sample,id:'missing',sample_date:null},{...sample,id:'first',sample_date:'2026-09-23'},{...sample,id:'older',sample_date:'2026-09-22'}]},{id:'r2',samples:[{...sample,id:'second',sample_date:'2026-09-23'},{...sample,id:'foreign',lot_id:'other',sample_date:'2099-01-01'}]}];
 assert.deepEqual(historyRows(reports,'lot').map(row=>row.id),['first','second','older','missing']);
 assert.equal(historyRows(reports,'lot').at(-1).sample_date,null);
});

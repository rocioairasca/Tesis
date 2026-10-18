const {test}=require('node:test'),assert=require('node:assert/strict');
const {extract,adaptProposal,callProvider,MESSAGE}=require('../services/soilAnalysisExtraction');
const {readPdfText}=require('../services/soilPdfText'),fixture=require('./soilExtraction.fixture');
const text=fixture.lines.join('\n');
test('real parser reads a valid synthetic PDF text layer, then proposal validates dates, depth and exact raw values',async()=>{
 const buffer=fixture.pdf(),actual=await readPdfText(buffer);assert.ok(actual.includes('S26-0385'));assert.ok(actual.includes('7,1'));let calls=0;
 const data=await extract({file:fixture.file(),provider:async({text})=>{calls++;assert.ok(text.includes('N.R.'));return fixture.proposal();}});
 assert.equal(calls,1);assert.equal(data.report_number,'S26-0385');assert.equal(data.received_date,'2026-06-02');assert.equal(data.samples[0].sample_date,'2026-05-22');assert.equal(data.samples[0].depth_from_cm,0);assert.equal(data.samples[0].depth_to_cm,20);assert.equal(data.laboratory,null);
 assert.deepEqual(data.samples[0].results.map(r=>[r.raw_value,r.numeric_value,r.result_status]),[['7,1',7.1,'measured'],['3,0',3,'measured'],['<0,1',null,'qualitative']]);assert.ok(!Object.hasOwn(data.samples[0],'lot_id'));assert.deepEqual(data.samples[0].results.map(r=>r.parameter_name),['pH','Materia Orgánica','Traza']);assert.deepEqual(data.samples[0].results.map(r=>r.sort_order),[0,1,2]);assert.deepEqual(buffer,fixture.pdf());
});
test('multiple samples retained; invented fields removed and missing depth/date warned',()=>{
 const p=fixture.proposal();p.laboratory='Inventado';p.samples.push({...p.samples[0],sample_date:null,depth_from_cm:null,depth_to_cm:null});const data=adaptProposal(p,text);assert.equal(data.samples.length,2);assert.equal(data.laboratory,null);assert.equal(data.samples[1].depth_from_cm,null);assert.ok(data.warnings.some(w=>/profundidad/i.test(w)));assert.ok(data.warnings.some(w=>/fecha de muestreo/i.test(w)));
});
test('numeric interpretation is conservative and N.R. requires its own report legend',()=>{
 const p=fixture.proposal();p.samples[0].results[0].numeric_value=999;const data=adaptProposal(p,text.replace('N.R.: ANÁLISIS NO REQUERIDO POR EL INTERESADO',''));assert.equal(data.samples[0].results[0].numeric_value,7.1);assert.equal(data.samples[0].results[2].result_status,'qualitative');assert.equal(data.samples[0].results[2].numeric_value,null);assert.ok(data.warnings.some(w=>w.includes('significado de N.R.')));assert.equal(data.samples[0].results[3].numeric_value,null);
});
for(const [name,patch] of [['MIME',{mimetype:'text/plain'}],['magic',{buffer:Buffer.from('not PDF')}],['oversize',{buffer:Buffer.alloc(10*1024*1024+1)}],['empty',{buffer:Buffer.alloc(0)}]])test('rejects invalid '+name+' before reader/provider',async()=>{
 let called=false;await assert.rejects(extract({file:{...fixture.file(),...patch},readText:async()=>{called=true;},provider:async()=>{called=true;}}),e=>[400,413].includes(e.status));assert.equal(called,false);
});
test('scanned/empty layer safely falls back to manual, with no provider request',async()=>{
 let called=false;await assert.rejects(extract({file:fixture.file(),readText:async()=>'',provider:async()=>{called=true;}}),e=>e.status===422&&e.message===MESSAGE);assert.equal(called,false);
});
test('strict response rejects bad JSON fields, automatic lot IDs, invalid date and invalid provider output',async()=>{
 for(const change of [p=>({...p,extra:true}),p=>({...p,samples:[{...p.samples[0],lot_id:'guessed'}]}),p=>({...p,received_date:'2026-02-30'}),()=>'{bad JSON}']){
  await assert.rejects(extract({file:fixture.file(),readText:async()=>text,provider:async()=>change(fixture.proposal())}),e=>e.status===502&&e.message===MESSAGE);
 }
});
test('provider errors/timeout and cancellation are sanitized and abort work',async()=>{
 await assert.rejects(extract({file:fixture.file(),readText:async()=>text,provider:async()=>{throw new Error('sensitive document');}}),e=>e.message===MESSAGE);
 let signal;await assert.rejects(extract({file:fixture.file(),readText:async()=>text,timeoutMs:15,provider:async args=>{signal=args.signal;return new Promise(()=>{});}}),e=>e.status===504);assert.equal(signal.aborted,true);
 const c=new AbortController();c.abort();await assert.rejects(extract({file:fixture.file(),signal:c.signal}),e=>e.status===499);
});
test('Responses adapter uses strict schema, no storage/tools, only backend key, and validates provider protocol',async()=>{
 let sent;
 const fetchImpl=async(url,options)=>{sent={url,...options,body:JSON.parse(options.body)};return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(fixture.proposal())}]}]})};};
 const actual=await callProvider({text,fetchImpl,env:{OPENAI_API_KEY:'test-only',SOIL_EXTRACTION_MODEL:'test-model'}});assert.equal(actual.report_number,'S26-0385');assert.equal(sent.body.store,false);assert.equal(sent.body.text.format.strict,true);assert.equal(sent.body.text.format.schema.additionalProperties,false);assert.equal(sent.body.model,'test-model');assert.equal(sent.body.tools,undefined);assert.equal(sent.body.input[0].content[0].type,'input_text');assert.equal(sent.body.input[0].content[0].text,'Contenido documental del PDF:\n'+text);assert.match(sent.body.instructions,/Omití por completo/);assert.match(sent.body.instructions,/Si el documento no aclara el significado de N.R./);
 for(const body of [{status:'incomplete'}, {status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}, {status:'completed',output:[{type:'message',content:[{type:'output_text',text:'bad'}]}]}])await assert.rejects(callProvider({text,env:{OPENAI_API_KEY:'test-only'},fetchImpl:async()=>({ok:true,json:async()=>body})}));
 await assert.rejects(callProvider({text,env:{}}),e=>e.status===503);
 await assert.rejects(callProvider({text,env:{OPENAI_API_KEY:'test-only'},fetchImpl:async()=>({ok:false})}));
});

test('depth cannot match a suffix of a different range; ambiguous separators stay nonnumeric',()=>{
 const p=fixture.proposal();const data=adaptProposal(p,text.replace('0-20 cm','10-20 cm'));assert.equal(data.samples[0].depth_from_cm,null);
 p.samples[0].results[0].raw_value='1,234';const value=adaptProposal(p,text+' 1,234');assert.equal(value.samples[0].results[0].numeric_value,null);
});

test('explicit partial depth is preserved without inventing the missing bound or rounding numeric precision',()=>{
 const p=fixture.proposal();p.samples[0].depth_to_cm=null;p.samples[0].results[0].raw_value='99999999999999,99';const actual=adaptProposal(p,text.replace('Profundidad: 0-20 cm','Profundidad desde: 0 cm')+' 99999999999999,99');assert.equal(actual.samples[0].depth_from_cm,0);assert.equal(actual.samples[0].depth_to_cm,null);assert.equal(actual.samples[0].results[0].numeric_value,null);
});

test('unit compatibility characters are not silently normalized into different document text',()=>{
 const p=fixture.proposal();p.samples[0].results[0].unit='cm3';const actual=adaptProposal(p,text+' cm³');assert.equal(actual.samples[0].results[0].unit,null);
});

for(const status of ['measured','qualitative','not_requested'])test('confirmed N.R. is omitted across samples regardless of provider status '+status,()=>{
 const p=fixture.proposal(),nr={...p.samples[0].results[2],result_status:status,numeric_value:99};p.samples[0].results=[nr,{...nr},p.samples[0].results[0]];p.samples.push(structuredClone(p.samples[0]));const original=structuredClone(p);
 const data=adaptProposal(p,text);for(const sample of data.samples)assert.deepEqual(sample.results.map(r=>[r.parameter_name,r.raw_value,r.numeric_value,r.sort_order]),[['pH','7,1',7.1,0]]);assert.deepEqual(p,original);
});
test('unrelated no requerido phrase is not a definition of N.R.',()=>{
 const data=adaptProposal(fixture.proposal(),text.replace('N.R.: ANÁLISIS NO REQUERIDO POR EL INTERESADO','Comentario: ANÁLISIS NO REQUERIDO POR EL INTERESADO'));
 assert.equal(data.samples[0].results[2].raw_value,'N.R.');assert.equal(data.samples[0].results[2].result_status,'qualitative');assert.ok(data.warnings.some(w=>w.includes('significado de N.R.')));
});
test('real qualitative results survive a no requerido legend unchanged',()=>{
 const values=['<0,1','Trazas','Negativo','Positivo','Ausente'],p=fixture.proposal();p.samples[0].results=values.map(raw_value=>({...p.samples[0].results[0],raw_value,numeric_value:0}));
 const data=adaptProposal(p,text+' '+values.join(' '));assert.deepEqual(data.samples[0].results.map(r=>[r.raw_value,r.numeric_value,r.result_status]),values.map(v=>[v,null,'qualitative']));
});
test('all nonrequested rows leave an empty sample with a review warning, without invented results',()=>{
 const p=fixture.proposal();p.samples[0].results=[p.samples[0].results[2]];const data=adaptProposal(p,text);assert.equal(data.samples.length,1);assert.deepEqual(data.samples[0].results,[]);assert.ok(data.warnings.some(w=>w.includes('no quedaron resultados analizados')));
});
test('model omission and defensive omission produce identical proposals',()=>{
 const p=fixture.proposal();p.samples[0].results.splice(2,1);assert.deepEqual(adaptProposal(p,text),adaptProposal(fixture.proposal(),text));
});

test('optional missing fields do not produce model or backend review noise',()=>{
 const p=fixture.proposal();p.warnings=['No se pudo verificar las notas en el PDF. Completalo al revisar.','No se encontró el laboratorio.','Notas: no consignadas en el informe.'];const data=adaptProposal(p,text);
 assert.equal(data.notes,null);assert.equal(data.samples[0].notes,null);assert.ok(!data.warnings.some(w=>/notas|laboratorio/i.test(w)));assert.ok(data.warnings.every(w=>w.startsWith('Información: ')));
});
for(const marker of ['NO CONSIGNA','NO CONSIGNADO','NO INFORMADO'])test('S26-0389 synthetic PDF explains '+marker+' and omitted N.R. as information',async()=>{
 const p=fixture.proposal();p.report_number='S26-0389';p.samples[0].sample_name='LOTE 44 HAS';p.samples[0].depth_from_cm=null;p.samples[0].depth_to_cm=null;p.warnings=['Contiene resultados N.R. definidos como ANALISIS NO REQUERIDO POR EL INTERESADO, omitidos según indicación.'];
 const lines=fixture.lines.map(line=>line.replace('S26-0385','S26-0389').replace('MUESTRA SINTETICA RASTROJO SOJA','LOTE 44 HAS').replace('Profundidad: 0-20 cm','Profundidad: '+marker));
 const buffer=fixture.pdf(lines),copy=Buffer.from(buffer),data=await extract({file:{...fixture.file(),buffer},provider:async()=>p});
 assert.equal(data.samples[0].depth_from_cm,null);assert.equal(data.samples[0].depth_to_cm,null);assert.equal(data.samples[0].results.length,3);assert.deepEqual(buffer,copy);assert.ok(data.warnings.every(w=>w.startsWith('Información: ')));assert.ok(data.warnings.some(w=>w.includes('Profundidad · LOTE 44 HAS')&&w.includes(marker)));assert.ok(data.warnings.some(w=>w.includes('no corresponden a análisis realizados')));assert.ok(!data.warnings.some(w=>/según indicación|ANALISIS NO|notas/i.test(w)));
});
test('missing depth is optional information; another field NO CONSIGNA is not attributed to depth',()=>{
 const p=fixture.proposal();p.samples[0].depth_from_cm=null;p.samples[0].depth_to_cm=null;const data=adaptProposal(p,text.replace('Profundidad: 0-20 cm',''));
 const depth=data.warnings.find(w=>w.includes('Profundidad'));assert.ok(depth.startsWith('Información: '));assert.ok(depth.includes('Podés dejar el campo vacío'));assert.ok(!depth.includes('NO CONSIGNA'));
});
test('unconfirmed proposed notes remain a review issue even when model calls them absent',()=>{
 const p=fixture.proposal();p.notes='Inventadas';p.warnings=['No se pudo verificar las notas en el PDF.'];const data=adaptProposal(p,text);assert.equal(data.notes,null);assert.equal(data.warnings.filter(w=>w.startsWith('Notas del informe:')).length,1);assert.ok(data.warnings.find(w=>w.startsWith('Notas del informe:')).includes('Revisalo antes de guardar'));
});
test('multiple samples receive scoped depth messages; no global attribution or invented depth',()=>{
 const p=fixture.proposal();p.samples[0].sample_name='NORTE';p.samples[0].depth_from_cm=null;p.samples[0].depth_to_cm=null;p.samples.push({...structuredClone(p.samples[0]),sample_name:'SUR'});
 const doc=text.replace('Profundidad: 0-20 cm','').replace('Muestra: MUESTRA SINTETICA RASTROJO SOJA','Muestra: NORTE\nProfundidad: NO CONSIGNA')+'\nMuestra: SUR\nProfundidad: 10-30 cm';
 const data=adaptProposal(p,doc),north=data.warnings.find(w=>w.includes('Profundidad · NORTE')),south=data.warnings.find(w=>w.includes('Profundidad · SUR'));assert.ok(north.startsWith('Información: '));assert.ok(north.includes('NO CONSIGNA'));assert.ok(!south.startsWith('Información: '));assert.ok(!south.includes('NO CONSIGNA'));assert.equal(data.samples[1].depth_from_cm,null);
 p.samples[1].sample_name=null;assert.ok(adaptProposal(p,doc).warnings.some(w=>w.startsWith('Profundidad de la muestra 2:')));
});
test('explicit absence never accepts a proposed depth from another part of the document',()=>{
 const data=adaptProposal(fixture.proposal(),text.replace('Profundidad: 0-20 cm','Profundidad: NO CONSIGNA')+'\nReferencia de otro ensayo: 0-20 cm');assert.equal(data.samples[0].depth_from_cm,null);assert.ok(data.warnings.some(w=>w.includes('Profundidad')&&!w.startsWith('Información: ')));assert.ok(data.warnings.some(w=>w.includes('NO CONSIGNA')));
});
test('provider ambiguity stays review, named samples remain identifiable and internal terms are not exposed',()=>{
 const p=fixture.proposal();p.warnings=['Muestra 1: dos posibles fechas para sample_date según parser.','raw_value no verificable contra source text, result_status según adaptación.'];const data=adaptProposal(p,text);
 assert.ok(data.warnings.some(w=>w.startsWith('Fechas · MUESTRA SINTETICA RASTROJO SOJA:')));assert.ok(data.warnings.some(w=>w.startsWith('Resultados:')));assert.ok(data.warnings.every(w=>!/sample_date|raw_value|result_status|parser|source text|adaptación/.test(w)));
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {extract,adaptProposal,callProvider,MESSAGE}=require('../services/soilAnalysisExtraction');
const {readPdfText}=require('../services/soilPdfText'),fixture=require('./soilExtraction.fixture');
const text=fixture.lines.join('\n');
test('real parser reads a valid synthetic PDF text layer, then proposal validates dates, depth and exact raw values',async()=>{
 const buffer=fixture.pdf(),actual=await readPdfText(buffer);assert.ok(actual.includes('S26-0385'));assert.ok(actual.includes('7,1'));let calls=0;
 const data=await extract({file:fixture.file(),provider:async({text})=>{calls++;assert.ok(text.includes('N.R.'));return fixture.proposal();}});
 assert.equal(calls,1);assert.equal(data.report_number,'S26-0385');assert.equal(data.received_date,'2026-06-02');assert.equal(data.samples[0].sample_date,'2026-05-22');assert.equal(data.samples[0].depth_from_cm,0);assert.equal(data.samples[0].depth_to_cm,20);assert.equal(data.laboratory,null);
 assert.deepEqual(data.samples[0].results.map(r=>[r.raw_value,r.numeric_value,r.result_status]),[['7,1',7.1,'measured'],['3,0',3,'measured'],['N.R.',null,'not_requested'],['<0,1',null,'qualitative']]);assert.ok(!Object.hasOwn(data.samples[0],'lot_id'));
});
test('multiple samples retained; invented fields removed and missing depth/date warned',()=>{
 const p=fixture.proposal();p.laboratory='Inventado';p.samples.push({...p.samples[0],sample_date:null,depth_from_cm:null,depth_to_cm:null});const data=adaptProposal(p,text);assert.equal(data.samples.length,2);assert.equal(data.laboratory,null);assert.equal(data.samples[1].depth_from_cm,null);assert.ok(data.warnings.some(w=>w.includes('profundidad')));assert.ok(data.warnings.some(w=>w.includes('fecha de muestreo')));
});
test('numeric interpretation is conservative and N.R. requires its own report legend',()=>{
 const p=fixture.proposal();p.samples[0].results[0].numeric_value=999;const data=adaptProposal(p,text.replace('N.R.: ANÁLISIS NO REQUERIDO POR EL INTERESADO',''));assert.equal(data.samples[0].results[0].numeric_value,7.1);assert.equal(data.samples[0].results[2].result_status,'qualitative');assert.equal(data.samples[0].results[3].numeric_value,null);
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
 const actual=await callProvider({text,fetchImpl,env:{OPENAI_API_KEY:'test-only',SOIL_EXTRACTION_MODEL:'test-model'}});assert.equal(actual.report_number,'S26-0385');assert.equal(sent.body.store,false);assert.equal(sent.body.text.format.strict,true);assert.equal(sent.body.text.format.schema.additionalProperties,false);assert.equal(sent.body.model,'test-model');assert.equal(sent.body.tools,undefined);assert.equal(sent.body.input[0].content[0].type,'input_text');
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

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import dayjs from 'dayjs';
import {durationMode,changeDuration,validatedDateRange,activityChangeFields} from '../src/features/planning/planningFormFlow.mjs';
import {formatPlanningPeriod} from '../src/features/planning/planningDisplay.js';
import {hasFieldContext} from '../src/features/planning/fieldContext.mjs';
const first=dayjs('2026-09-22'),last=dayjs('2026-09-24');
test('new form defaults to one day and sends identical existing date fields',()=>{
 assert.equal(durationMode(), 'day');const [start,end]=validatedDateRange([first,last]);
 assert.equal(start,end);
 assert.deepEqual({start_at:start.format('YYYY-MM-DD[T]00:00:00.000[Z]'),end_at:end.format('YYYY-MM-DD[T]00:00:00.000[Z]')},{start_at:'2026-09-22T00:00:00.000Z',end_at:'2026-09-22T00:00:00.000Z'});
});
test('period preserves both dates and rejects reversed or incomplete dates',()=>{
 assert.deepEqual(validatedDateRange([first,last],'period'),[first,last]);
 assert.throws(()=>validatedDateRange([last,first],'period'),/anterior/);
 assert.throws(()=>validatedDateRange([first,null],'period'),/desde y hasta/);
 assert.throws(()=>validatedDateRange([], 'day'),/fecha/);
});
test('editing derives duration without altering the saved range',()=>{
 const original=['2026-09-22T00:00:00Z','2026-09-24T00:00:00Z'];
 assert.equal(durationMode(...original),'period');assert.equal(durationMode(original[0],original[0]),'day');
 assert.deepEqual(original,['2026-09-22T00:00:00Z','2026-09-24T00:00:00Z']);
});
test('mode changes retain initial date and remove the old hidden end date',()=>{
 const daily=changeDuration([first,last],'day');assert.deepEqual(daily,[first,first]);
 assert.deepEqual(changeDuration(daily,'period'),[first,first]);assert.notEqual(daily[1],last);
});
test('cards and detail format one date or a period with al',()=>{
 assert.equal(formatPlanningPeriod({start_at:'2026-09-22',end_at:'2026-09-22'}),'22/09/2026');
 assert.equal(formatPlanningPeriod({start_at:'2026-09-22',end_at:'2026-09-24'}),'22/09/2026 al 24/09/2026');
});
test('activity changes clear only incompatible context and retain crop/common data',()=>{
 const original={crop_id:'maiz',field_context:'stubble',responsible_user:'person',date_range:[first,last]};
 assert.deepEqual({...original,...activityChangeFields('siembra')},{...original,field_context:null});
 assert.deepEqual(activityChangeFields('fertilizacion'),{});
 assert.equal(hasFieldContext('fumigacion'),true);assert.equal(hasFieldContext('siembra'),false);
});
test('ordinary drawer order, progressive disclosure, edit initialization and unchanged payload contract',()=>{
 const text=fs.readFileSync(new URL('../src/features/planning/Planning.jsx',import.meta.url),'utf8');
 const drawer=text.slice(text.indexOf('{/* Drawer crear/editar */}'),text.indexOf('{/* Drawer Detalle'));
 const expected=['name="activity_type"','<PlanningDateFields','name="field_context"','name="crop_id"','name="lot_selection_keys"','<EffectiveAreaFields','name="responsible_user"','name="vehicle_id"','<Form.List name="products"','name="description"'];
 const positions=expected.map(x=>{assert.ok(drawer.includes(x),x);return drawer.indexOf(x);});assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
 assert.ok(drawer.indexOf('{selectedActivityType && <>')>drawer.indexOf('name="activity_type"'));assert.ok(drawer.indexOf('{selectedActivityType && <>')<drawer.indexOf('<PlanningDateFields'));
 assert.match(text,/duration_mode: "day"/);assert.match(text,/duration_mode: durationMode\(row.start_at,row.end_at\)/);
 assert.match(text,/activity_type: row.activity_type/);assert.match(text,/validatedDateRange\(values.date_range/);
 const payload=text.slice(text.indexOf('      const payload = {'),text.indexOf('      if (payload.status'));
 assert.match(payload,/start_at:/);assert.match(payload,/end_at:/);assert.doesNotMatch(payload,/duration_mode|start_date:|end_date:/);
 for(const file of ['PlanningTable.jsx','PlanningListMobile.jsx'])assert.match(fs.readFileSync(new URL('../src/features/planning/components/'+file,import.meta.url),'utf8'),/formatPlanningPeriod/);
});
test('date controls render single/day and separate period fields with fluid layout',async()=>{
 const {createServer}=await import('vite'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{fileURLToPath}=await import('node:url');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
 const {PlanningDateInput}=await server.ssrLoadModule('/src/features/planning/components/PlanningDateFields.jsx');
 const daily=renderToStaticMarkup(React.createElement(PlanningDateInput,{mode:'day',value:[first,first]}));
 assert.equal((daily.match(/<input /g)||[]).length,1);assert.match(daily,/22\/09\/2026/);
 const period=renderToStaticMarkup(React.createElement(PlanningDateInput,{mode:'period',value:[first,last]}));
 assert.equal((period.match(/<input /g)||[]).length,2);assert.match(period,/Desde/);assert.match(period,/Hasta/);assert.match(period,/auto-fit/);assert.match(period,/width:100%/);
 }finally{await server.close();}
});

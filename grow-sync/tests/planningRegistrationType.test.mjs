import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registrationModeFields} from '../src/features/planning/planningFormFlow.mjs';
const source=fs.readFileSync(new URL('../src/features/planning/Planning.jsx',import.meta.url),'utf8');
const drawer=source.slice(source.indexOf('{/* Drawer crear/editar */}'),source.indexOf('{/* Drawer Detalle'));
test('activity then creation-only registration type then dates; no hidden switch remains',()=>{
 const activity=drawer.indexOf('name="activity_type"'),type=drawer.indexOf('name="register_completed"'),dates=drawer.indexOf('<PlanningDateFields');
 assert.ok(activity<type && type<dates);assert.match(drawer,/!editing && <Form.Item name="register_completed"/);
 assert.equal((drawer.match(/name="register_completed"/g)||[]).length,1);
 assert.match(drawer,/label="¿La actividad ya se realizó\?"/);assert.doesNotMatch(drawer,/Registrar como realizada|<Switch/);
 assert.match(source,/register_completed: false/);
});
test('each mode retains existing dates, quantity labels and state visibility conditions',()=>{
 assert.match(drawer,/\(!registerCompleted \|\| editing\) && <PlanningDateFields/);
 assert.match(drawer,/!editing && registerCompleted && \(\s*<Form.Item\s*name="effective_date"\s*label="Fecha de realización"/);
 assert.match(drawer,/\(!registerCompleted \|\| editing\) && \(\s*<Form.Item name="status"/);
 assert.match(drawer,/label=\{!editing && registerCompleted \? "Cantidad utilizada" : "Cantidad"\}/);
});
test('switching to performed clears planning dates and preserves compatible fields and quantities',()=>{
 const values={activity_type:'fumigacion',field_context:'stubble',crop_id:'maiz',lot_selection_keys:['santos'],effective_areas:{santos:10},responsible_user:'person',vehicle_id:'vehicle',products:[{amount:7}],date_range:['2026-09-22','2026-09-24'],duration_mode:'period',campaign_id:'campaign'};
 const next={...values,...registrationModeFields(true)};
 assert.equal(next.register_completed,true);assert.equal(next.date_range,undefined);assert.equal(next.effective_date,undefined);
 for(const key of ['activity_type','field_context','crop_id','lot_selection_keys','effective_areas','responsible_user','vehicle_id','products','campaign_id'])assert.deepEqual(next[key],values[key]);
});
test('switching back removes completion date and restarts planning in one-day mode without old dates',()=>{
 const next={effective_date:'2026-09-22',date_range:['old-start','old-end'],...registrationModeFields(false)};
 assert.equal(next.register_completed,false);assert.equal(next.effective_date,undefined);assert.equal(next.date_range,undefined);assert.equal(next.duration_mode,'day');
 assert.deepEqual(registrationModeFields(true),{register_completed:true,date_range:undefined,effective_date:undefined,duration_mode:'day'});
});
test('submission still uses original endpoints and payload fields; mode itself is not sent',()=>{
 assert.match(source,/const shouldRegisterCompleted = !editing && values.register_completed/);
 assert.match(source,/shouldRegisterCompleted\s*\? \[effectiveDate, effectiveDate\]/);
 assert.match(source,/status: shouldRegisterCompleted \? undefined : values.status/);
 assert.match(source,/if \(payload.status === undefined\) delete payload.status/);
 assert.match(source,/if \(shouldRegisterCompleted\) \{\s*payload.effective_date = effectiveDate\?\.format\("YYYY-MM-DD"\)/);
 assert.match(source,/else if \(shouldRegisterCompleted\) \{\s*await api.post\("\/planning\/register-completed", payload\)/);
 assert.match(source,/await api.post\("\/planning", payload\)/);
 const payload=source.slice(source.indexOf('      const payload = {'),source.indexOf('      if (payload.status'));
 assert.doesNotMatch(payload,/register_completed|duration_mode|registered_retroactively/);
});
test('boolean adapter renders clear full-width desktop/mobile options without exposing internal values',async()=>{
 const {createServer}=await import('vite'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{fileURLToPath}=await import('node:url');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {default:Control}=await server.ssrLoadModule('/src/features/planning/components/PlanningRegistrationType.jsx');
  const changes=[];const element=Control({onChange:v=>changes.push(v)});
  assert.equal(element.props.value,'planned');element.props.onChange('done');element.props.onChange('planned');assert.deepEqual(changes,[true,false]);
  for(const value of [false,true]){
   assert.equal(Control({value}).props.value,value?'done':'planned');
   const html=renderToStaticMarkup(React.createElement(Control,{value}));
   assert.match(html,/Planificar/);assert.match(html,/Ya realizada/);assert.match(html,/width:100%/);assert.match(html,/min-width:0/);
   assert.doesNotMatch(html,/registered_retroactively|effective_date|completion|payload/);
  }
 }finally{await server.close();}
});

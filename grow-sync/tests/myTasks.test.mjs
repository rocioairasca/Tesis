import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {classifyMyTasks,myTasksPreview,MY_TASKS_URL,myTaskUrl,taskAssignerName} from '../src/features/planning/myTasks.mjs';
import {readPlanningFilters,updatePlanningFilters,clearPlanningFilters} from '../src/features/planning/planningFilters.mjs';
const row=(id,start='2026-10-18',end=start,extra={})=>({id,start_at:start+'T00:00:00.000Z',end_at:end+'T00:00:00.000Z',status:'pendiente',...extra});
test('categories prioritize effective delay, calendar periods and ascending upcoming dates without duplicates',()=>{
 const a=row('delayed','2026-01-01','2026-10-18',{status_effective:'en_demora'}),b=row('today','2026-10-17','2026-10-19');
 const groups=classifyMyTasks([a,a,b,row('next','2026-10-20'),row('soon','2026-10-19'),row('last','2026-10-25'),row('outside','2026-10-26')],'2026-10-18','2026-10-25');
 assert.deepEqual(groups.delayed.map(r=>r.id),['delayed']);assert.deepEqual(groups.today.map(r=>r.id),['today']);assert.deepEqual(groups.upcoming.map(r=>r.id),['soon','next','last']);
});
test('closed and disabled tasks never appear; preview retains full count with six visible',()=>{
 const rows=Array.from({length:9},(_,i)=>row(String(i)));
 for(const status of ['completado','cancelado'])rows.push(row(status,undefined,undefined,{status,status_effective:'en_demora'}));
 rows.push(row('disabled',undefined,undefined,{enabled:false}));
 assert.equal(classifyMyTasks(rows,'2026-10-18').today.length,9);
 const preview=myTasksPreview(rows,'2026-10-18','2026-10-25',23);assert.equal(preview.rows.length,6);assert.equal(preview.total,23);
});
test('task links preserve personal view and assignment metadata never invents a name',()=>{
 assert.equal(MY_TASKS_URL,'/planificaciones?mine=1');assert.equal(myTaskUrl('correct-id'),'/planificaciones?mine=1&planningId=correct-id');
 assert.equal(taskAssignerName({assigned_by_name:' Juan Pérez '}),'Juan Pérez');assert.equal(taskAssignerName({created_by_name:'Unknown historical creator'}),null);
});
test('URL filters support mine, mutual exclusion, aliases, dates and compatible filters across toggles',()=>{
 const query=new URLSearchParams('mine=1&responsible=other&planningId=detail&crop=maiz&campaign=season&lot=field&status=en_demora&search=work&from=2026-10-01&to=2026-10-31');
 const filters=readPlanningFilters(query);assert.equal(filters.mine,true);assert.equal(filters.responsible,null);assert.equal(filters.cropId,'maiz');assert.equal(filters.campaignId,'season');assert.equal(filters.lotSelectionKey,'lot:field');assert.equal(filters.dateRange[0].format('YYYY-MM-DD'),'2026-10-01');
 const personal=updatePlanningFilters(query,'mine',true);assert.equal(personal.has('responsible'),false);
 const colleague=updatePlanningFilters(personal,'responsible','colleague');assert.equal(colleague.has('mine'),false);assert.equal(readPlanningFilters(colleague).responsible,'colleague');
 for(const key of ['planningId','crop','campaign','lot','status','search','from','to'])assert.equal(colleague.get(key),query.get(key));
 assert.equal(updatePlanningFilters(personal,'mine',false).has('mine'),false);
 assert.equal(clearPlanningFilters(personal).toString(),'planningId=detail');assert.equal(readPlanningFilters(new URLSearchParams('mine=false')).mine,false);
});
test('dashboard source requests six own tasks with full horizon count; permissions, names and empty state render correctly',async()=>{
 const {createServer}=await import('vite'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
 try{
  const {createDashboardSource}=await server.ssrLoadModule('/src/features/dashboard/dashboardSource.js'),calls=[];
  const tasks=[row('a','2026-01-01','2026-01-01',{status_effective:'en_demora',title:'Trabajo asignado',assigned_by_name:'Juan Pérez',crop_name:'Maíz',lots:[{lot_name:'T4'}]}),row('b')];
  const source=createDashboardSource({get:async(path,config)=>{calls.push({path,config});return {data:{data:tasks,total:12}};}});
  const result=await source.myTasks({today:'2026-10-18'});assert.equal(result.total,12);assert.equal(result.rows.length,2);
  assert.deepEqual(calls[0].config.params,{mine:true,to:'2026-10-25T23:59:59.999Z',page:1,pageSize:6});assert.equal(calls.length,1);
  const {dashboardAccess}=await server.ssrLoadModule('/src/features/dashboard/Dashboard.jsx'),{default:View}=await server.ssrLoadModule('/src/features/dashboard/DashboardView.jsx');
  const {MemoryRouter}=await server.ssrLoadModule('/node_modules/react-router-dom/dist/index.mjs'),ready=data=>({status:'success',data});
  const viewer={role:0,custom_permissions:['planning.view']},manager={...viewer,custom_permissions:['planning.view','planning.edit']};
  assert.equal(dashboardAccess(viewer).teamWork,false);assert.equal(dashboardAccess(manager).teamWork,true);
  const props={user:viewer,today:'2026-10-18',access:dashboardAccess(viewer),myTasks:ready(result),work:ready([]),delayed:ready(1),inventory:ready({}),weather:ready({}),filters:{}};
  const render=changes=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(View,{...props,...changes})));
  const html=render({});assert.ok(html.indexOf('dashboard-attention')<html.indexOf('dashboard-my-tasks'));assert.ok(html.indexOf('dashboard-weather')<html.indexOf('dashboard-attention'));
  assert.match(html,/Asignado por Juan Pérez/);assert.equal((html.match(/Asignado por/g)||[]).length,1);assert.match(html,/Se muestran 2 de 12/);assert.match(html,/mine=1&amp;planningId=a/);assert.doesNotMatch(html,/Trabajo del equipo/);
  assert.match(render({access:dashboardAccess(manager)}),/Trabajo del equipo/);
  assert.doesNotMatch(render({access:dashboardAccess({role:0,custom_permissions:[]})}),/Mis tareas|Trabajo del equipo/);
  assert.match(render({myTasks:ready({rows:[],total:0})}),/No tenés tareas para hoy ni para los próximos 7 días/);
  assert.match(render({myTasks:ready({rows:[],total:0})}),/Ver todas mis tareas/);
 }finally{await server.close();}
});

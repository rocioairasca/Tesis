import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {realpathSync,mkdirSync} from 'node:fs';import {createServer} from 'vite';import conversion from '../vite/inventoryConversionPlugin.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
let server,browser,origin;const id='11111111-1111-4111-8111-000000000001';
before(async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));server=await createServer({root,configFile:false,plugins:[conversion(),{name:'planning-execution-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(!['/dashboard','/planificaciones','/users'].includes(req.url.split('?')[0]))return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/planningExecution.fixture.jsx"></script>');});}}],cacheDir:'../.test-tools/vite-planning-execution',server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']}});
 await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function open(width=1440,path='/planificaciones?mine=1&planningId='+id){
 const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce',timezoneId:'America/Argentina/Buenos_Aires'});page.setDefaultTimeout(15000);
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:60000});
 try{await page.locator('main .ant-table,main h1,main h2').first().waitFor();}catch{await page.reload();await page.locator('main .ant-table,main h1,main h2').first().waitFor({timeout:60000});}return page;
}
const drawer=page=>page.locator('.planning-detail-drawer');
const ready=async page=>{await drawer(page).getByText('Juan Pérez',{exact:true}).waitFor();};
async function fits(page,surface){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');if(surface)assert.ok(await surface.evaluate(el=>el.scrollWidth<=el.clientWidth),'no surface overflow');}
async function capture(page,name){if(process.env.EXECUTION_SCREENSHOTS){mkdirSync(process.env.EXECUTION_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.EXECUTION_SCREENSHOTS+'/'+name+'.png',animations:'disabled'});}}
for(const width of [1440,1024,390])test('own task Dashboard → start → complete → refreshed Mis tareas at '+width,async t=>{
 const page=await open(width,'/dashboard');t.after(()=>page.close());const tasks=page.locator('section[aria-labelledby="dashboard-my-tasks"]');
 await tasks.getByText('Tarea de ejecución',{exact:true}).waitFor();assert.equal(await tasks.getByRole('spinbutton').count(),0);await fits(page);await capture(page,'dashboard-'+width);
 await tasks.getByRole('link',{name:/Ver tarea:/}).click();await ready(page);assert.equal(new URL(page.url()).searchParams.get('mine'),'1');
 for(const name of ['Editar','Cancelar','Reasignar'])assert.equal(await drawer(page).getByRole('button',{name,exact:true}).count(),0);
 await drawer(page).getByRole('button',{name:'Iniciar tarea',exact:true}).click();await drawer(page).getByRole('button',{name:'Completar tarea',exact:true}).waitFor();await drawer(page).getByText('En progreso',{exact:true}).waitFor();await page.locator('.gs-planning').getByText('En progreso',{exact:true}).waitFor();assert.equal(await page.locator('.gs-planning button[aria-label="Editar planificación"]').count(),0);
 await fits(page,drawer(page).locator('.ant-drawer-body'));await capture(page,'detail-'+width);
 await drawer(page).getByRole('button',{name:'Completar tarea',exact:true}).click();const modal=page.getByRole('dialog',{name:/^Completar/});await modal.getByLabel('Fecha efectiva del trabajo').waitFor();assert.equal(await modal.getByRole('spinbutton').count(),0);
 await fits(page,modal);await capture(page,'complete-'+width);await modal.getByRole('button',{name:'Confirmar trabajo',exact:true}).click();await modal.waitFor({state:'hidden'});await drawer(page).getByText('Completado',{exact:true}).waitFor();
 assert.equal(await drawer(page).getByRole('button',{name:/Iniciar tarea|Completar tarea|Reabrir/}).count(),0);
 const writes=await page.evaluate(()=>window.__mutations);assert.deepEqual(writes.map(w=>[w.method,w.path]),[['post','/planning/'+id+'/start'],['post','/planning/'+id+'/complete-activity']]);assert.deepEqual(Object.keys(writes[1].body),['effective_date']);
 await drawer(page).getByRole('button',{name:/Close|Cerrar/}).click();await drawer(page).waitFor({state:'hidden'});await page.locator('.gs-planning .inventory-card, .gs-planning .ant-table-tbody tr[data-row-key]').waitFor({state:'hidden'});await fits(page);
});
for(const activity of ['siembra','fumigacion','fertilizacion','mantenimiento','otro','cosecha'])test('execute opens existing completion flow for '+activity,async t=>{
 const page=await open(390,'/planificaciones?mine=1&status=en_progreso&activity='+activity+'&planningId='+id);t.after(()=>page.close());await ready(page);await drawer(page).getByRole('button',{name:'Completar tarea',exact:true}).click();const modal=page.getByRole('dialog',{name:/^Completar/});
 const productive=['siembra','fumigacion','fertilizacion'].includes(activity);await modal.getByLabel(activity==='siembra'?'Fecha efectiva de siembra':'Fecha efectiva del trabajo').waitFor();
 if(productive){const amount=modal.getByRole('spinbutton',{name:'Cantidad real',exact:true});await amount.fill('0.5');await amount.press('Tab');}else assert.equal(await modal.getByRole('spinbutton').count(),0);
 await fits(page,modal);await modal.getByRole('button',{name:activity==='siembra'?'Confirmar siembra':'Confirmar trabajo',exact:true}).click();await modal.waitFor({state:'hidden'});await drawer(page).getByText('Completado',{exact:true}).waitFor();
 const [write]=await page.evaluate(()=>window.__mutations);assert.equal(write.path,'/planning/'+id+'/'+(activity==='siembra'?'complete-sowing':productive?'complete-work':'complete-activity'));
 if(productive){assert.equal(write.body.actual_products[0].planning_product_id,'pp');assert.equal(Number(write.body.actual_products[0].actual_amount),0.5);}else assert.deepEqual(Object.keys(write.body),['effective_date']);
});
for(const mode of ['other','view','editor'])test('execution and editing capabilities: '+mode,async t=>{
 const page=await open(1024,'/planificaciones?mode='+mode+'&planningId='+id);t.after(()=>page.close());await ready(page);
 if(mode==='editor'){await drawer(page).getByRole('button',{name:'Iniciar trabajo',exact:true}).waitFor();await drawer(page).getByRole('button',{name:/Close|Cerrar/}).click();await drawer(page).waitFor({state:'hidden'});await page.getByRole('button',{name:/^Editar /}).filter({visible:true}).waitFor();}
 else assert.equal(await drawer(page).getByRole('button',{name:/Iniciar|Completar|Editar|Cancelar/}).count(),0);
 assert.deepEqual(await page.evaluate(()=>window.__mutations),[]);
});
test('execute without view does not expose Planning or Dashboard tasks',async t=>{
 const page=await open(390,'/dashboard?mode=noView');t.after(()=>page.close());await page.getByRole('heading',{name:'Clima',exact:true}).waitFor();assert.equal(await page.locator('section[aria-labelledby="dashboard-my-tasks"]').count(),0);
 await page.goto(origin+'/planificaciones?mode=noView&planningId='+id);await drawer(page).getByText('No tenés permiso para ver esta planificación.').waitFor();assert.equal(await drawer(page).getByRole('button',{name:/Iniciar|Completar/}).count(),0);
 assert.ok(!(await page.evaluate(()=>window.__requests)).some(r=>r.path.startsWith('/planning')));
});
test('reassignment before completion returns a clear error and retains form',async t=>{
 const page=await open(390,'/planificaciones?mode=reassigned&status=en_progreso&planningId='+id);t.after(()=>page.close());await ready(page);await drawer(page).getByRole('button',{name:'Completar tarea',exact:true}).click();const modal=page.getByRole('dialog',{name:/^Completar/});await modal.getByRole('button',{name:'Confirmar trabajo',exact:true}).click();
 await page.getByText('No tenés permiso para ejecutar esta tarea. Puede haber sido reasignada.',{exact:true}).waitFor();assert.ok(await modal.isVisible());assert.equal(await drawer(page).getByText('Completado',{exact:true}).count(),0);
});
test('permission editor includes execute, warns without view and never adds view silently',async t=>{
 const page=await open(1024,'/users?mode=admin');t.after(()=>page.close());await page.getByRole('button',{name:'Permisos',exact:true}).click();const panel=page.locator('.ant-drawer-open');
 await panel.getByRole('checkbox',{name:'Ejecutar tareas asignadas',exact:true}).check();await panel.getByRole('status').getByText(/Para ver Planning y Mis tareas/).waitFor();assert.equal(await panel.getByRole('checkbox',{name:'Ver planificaciones',exact:true}).isChecked(),false);
 await panel.getByRole('button',{name:'Guardar Permisos',exact:true}).click();await panel.waitFor({state:'hidden'});assert.deepEqual((await page.evaluate(()=>window.__mutations))[0].body.custom_permissions,['planning.execute']);
});

import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {realpathSync,mkdirSync} from 'node:fs';import {createServer} from 'vite';import conversion from '../vite/inventoryConversionPlugin.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
let server,browser,origin;const id='11111111-1111-4111-8111-000000000001';
before(async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));server=await createServer({root,configFile:false,plugins:[conversion(),{name:'my-tasks-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(!['/dashboard','/planificaciones'].includes(req.url.split('?')[0]))return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/myTasks.fixture.jsx"></script>');});}}],cacheDir:'../.test-tools/vite-my-tasks',server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']}});
 await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function open(width=1440,path='/dashboard'){
 const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce',timezoneId:'America/Argentina/Buenos_Aires'});page.setDefaultTimeout(15000);
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:60000});
 try{await page.locator('main h1,main h2').first().waitFor();}catch{await page.reload();await page.locator('main h1,main h2').first().waitFor({timeout:60000});}return page;
}
const section=page=>page.locator('section[aria-labelledby="dashboard-my-tasks"]');
const drawer=page=>page.locator('.planning-detail-drawer');
const readyDetail=async page=>{await drawer(page).getByText('Juan Pérez',{exact:true}).waitFor();};
const fits=async page=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
for(const width of [1440,1024,390])test('Mis tareas dashboard → exact drawer, close, back/forward and all tasks at '+width,async t=>{
 const page=await open(width);t.after(()=>page.close());const personal=section(page);await personal.getByText('Trabajo personal 1',{exact:true}).waitFor();
 assert.equal(await personal.locator('li').count(),6);assert.match(await personal.innerText(),/Se muestran 6 de 7 tareas/);assert.equal(await page.getByText('Trabajo del equipo',{exact:true}).count(),0);
 const titles=await personal.locator('li strong').allTextContents();assert.equal(titles[0],'Trabajo personal 1');assert.match(await personal.locator('li').first().innerText(),/En demora/);assert.doesNotMatch(await personal.locator('li').nth(1).innerText(),/Asignado por/);
 const attention=await page.locator('section[aria-labelledby="dashboard-attention"]').boundingBox(),tasks=await personal.boundingBox(),weather=await page.locator('section[aria-labelledby="dashboard-weather"]').boundingBox();
 assert.ok(weather.y+weather.height<=attention.y && attention.y+attention.height<=tasks.y,'visual order: weather, attention, personal tasks');
 if(process.env.MY_TASKS_SCREENSHOTS){mkdirSync(process.env.MY_TASKS_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.MY_TASKS_SCREENSHOTS+'/my-tasks-'+width+'.png',fullPage:true});}
 await fits(page);await personal.getByRole('link',{name:/Ver tarea:/}).first().click();await readyDetail(page);
 let query=new URL(page.url()).searchParams;assert.equal(query.get('mine'),'1');assert.equal(query.get('planningId'),id);assert.equal(await page.getByRole('button',{name:'Mis tareas',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await drawer(page).getByRole('button',{name:'Iniciar trabajo',exact:true}).count(),0);await fits(page);assert.ok(await drawer(page).locator('.ant-drawer-body').evaluate(el=>el.scrollWidth<=el.clientWidth));
 await drawer(page).getByRole('button',{name:/Close|Cerrar/}).click();await drawer(page).waitFor({state:'hidden'});assert.equal(new URL(page.url()).searchParams.get('mine'),'1');
 await page.goBack();await readyDetail(page);await page.goForward();await drawer(page).waitFor({state:'hidden'});
 await page.goBack();await readyDetail(page);await page.goBack();await personal.getByText('Trabajo personal 1',{exact:true}).waitFor();
 await personal.getByRole('link',{name:'Ver todas mis tareas',exact:true}).click();await page.getByRole('button',{name:'Mis tareas',exact:true}).waitFor();
 await page.waitForFunction(()=>window.__requests.some(r=>r.path==='/planning' && r.params.mine===true && r.params.pageSize===1000));
 assert.ok(!(await page.evaluate(()=>window.__requests)).some(r=>r.path==='/users/planning-responsibles'),'view-only user never requests the write-only assignment catalog');
 assert.equal(new URL(page.url()).search,'?mine=1');assert.deepEqual(await page.evaluate(()=>window.__mutations),[]);await fits(page);
});
test('direct mine URL preserves filters, responsible and mine are exclusive; history restores state',async t=>{
 const page=await open(1024,'/planificaciones?mode=manager&mine=1&responsible=33333333-3333-4333-8333-333333333333&cropId=crop&campaignId=campaign&lotId=lot&status=en_demora&search=Trabajo&from=2026-10-01&to=2026-10-31&planningId='+id);t.after(()=>page.close());await readyDetail(page);
 assert.equal(new URL(page.url()).searchParams.has('responsible'),false);await drawer(page).getByRole('button',{name:/Close|Cerrar/}).click();await drawer(page).waitFor({state:'hidden'});
 await page.getByRole('button',{name:/Más filtros/}).click();const popover=page.locator('.ant-popover:visible');await popover.locator('.ant-select').filter({hasText:'Todos los responsables'}).click();await page.locator('.ant-select-dropdown:visible').getByText('Otra persona',{exact:true}).click();
 await page.waitForFunction(()=>new URLSearchParams(location.search).has('responsible'));let query=new URL(page.url()).searchParams;assert.equal(query.has('mine'),false);assert.equal(query.get('responsible'),'33333333-3333-4333-8333-333333333333');
 await page.getByRole('heading',{name:'Planificaciones',exact:true}).click();await page.getByRole('button',{name:'Mis tareas',exact:true}).click();
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('mine')==='1');query=new URL(page.url()).searchParams;assert.equal(query.has('responsible'),false);
 for(const key of ['cropId','campaignId','lotId','status','search','from','to'])assert.ok(query.has(key),key+' preserved');
 await page.goBack();assert.equal(await page.getByRole('button',{name:'Mis tareas',exact:true}).getAttribute('aria-pressed'),'false');await page.goForward();assert.equal(await page.getByRole('button',{name:'Mis tareas',exact:true}).getAttribute('aria-pressed'),'true');
 const calls=await page.evaluate(()=>window.__requests.filter(r=>r.path==='/planning'));assert.ok(calls.every(r=>!(r.params.mine && r.params.responsible)));assert.ok(calls.some(r=>r.params.mine && r.params.search==='Trabajo' && r.params.cropId==='crop'));
});
for(const mode of ['manager','denied','future','empty'])test('Dashboard permissions and honest empty horizon: '+mode,async t=>{
 const page=await open(390,'/dashboard?mode='+mode);t.after(()=>page.close());
 if(mode==='denied'){await page.getByRole('heading',{name:'Clima',exact:true}).waitFor();assert.equal(await section(page).count(),0);assert.equal((await page.evaluate(()=>window.__requests)).filter(r=>r.path==='/planning').length,0);}
 else if(mode==='manager'){await page.getByRole('heading',{name:'Trabajo del equipo',exact:true}).waitFor();await section(page).getByText('Trabajo personal 1',{exact:true}).waitFor();}
 else {await section(page).getByText('No tenés tareas para hoy ni para los próximos 7 días.',{exact:true}).waitFor();assert.equal(await section(page).getByRole('link',{name:'Ver todas mis tareas'}).getAttribute('href'),'/planificaciones?mine=1');}
 await fits(page);assert.deepEqual(await page.evaluate(()=>window.__mutations),[]);
});

test('failed personal request never leaves the previous general list under Mis tareas',async t=>{
 const page=await open(390,'/planificaciones');t.after(()=>page.close());
 await page.locator('.gs-planning button[aria-label^="Ver detalle"]').first().waitFor();
 await page.evaluate(()=>{window.__failMine=true;});await page.getByRole('button',{name:'Mis tareas',exact:true}).click();
 await page.getByText('Error al cargar planificaciones',{exact:true}).waitFor();
 assert.equal(await page.locator('.gs-planning button[aria-label^="Ver detalle"]').count(),0);
});
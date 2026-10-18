import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync,mkdirSync} from 'node:fs';
import {createServer} from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const id='11111111-1111-4111-8111-111111111111',other=last=>id.slice(0,-1)+last;
let server,browser,origin;
before(async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  server=await createServer({root,configFile:false,plugins:[conversion(),{name:'assignments-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
    if(!['/','/planificaciones'].includes(req.url.split('?')[0]))return next();
    res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/planningAssignments.fixture.jsx"></script>');
  });}}],resolve:{alias:[{find:/.*context\/NotificationsContext(?:\.jsx)?$/,replacement:root.replaceAll('\\','/')+'/tests/planningAssignments.fixtureContext.jsx'}]},
    cacheDir:'../.test-tools/vite-planning-assignments',server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},
    optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']}});
  await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function open(width=1440,search=''){
  const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce',timezoneId:'America/Argentina/Buenos_Aires'});page.setDefaultTimeout(12000);
  page.on('pageerror',e=>console.error('Fixture:',e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin+'/planificaciones'+search,{waitUntil:'domcontentloaded',timeout:60000});
  try{await page.getByRole('heading',{name:'Asignaciones de prueba'}).waitFor();}catch{await page.reload();await page.getByRole('heading',{name:'Asignaciones de prueba'}).waitFor({timeout:60000});}
  return page;
}
const detail=page=>page.locator('.planning-detail-drawer');
const ready=async page=>{
  await detail(page).getByText('Agustina Airasca',{exact:true}).waitFor();
  await page.waitForFunction(()=>{
    const panel=document.querySelector('.planning-detail-drawer');
    const wrapper=panel?.closest('.ant-drawer-content-wrapper');
    if(!wrapper)return false;
    const rect=wrapper.getBoundingClientRect();
    return rect.right<=innerWidth+1 && rect.left>=0 && (innerWidth>767 || rect.top<innerHeight*.2);
  });
};
test('desktop dropdown and mobile card mark read before opening exact planning, responsive 1440/1024/390',async t=>{
  for(const width of [1440,1024,390]){
    const page=await open(width);t.after(()=>page.close());
    await page.getByRole('button',{name:'Notificaciones',exact:true}).click();
    const surface=width===390?page.locator('.notification-drawer'):page.locator('.ant-dropdown');
    await surface.getByText(/Juan Pérez te asignó/).waitFor();
    assert.ok(await surface.evaluate(el=>el.scrollWidth<=el.clientWidth),'notification has no horizontal overflow at '+width);
    if(width===390)await surface.locator('.gs-notification-open').click();else await surface.getByText('Nueva tarea asignada',{exact:true}).click();
    await ready(page);assert.equal(new URL(page.url()).searchParams.get('planningId'),id);
    const events=await page.evaluate(()=>window.__events);assert.ok(events.indexOf('read-finished')<events.indexOf('navigate:?planningId='+id));
    await detail(page).getByText('Juan Pérez',{exact:true}).waitFor();await detail(page).getByText('18/10/2026 · 14:30',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await detail(page).locator('.ant-drawer-body').evaluate(el=>el.scrollWidth<=el.clientWidth),'detail fits at '+width);
    await page.locator('.notification-drawer').waitFor({state:'hidden'});
    if(process.env.ASSIGNMENT_SCREENSHOTS){mkdirSync(process.env.ASSIGNMENT_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.ASSIGNMENT_SCREENSHOTS+'/planning-'+width+'.png'});}
  }
});
test('drawer on desktop also opens exact planning and marks read',async t=>{
 const page=await open();t.after(()=>page.close());await page.getByRole('button',{name:'Abrir notificaciones',exact:true}).click();await page.locator('.notification-drawer .gs-notification-open').click();await ready(page);
 assert.equal(new URL(page.url()).searchParams.get('planningId'),id);assert.ok((await page.evaluate(()=>window.__events)).includes('read-finished'));
});
test('direct link fetches by id outside list, close preserves filters; browser back/forward owns drawer',async t=>{
 const page=await open(1024,'?crop=trigo&page=3&planningId='+id);t.after(()=>page.close());await ready(page);
 assert.ok((await page.evaluate(()=>window.__gets)).includes('/planning/'+id));assert.equal(await page.locator('.gs-planning tbody').getByText('Agustina Airasca').count(),0);
 await detail(page).getByRole('button',{name:/Close|Cerrar/}).click();await detail(page).waitFor({state:'hidden'});
 let url=new URL(page.url());assert.equal(url.searchParams.get('planningId'),null);assert.equal(url.searchParams.get('crop'),'trigo');assert.equal(url.searchParams.get('page'),'3');
 await page.goBack();await ready(page);await page.goForward();await detail(page).waitFor({state:'hidden'});
});
test('ordinary detail opening uses same URL and GET convention',async t=>{
 const page=await open(390,'?listed=1&crop=maiz');t.after(()=>page.close());await page.locator('.gs-planning button[aria-label^="Ver detalle"]').first().click();await ready(page);
 const url=new URL(page.url());assert.equal(url.searchParams.get('planningId'),id);assert.equal(url.searchParams.get('crop'),'maiz');assert.ok((await page.evaluate(()=>window.__gets)).includes('/planning/'+id));
});
for(const [last,expected] of [['2','no existe'],['3','No tenés permiso'],['4','No tenés permiso'],['5','no existe']])test('unavailable/forbidden/disabled/foreign deep link '+last+' is safe',async t=>{
 const page=await open(390,'?planningId='+other(last));t.after(()=>page.close());await detail(page).getByText(new RegExp(expected)).waitFor();assert.equal(await detail(page).getByText('Agustina Airasca').count(),0);assert.doesNotMatch(await detail(page).innerText(),/Do not expose|Hidden technical/);
 await detail(page).getByRole('button',{name:/Close|Cerrar/}).click();assert.equal(new URL(page.url()).searchParams.has('planningId'),false);
});
test('missing frontend permission does not request detail',async t=>{
 const page=await open(1024,'?noPermission=1&planningId='+id);t.after(()=>page.close());await detail(page).getByText('No tenés permiso para ver esta planificación.').waitFor();assert.ok(!(await page.evaluate(()=>window.__gets)).includes('/planning/'+id));
});
test('historical metadata remains undocumented; persisted email fallback displays',async t=>{
 const page=await open(390,'?planningId='+other('6'));t.after(()=>page.close());await ready(page);assert.equal(await detail(page).getByText('No documentado',{exact:true}).count(),2);assert.equal(await detail(page).getByText('Juan Pérez',{exact:true}).count(),0);
 await page.evaluate(url=>window.__navigate(url),'/planificaciones?planningId='+other('7'));await detail(page).getByText('agustina@example.test',{exact:true}).waitFor();await detail(page).getByText('juan@example.test',{exact:true}).waitFor();
});
test('rapid link changes abort stale detail; late responses cannot reopen a closed drawer',async t=>{
 const page=await open(1440);t.after(()=>page.close());
 await page.evaluate(url=>window.__navigate(url),'/planificaciones?planningId='+other('8'));await page.waitForFunction(path=>window.__gets.includes(path),'/planning/'+other('8'));
 await page.evaluate(url=>window.__navigate(url),'/planificaciones?planningId='+id);await ready(page);
 assert.ok((await page.evaluate(()=>window.__aborted)).includes('/planning/'+other('8')));
 await page.evaluate(url=>window.__navigate(url),'/planificaciones?planningId='+other('8'));await detail(page).getByRole('button',{name:/Close|Cerrar/}).click();
 await page.waitForTimeout(800);await detail(page).waitFor({state:'hidden'});assert.equal(new URL(page.url()).searchParams.has('planningId'),false);
});

test('state action refreshes the current deep-linked detail',async t=>{
 const page=await open(390,'?planningId='+id);t.after(()=>page.close());await ready(page);
 await detail(page).getByRole('button',{name:'Iniciar trabajo',exact:true}).click();await detail(page).getByText('En progreso',{exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('planningId'),id);
 assert.ok((await page.evaluate(planningId=>window.__gets.filter(p=>p==='/planning/'+planningId),id)).length>=2);
});
test('very long persisted names wrap inside detail on desktop, tablet and mobile',async t=>{
 for(const width of [1440,1024,390]){
  const page=await open(width,'?planningId='+other('9'));t.after(()=>page.close());await detail(page).getByText(/^Agustina Airasca ApellidoExtenso/).waitFor();
  assert.ok(await detail(page).locator('.ant-drawer-body').evaluate(el=>el.scrollWidth<=el.clientWidth));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
});

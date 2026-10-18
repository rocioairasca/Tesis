import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {realpathSync,mkdirSync} from 'node:fs';import {createServer} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');let server,browser,origin;
before(async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));server=await createServer({root,configFile:false,cacheDir:'../.test-tools/vite-dashboard-layout',plugins:[{name:'dashboard-layout-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/dashboardLayout.fixture.jsx"></script>');});}}],optimizeDeps:{entries:['tests/dashboardLayout.fixture.jsx'],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','@hugeicons/react','@hugeicons/core-free-icons','@ant-design/v5-patch-for-react-19']},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}}});
 await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function open(width,mode){const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce',timezoneId:'America/Argentina/Buenos_Aires'});page.setDefaultTimeout(15000);await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin+'/?mode='+mode,{waitUntil:'domcontentloaded',timeout:60000});
 try{await page.getByRole('heading',{name:'¡Hola, Ana!',exact:true}).waitFor();}catch{await page.reload();await page.getByRole('heading',{name:'¡Hola, Ana!',exact:true}).waitFor({timeout:60000});}
 await page.getByText(mode==='error'?'No se pudo consultar el clima.':'Parcialmente nublado',{exact:true}).waitFor();await page.locator('.gs-ui-loading').waitFor({state:'hidden'});return page;
}
const panel=(page,id)=>page.locator('section[aria-labelledby="dashboard-'+id+'"]');
for(const width of [1440,1024,390])for(const mode of ['normal','single','empty','personal','restricted','fallback','error'])test('Dashboard semantic order and natural panel heights: '+mode+' at '+width,async t=>{
 const page=await open(width,mode);t.after(()=>page.close());
 const expected=['weather',...(!['empty','personal','restricted'].includes(mode)?['attention']:[]),...(mode!=='restricted'?['my-tasks']:[]),...(!['personal','restricted'].includes(mode)?['work','field','production']:[])].map(id=>'dashboard-'+id);
 const layout=await page.locator('.gs-dashboard > section').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {id:el.getAttribute('aria-labelledby'),x:r.x,y:r.y,width:r.width,height:r.height,minHeight:s.minHeight,order:s.order,scroll:el.scrollHeight,client:el.clientHeight};}));
 assert.deepEqual(layout.map(r=>r.id),expected);for(let i=1;i<layout.length;i++)assert.ok(layout[i].y>=layout[i-1].y+layout[i-1].height,'visual order follows DOM');assert.ok(layout.every(r=>r.order==='0'));
 const header=await page.locator('.gs-dashboard > .gs-ui-page-header').boundingBox(),weather=layout[0];assert.ok(weather.y>=header.y+header.height);assert.ok(weather.y+weather.height<950,'weather visible without scrolling');assert.ok(weather.y-header.y-header.height<=20,'no empty row before weather');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');assert.ok(layout.every(r=>Math.abs(r.width-weather.width)<1),'panels fill their row');assert.ok(layout.every(r=>r.scroll<=r.client+1),'content is not clipped');
 const operational=await page.locator('.gs-dashboard-operational').evaluateAll(nodes=>nodes.map(el=>({height:el.getBoundingClientRect().height,minHeight:getComputedStyle(el).minHeight})));
 if(width>=768){assert.ok(operational.every(r=>r.minHeight==='208px'&&r.height>=208));assert.ok(weather.height<260,'compact weather');}
 else assert.ok(operational.every(r=>['auto','0px'].includes(r.minHeight)),'mobile keeps natural height');
 if(['single','empty'].includes(mode)){
  const tasks=panel(page,'my-tasks');await tasks.getByText('No tenés tareas para hoy ni para los próximos 7 días.',{exact:true}).waitFor();assert.equal(await tasks.getByRole('link',{name:'Ver todas mis tareas'}).getAttribute('href'),'/planificaciones?mine=1');
  if(width>=768){const empty=tasks.locator('.gs-ui-empty');assert.equal(await empty.evaluate(el=>getComputedStyle(el).flexGrow),'1');assert.ok(Math.abs((await tasks.boundingBox()).height-(await panel(page,'work').boundingBox()).height)<2);}
 }
 if(mode==='single'){const metric=panel(page,'attention').locator('.gs-ui-metric');assert.equal(await metric.count(),1);assert.ok((await metric.boundingBox()).height<180,'alert remains compact');}
 if(mode==='personal')assert.equal((await page.evaluate(()=>window.__calls)).includes('work'),false);
 if(mode==='fallback'){await panel(page,'weather').getByText('Último dato disponible · Desactualizado',{exact:true}).waitFor();await panel(page,'weather').getByRole('button',{name:'Reintentar',exact:true}).waitFor();}
 if(mode==='normal')assert.ok((await panel(page,'my-tasks').boundingBox()).height>208,'content can grow beyond the minimum');
 if(process.env.DASHBOARD_LAYOUT_SCREENSHOTS&&['normal','single','empty','fallback','error'].includes(mode)){mkdirSync(process.env.DASHBOARD_LAYOUT_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.DASHBOARD_LAYOUT_SCREENSHOTS+'/'+mode+'-'+width+'.png',fullPage:true,animations:'disabled'});}
 if(mode==='error'){await page.evaluate(()=>{window.__weatherRetry=true;});await panel(page,'weather').getByRole('button',{name:'Reintentar',exact:true}).click();await panel(page,'weather').getByText('Parcialmente nublado',{exact:true}).waitFor();assert.equal(await page.locator('.gs-dashboard > section').first().getAttribute('aria-labelledby'),'dashboard-weather');}
});

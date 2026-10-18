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
for(const width of [1440,1024,390])for(const mode of ['normal','single','empty','empty-personal','empty-team','personal','restricted','fallback','error'])test('Dashboard semantic order and natural panel heights: '+mode+' at '+width,async t=>{
 const page=await open(width,mode);t.after(()=>page.close());
 const expected=['weather',...(!['empty','personal','restricted'].includes(mode)?['attention']:[]),...(mode!=='restricted'?['my-tasks']:[]),...(!['personal','restricted'].includes(mode)?['work','field','production']:[])].map(id=>'dashboard-'+id);
 const layout=await page.locator('.gs-dashboard section[aria-labelledby^="dashboard-"]').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {id:el.getAttribute('aria-labelledby'),x:r.x,y:r.y,width:r.width,height:r.height,minHeight:s.minHeight,order:s.order,scroll:el.scrollHeight,client:el.clientHeight};}));
 assert.deepEqual(layout.map(r=>r.id),expected);assert.ok(layout.every(r=>r.order==='0'));
 const header=await page.locator('.gs-dashboard > .gs-ui-page-header').boundingBox(),weather=layout[0];assert.ok(weather.y>=header.y+header.height);assert.ok(weather.y+weather.height<950,'weather visible without scrolling');assert.ok(weather.y-header.y-header.height<=20,'no empty row before weather');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');assert.ok(layout.every(r=>r.scroll<=r.client+1),'content is not clipped');
 const rows=await page.locator('.gs-dashboard > .gs-dashboard-row').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {y:r.y,bottom:r.bottom,width:r.width,panels:[...el.children].map(child=>{const p=child.getBoundingClientRect();return {x:p.x,y:p.y,width:p.width,height:p.height};})};}));
 for(let i=0;i<rows.length;i++){
  const row=rows[i],panels=row.panels;assert.ok(panels.length>0,'no empty row');if(i)assert.ok(row.y>=rows[i-1].bottom);
  if(width>=768&&panels.length===2){assert.ok(Math.abs(panels[0].y-panels[1].y)<1,'pair shares a row');assert.ok(panels[1].x>=panels[0].x+panels[0].width,'left then right');assert.ok(Math.abs(panels[0].width-panels[1].width)<1);assert.ok(Math.abs(panels[0].height-panels[1].height)<1,'balanced heights');}
  else {assert.ok(panels.every(p=>Math.abs(p.width-row.width)<1));for(let j=1;j<panels.length;j++)assert.ok(panels[j].y>=panels[j-1].y+panels[j-1].height);}
 }
 if(width<768)for(let i=1;i<layout.length;i++)assert.ok(layout[i].y>=layout[i-1].y+layout[i-1].height,'mobile DOM order');
 const field=layout.find(p=>p.id==='dashboard-field');if(field)assert.ok(field.y>=rows.at(-1).bottom,'field follows operational rows');
 if(mode!=='error'){
  const stamp=panel(page,'weather').locator('.gs-dashboard-weather-updated');assert.equal(await stamp.evaluate(el=>getComputedStyle(el).textAlign),'right');const box=await stamp.boundingBox();assert.ok(weather.x+weather.width-box.x-box.width<=20,'reading at right edge');
  const title=await panel(page,'weather').getByRole('heading',{name:'Clima',exact:true}).boundingBox(),actions=await panel(page,'weather').locator('.gs-dashboard-weather-actions').boundingBox();assert.ok(actions.x>title.x+title.width,'weather links stay at top right');assert.ok(Math.abs(actions.y-title.y)<5);
  const centered=await panel(page,'weather').locator('.gs-dashboard-weather-summary').evaluate(el=>{
   const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
   return {area:rect(el),groups:[...el.children].map(rect),current:rect(el.querySelector('.gs-dashboard-weather-current')),details:[...el.querySelectorAll('.gs-dashboard-weather-detail')].map(rect)};
  });
  const centerX=(centered.area.left+centered.area.right)/2;
  for(const group of [...centered.groups,centered.current])assert.ok(Math.abs((group.left+group.right)/2-centerX)<2,'weather content centered horizontally');
  assert.ok(Math.abs((centered.groups[0].top-centered.area.top)-(centered.area.bottom-centered.groups.at(-1).bottom))<2,'balanced vertical space around weather content');
  assert.ok(centered.groups.at(-1).bottom<=box.y,'reading stays above timestamp');
  for(const detail of centered.details){assert.ok(detail.top>=centered.current.bottom,'details do not overlap temperature');assert.ok(detail.left>=centered.area.left&&detail.right<=centered.area.right,'details fit weather card');}
  for(let i=1;i<centered.details.length;i++)assert.ok(centered.details[i].left>=centered.details[i-1].right||centered.details[i].top>=centered.details[i-1].bottom,'weather details do not overlap');
 }
 const operational=await page.locator('.gs-dashboard-operational').evaluateAll(nodes=>nodes.map(el=>({height:el.getBoundingClientRect().height,minHeight:getComputedStyle(el).minHeight})));
 if(width>=768){assert.ok(operational.every(r=>r.minHeight==='208px'&&r.height>=208));assert.ok((await panel(page,'weather').locator('.gs-dashboard-section-heading').boundingBox()).height<90,'compact weather header');}
 else assert.ok(operational.every(r=>['auto','0px'].includes(r.minHeight)),'mobile keeps natural height');
 if(['single','empty','empty-personal'].includes(mode)){
  const tasks=panel(page,'my-tasks');await tasks.getByText('No tenés tareas para hoy ni para los próximos 7 días.',{exact:true}).waitFor();assert.equal(await tasks.getByRole('link',{name:'Ver todas mis tareas'}).getAttribute('href'),'/planificaciones?mine=1');
  if(width>=768){const empty=tasks.locator('.gs-ui-empty');assert.equal(await empty.evaluate(el=>getComputedStyle(el).flexGrow),'1');assert.ok(Math.abs((await tasks.boundingBox()).height-(await panel(page,'work').boundingBox()).height)<2);}
 }
 if(mode==='single'){const metric=panel(page,'attention').locator('.gs-ui-metric');assert.equal(await metric.count(),1);assert.ok((await metric.boundingBox()).height<180,'alert remains compact');}
 if(mode==='personal')assert.equal((await page.evaluate(()=>window.__calls)).includes('work'),false);
 if(mode==='fallback'){await panel(page,'weather').getByText('Último dato disponible · Desactualizado',{exact:true}).waitFor();await panel(page,'weather').getByRole('button',{name:'Reintentar',exact:true}).waitFor();}
 if(mode==='normal')assert.ok((await panel(page,'my-tasks').boundingBox()).height>208,'content can grow beyond the minimum');
 if(process.env.DASHBOARD_LAYOUT_SCREENSHOTS&&['normal','single','empty','empty-personal','empty-team','fallback','error'].includes(mode)){mkdirSync(process.env.DASHBOARD_LAYOUT_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.DASHBOARD_LAYOUT_SCREENSHOTS+'/'+mode+'-'+width+'.png',fullPage:true,animations:'disabled'});}
 if(mode==='error'){await page.evaluate(()=>{window.__weatherRetry=true;});await panel(page,'weather').getByRole('button',{name:'Reintentar',exact:true}).click();await panel(page,'weather').getByText('Parcialmente nublado',{exact:true}).waitFor();assert.equal(await page.locator('.gs-dashboard section[aria-labelledby^="dashboard-"]').first().getAttribute('aria-labelledby'),'dashboard-weather');}
});

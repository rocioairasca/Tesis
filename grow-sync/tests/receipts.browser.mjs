import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {realpathSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');let server,browser,origin,cache;
before(async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));cache=mkdtempSync(join(tmpdir(),'growsync-receipts-'));
 server=await createServer({root,configFile:false,cacheDir:cache,plugins:[{name:'receipts-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
  if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/receipts.fixture.jsx"></script>');
 });}}],optimizeDeps:{entries:['tests/receipts.fixture.jsx'],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}}});await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();if(cache?.startsWith(join(tmpdir(),'growsync-receipts-')))rmSync(cache,{recursive:true,force:true});});
async function open(t,width=1440,flags=''){
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.fulfill({contentType:'text/css',body:''}));
 await page.goto(origin+'/'+flags,{waitUntil:'domcontentloaded'});
 if(!flags.includes('menu'))await page.getByRole('heading',{name:flags.includes('denied')?'Inicio':'Remitos',exact:true}).waitFor({timeout:60000});
 return page;
}
const drawer=page=>page.locator('.ant-drawer-open');
async function add(page,name,quantity='2'){
 await drawer(page).getByRole('combobox',{name:'Producto / descripción',exact:true}).fill(name);
 await drawer(page).getByRole('spinbutton',{name:'Cantidad',exact:true}).fill(quantity);
 await drawer(page).getByRole('button',{name:'Agregar',exact:true}).click();
 await drawer(page).getByRole('cell',{name,exact:true}).waitFor();
}
async function noOverflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page without overflow');assert.ok(await drawer(page).locator('.ant-drawer-body').evaluate(el=>el.scrollWidth<=el.clientWidth),'drawer without overflow');}
for(const width of [1440,1024,390])test('capture-only draft, compact lines, submit and read-only detail at '+width,async t=>{
 const page=await open(t,width);await page.getByRole('button',{name:'Cargar remito',exact:true}).click();
 await drawer(page).getByLabel('Proveedor',{exact:true}).fill('Proveedor de prueba');await drawer(page).getByLabel('Número de remito',{exact:true}).fill('R-002');
 await drawer(page).getByLabel('Fecha del documento',{exact:true}).fill('2026-11-14');
 const text=await drawer(page).innerText();assert.ok(!/precio|costo|subtotal|descuento|impuestos|total|moneda/i.test(text));
 await add(page,'Descripción sin match');await add(page,'Línea para quitar','3');await drawer(page).getByRole('button',{name:'Eliminar',exact:true}).last().click();assert.equal(await drawer(page).locator('.receipts-line').count(),1);
 await drawer(page).getByRole('button',{name:'Editar',exact:true}).click();await drawer(page).getByRole('spinbutton',{name:'Cantidad',exact:true}).fill('4.125');await drawer(page).getByRole('button',{name:'Guardar línea',exact:true}).click();
 await drawer(page).getByLabel('Foto o PDF',{exact:true}).setInputFiles({name:'remito-sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 synthetic')});
 await noOverflow(page);
 if(process.env.RECEIPTS_SCREENSHOTS)await page.screenshot({path:join(process.env.RECEIPTS_SCREENSHOTS,'receipts-capture-'+width+'.png'),fullPage:true});
 await drawer(page).getByRole('button',{name:'Guardar borrador',exact:true}).click();await drawer(page).getByRole('button',{name:'Abrir documento: remito-sintetico.pdf',exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.receipts-footer button')].some(b=>b.textContent==='Guardar borrador'&&!b.disabled));await drawer(page).getByRole('button',{name:'Enviar a revisión',exact:true}).click();await drawer(page).getByText('Pendiente de revisión',{exact:true}).waitFor();
 assert.equal(await drawer(page).getByRole('button',{name:'Agregar',exact:true}).count(),0);assert.equal(await drawer(page).getByRole('button',{name:'Guardar borrador',exact:true}).count(),0);assert.equal(await drawer(page).getByRole('button',{name:'Enviar a revisión',exact:true}).count(),0);assert.equal(await drawer(page).getByLabel('Proveedor',{exact:true}).isDisabled(),true);
 const writes=await page.evaluate(()=>window.__receiptWrites);assert.equal(writes.filter(w=>w.url==='/receipts'&&w.method==='post').length,1);const saved=writes.find(w=>w.url.endsWith('/lines'));assert.equal(saved.body.lines.length,1);assert.equal(saved.body.lines[0].quantity,'4.125');assert.equal(saved.body.lines[0].matched_product_id,null);
 assert.ok((await page.evaluate(()=>window.__receiptRequests)).every(r=>r.url.startsWith('/receipts')));await noOverflow(page);
});
test('safe product selector associates existing identity and unsaved line cannot be silently lost',async t=>{
 const page=await open(t);await page.getByRole('button',{name:'Cargar remito',exact:true}).click();const input=drawer(page).getByRole('combobox',{name:'Producto / descripción',exact:true});
 await input.fill('Semilla');await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('Semilla sintética',{exact:true}).click();
 await drawer(page).getByRole('button',{name:'Guardar borrador',exact:true}).click();await drawer(page).getByText('Agregá o cancelá la línea en edición antes de guardar.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__receiptWrites.length),0);
 await drawer(page).getByRole('button',{name:'Agregar',exact:true}).click();await drawer(page).getByRole('button',{name:'Guardar borrador',exact:true}).click();await page.waitForFunction(()=>window.__receiptWrites.some(w=>w.url.endsWith('/lines')));
 const line=await page.evaluate(()=>window.__receiptWrites.find(w=>w.url.endsWith('/lines')).body.lines[0]);assert.equal(line.matched_product_id,'product');assert.equal(line.unit,'kg');assert.equal(line.quantity,null);
});
test('reviewer sees company inbox, corrects operational data and rejects with retained reason',async t=>{
 const page=await open(t,390,'?review');await page.getByRole('heading',{name:'Pendientes de revisión',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Cargar remito',exact:true}).count(),0);
 await page.getByRole('button',{name:'Ver',exact:true}).click();await drawer(page).getByLabel('Proveedor',{exact:true}).fill('Proveedor corregido');await drawer(page).getByRole('button',{name:'Guardar correcciones',exact:true}).click();await page.waitForFunction(()=>window.__receiptWrites.some(w=>w.method==='patch'));
 assert.ok(!/precio|costo|subtotal|descuento|impuestos|total|moneda/i.test(await drawer(page).innerText()));await noOverflow(page);
 await drawer(page).getByRole('button',{name:'Rechazar',exact:true}).click();const modal=page.locator('.ant-modal-content');await modal.getByLabel('Motivo del rechazo',{exact:true}).fill('Falta información');await modal.getByRole('button',{name:'Rechazar',exact:true}).click();await drawer(page).getByText('Rechazado',{exact:true}).waitFor();await drawer(page).getByText('Falta información',{exact:true}).waitFor();assert.equal(await drawer(page).getByRole('button',{name:'Guardar correcciones',exact:true}).count(),0);
});
test('desktop/mobile menus expose Remitos only with capture/review; direct denied route makes no API calls',async t=>{
 for(const flags of ['?menu','?menu&review','?menu&denied']){
  const page=await open(t,1440,flags);await page.getByRole('navigation',{name:'Navegación principal',exact:true}).waitFor({timeout:60000});assert.equal(await page.getByRole('link',{name:'Remitos',exact:true}).count(),flags.includes('denied')?0:1);assert.equal(await page.getByRole('link',{name:'Inventario',exact:true}).count(),0);
 }
 const mobile=await open(t,390,'?mobileMenu');await mobile.getByRole('button',{name:'Más opciones',exact:true}).click();await mobile.getByRole('button',{name:'Remitos',exact:true}).waitFor();
 const denied=await open(t,390,'?denied');assert.equal(await denied.evaluate(()=>window.__receiptRequests.length),0);
});

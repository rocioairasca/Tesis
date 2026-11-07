import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
let server,browser,origin;
before(async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  server=await createServer({root,configFile:false,plugins:[conversion(),{name:'valuations-fixture',configureServer(s){
    s.middlewares.use((req,res,next)=>{
      if(req.url.split('?')[0]!=='/valuation-test') return next();
      res.setHeader('Content-Type','text/html');
      res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/stockBatchValuations.fixture.jsx"></script>');
    });
  }}],cacheDir:join(tmpdir(),'growsync-valuation-vite'),server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},
  optimizeDeps:{entries:[],include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','antd','antd/locale/es_ES','axios','dayjs','dayjs/plugin/customParseFormat.js','@ant-design/v5-patch-for-react-19']}});
  await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function open(t,width=1440,query='') {
  const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});
  page.setDefaultTimeout(20000);t.after(()=>page.close());
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin+'/valuation-test'+query,{waitUntil:'networkidle'});
  if(!query.includes('receipt')){
    await page.getByRole('tab',{name:'Partidas',exact:true}).click();
    await page.getByRole('button',{name:'Ver partida',exact:true}).click();
    await page.getByRole('region',{name:'Valorización',exact:true}).getByText(query.includes('confirmed')?'Confirmada':'Pendiente',{exact:true}).waitFor();
  }
  return page;
}
const region=page=>page.getByRole('region',{name:'Valorización',exact:true});
async function select(page,label,value) {
  await page.locator('.ant-modal:visible').getByLabel(label,{exact:true}).press('ArrowDown');
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:new RegExp('^'+value+'$')}).click();
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const selector of ['.ant-modal-content','.ant-drawer-content']) {
    const boxes=await page.locator(selector).evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>({width:n.clientWidth,scroll:n.scrollWidth})));
    assert(boxes.every(b=>b.scroll<=b.width+1),JSON.stringify(boxes));
  }
}
for(const width of [1440,1024,390]) test('pending → confirmed USD without FX; responsive '+width,async t=>{
  const page=await open(t,width);
  assert.equal(await region(page).getByText('USD 99,00 / kg',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Valorizar',exact:true}).click();
  await select(page,'Estado','Confirmada');
  await page.getByRole('spinbutton',{name:'Costo unitario (USD / kg)'}).fill('3.80');
  await page.getByLabel('Referencia de factura',{exact:true}).fill('FC-00123');
  await page.getByLabel('Fecha factura',{exact:true}).fill('2026-10-10');
  assert.equal(await page.getByLabel(/tipo de cambio/i).count(),0);
  await noOverflow(page);
  await page.getByRole('button',{name:'Guardar valorización',exact:true}).click();
  await region(page).getByText('USD 3,80 / kg',{exact:true}).waitFor();
  const post=await page.evaluate(()=>window.__requests.find(r=>r.method==='post'));
  assert.equal(post.body.unit_cost_original,'3.8');assert.equal(post.body.supersedes_id,null);
  assert(!('fx_rate' in post.body));assert(post.key);await noOverflow(page);
});
test('correction requires reason, keeps predecessor and displays both revisions in history',async t=>{
  const page=await open(t,1440,'?confirmed');
  await page.getByRole('button',{name:'Corregir valorización',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Costo unitario (USD / kg)'}).fill('3.85');
  await page.getByRole('button',{name:'Guardar valorización',exact:true}).click();
  await page.getByText('Indicá el motivo de la nueva revisión.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__requests.filter(r=>r.method==='post').length),0);
  await page.getByLabel('Motivo de la revisión',{exact:true}).fill('Corrección de factura');
  await page.getByRole('button',{name:'Guardar valorización',exact:true}).click();
  await region(page).getByText('USD 3,85 / kg',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__valuations[0].unit_cost_original),'3.800000');
  assert.equal(await page.evaluate(()=>window.__valuations[1].supersedes_id),'revision-one');
  await page.getByRole('button',{name:'Ver historial',exact:true}).click();
  const dialog=page.locator('.ant-modal:visible');
  await dialog.getByText('Revisión 1',{exact:true}).waitFor();
  await dialog.getByText('Revisión 2',{exact:true}).waitFor();
  await dialog.getByText('USD 3,80 / kg',{exact:true}).waitFor();
  await dialog.getByText('USD 3,85 / kg',{exact:true}).waitFor();
});
test('read-only inventory can consult history without write actions',async t=>{
  const page=await open(t,390,'?confirmed&readonly');
  assert.equal(await page.getByRole('button',{name:'Corregir valorización',exact:true}).count(),0);
  await page.getByRole('button',{name:'Ver historial',exact:true}).click();
  await page.locator('.ant-modal:visible').getByText('Revisión 1',{exact:true}).waitFor();
  await noOverflow(page);
});
test('ARS remains pending and unknown price stays null',async t=>{
  const page=await open(t);
  await page.getByRole('button',{name:'Valorizar',exact:true}).click();
  await select(page,'Moneda','ARS');
  await page.getByText('Las valorizaciones en ARS permanecen pendientes en esta etapa.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Guardar valorización',exact:true}).click();
  await region(page).getByText('Revisión 1',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>[window.__valuations[0].status,window.__valuations[0].currency,window.__valuations[0].unit_cost_original]),['pending','ARS',null]);
});
test('retry after lost response reuses key and does not duplicate revision',async t=>{
  const page=await open(t);
  await page.getByRole('button',{name:'Valorizar',exact:true}).click();
  await page.evaluate(()=>{window.__failAfterSave=true;});
  await page.getByRole('button',{name:'Guardar valorización',exact:true}).click();
  await page.locator('.ant-modal:visible').locator('.ant-alert-error').waitFor();
  const retryButton=page.locator('.ant-modal:visible').getByRole('button',{name:'Guardar valorización',exact:true});
  assert.equal(await retryButton.getAttribute('aria-busy'),'false');
  await retryButton.click();
  await region(page).getByText('Revisión 1',{exact:true}).waitFor();
  const result=await page.evaluate(()=>({count:window.__valuations.length,keys:window.__requests.filter(r=>r.method==='post').map(r=>r.key)}));
  assert.equal(result.count,1);assert.equal(result.keys.length,2);assert.equal(result.keys[0],result.keys[1]);
});
test('new physical receipt does not collect or submit legacy monetary values',async t=>{
  const page=await open(t,390,'?receipt');
  await page.getByRole('button',{name:'Agregar',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Moneda',{exact:true}).count(),0);
  assert.equal(await page.getByLabel(/Precio por/).count(),0);
  await page.getByRole('spinbutton').fill('5');
  await page.getByLabel('Fecha de ingreso',{exact:true}).fill('2026-10-01');
  await page.getByRole('button',{name:'Agregar',exact:true}).click();
  await page.getByRole('button',{name:'Registrar ingreso',exact:true}).click();
  await page.waitForFunction(()=>window.__saved===true);
  const body=await page.evaluate(()=>window.__requests.find(r=>r.url.endsWith('/receipts')).body);
  for(const key of ['currency','unit_price','exchange_rate','total_original','total_ars']) assert(body[key]==null);
  assert.equal(body.items[0].quantity,'5.000000');assert.equal(body.items.length,1);
  for(const key of ['currency','unit_price','exchange_rate','total_original','total_ars']) assert(body.items[0][key]==null);await noOverflow(page);
});

test('changing currency does not relabel the previous invoice total',async t=>{
  const page=await open(t,1440,'?confirmed');
  await page.getByRole('button',{name:'Corregir valorización',exact:true}).click();
  await select(page,'Moneda','ARS');
  await page.getByLabel('Motivo de la revisión',{exact:true}).fill('Moneda corregida, importe pendiente');
  await page.getByRole('spinbutton',{name:'Costo unitario (ARS / kg)'}).fill('');
  await page.getByRole('button',{name:'Guardar valorización',exact:true}).click();
  await region(page).getByText('Revisión 2',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__valuations[0].invoice_total_original),'1900.000000');
  assert.equal(await page.evaluate(()=>window.__valuations[1].invoice_total_original),null);
});


const receiptRows=page=>page.locator('.inventory-receipt-list-row');
async function entryCleared(page) {
  await page.waitForFunction(()=>document.activeElement?.id==='product_id');
  assert.equal(await page.getByRole('spinbutton').inputValue(),'');
  assert.equal(await page.getByLabel('Unidad',{exact:true}).inputValue(),'');
  assert.equal(await page.getByPlaceholder('MM/AAAA').inputValue(),'');
  assert.equal(await page.locator('.inventory-receipt-product .ant-select-selection-item').count(),0);
}
async function addReceiptItem(page,name,quantity='1',enter=false) {
  if(name)await select(page,'Producto',name);
  await page.getByRole('spinbutton').fill(quantity);
  if(enter)await page.getByRole('spinbutton').press('Enter');
  else await page.getByRole('button',{name:'Agregar',exact:true}).click();
  await entryCleared(page);
}
for(const width of [1440,1024,390]) test('quick entry, Enter, edit, delete and unchanged receipt payload; responsive '+width,async t=>{
  const page=await open(t,width,'?receipt&create');
  await page.getByLabel('Fecha de ingreso',{exact:true}).fill('2020-01-02');
  await page.getByLabel('Proveedor',{exact:true}).fill('Proveedor de prueba');
  await select(page,'Tipo de comprobante','Remito');
  await page.getByLabel('Número de comprobante',{exact:true}).fill('R-123');
  await page.getByLabel('Notas',{exact:true}).fill('Entrega compartida');
  assert.equal(await page.getByLabel('Unidad',{exact:true}).inputValue(),'kg');
  assert.equal(await page.getByLabel('Unidad',{exact:true}).getAttribute('readonly'),'');
  await page.getByPlaceholder('MM/AAAA').fill('07/2030');
  await page.getByPlaceholder('MM/AAAA').press('Tab');
  await addReceiptItem(page,null,'1.123456');
  assert((await receiptRows(page).filter({hasText:'Producto sintético'}).textContent()).includes('07/2030'));
  await page.getByLabel('Producto',{exact:true}).press('ArrowDown');
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-disabled').getByText('Producto sintético',{exact:true}).waitFor();
  await page.locator('.ant-select-dropdown:visible').getByText('Segundo producto',{exact:true}).click();
  await addReceiptItem(page,null,'2.5',true);
  assert.equal(await receiptRows(page).count(),2);
  assert.equal(await page.evaluate(()=>window.__requests.filter(r=>r.method==='post').length),0);
  const first=receiptRows(page).filter({hasText:'Producto sintético'});
  await first.getByRole('button',{name:'Editar',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton').inputValue(),'1,123456');
  assert.equal(await page.getByPlaceholder('MM/AAAA').inputValue(),'07/2030');
  await page.getByRole('spinbutton').fill('3.25');
  const action=await page.getByRole('button',{name:'Guardar cambios',exact:true}).boundingBox();
  const inputs=await page.locator('.inventory-receipt-entry-fields').boundingBox();
  assert(action.x>=inputs.x+inputs.width);
  await page.getByRole('spinbutton').press('Enter');
  await entryCleared(page);
  assert.equal(await receiptRows(page).count(),2);
  assert((await first.textContent()).includes('3,25'));
  await first.getByRole('button',{name:'Editar',exact:true}).click();
  await page.getByRole('spinbutton').fill('99');
  await page.getByRole('button',{name:'Cancelar edición',exact:true}).click();
  await entryCleared(page);assert((await first.textContent()).includes('3,25'));
  await addReceiptItem(page,'Producto adicional 1','5');
  await receiptRows(page).filter({hasText:'Producto adicional 1'}).getByRole('button',{name:'Eliminar',exact:true}).click();
  assert.equal(await receiptRows(page).count(),2);
  await noOverflow(page);
  const add=await page.getByRole('button',{name:'Agregar',exact:true}).boundingBox();
  assert(add.x>=inputs.x+inputs.width);
  const footer=page.locator('.inventory-receipt-footer');
  const cancel=await footer.getByRole('button',{name:'Cancelar',exact:true}).boundingBox();
  const save=await footer.getByRole('button',{name:'Registrar ingreso',exact:true}).boundingBox();
  const footerBox=await footer.boundingBox();assert(save.x>cancel.x);assert(Math.abs(save.x+save.width-footerBox.x-footerBox.width)<2);
  assert.equal(await page.getByText('Productos agregados',{exact:true}).count(),0);
  assert.equal(await page.getByText(/Presioná Enter/).count(),0);
  if(process.env.INVENTORY_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.INVENTORY_SCREENSHOT_DIR,'receipt-quick-'+width+'.png'),fullPage:true});
  await footer.getByRole('button',{name:'Registrar ingreso',exact:true}).click();
  await page.waitForFunction(()=>window.__saved===true);
  const result=await page.evaluate(()=>({requests:window.__requests.filter(r=>r.method==='post'),saved:window.__saveCount}));
  assert.equal(result.requests.length,1);assert.equal(result.saved,1);
  const r=result.requests[0];assert.equal(r.url,'/products/receipts');assert(r.key);
  assert.equal(r.body.document_type,'Remito');assert.equal(r.body.reference,'R-123');
  assert.equal(r.body.supplier,'Proveedor de prueba');assert.equal(r.body.notes,'Entrega compartida');
  assert.deepEqual(r.body.items.map(i=>[i.product_id,i.quantity,i.unit,i.expiration_year,i.expiration_month]),
    [['product-one','3.250000','kg',2030,7],['product-two','2.500000','L',null,null]]);
});
for(const width of [1440,1024,390]) test('receipt list stops growing after seven rows and scrolls internally '+width,async t=>{
  const page=await open(t,width,'?receipt');
  await addReceiptItem(page,null);
  for(let i=1;i<=6;i++)await addReceiptItem(page,'Producto adicional '+i,'1',i%2===0);
  const list=page.locator('.inventory-receipt-list');
  const seven=await list.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
  assert(seven.scroll<=seven.height+1,JSON.stringify(seven));
  await addReceiptItem(page,'Producto adicional 7');
  const eight=await list.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
  assert.equal(eight.height,seven.height);assert(eight.scroll>eight.height);assert.equal(eight.overflow,'auto');
  await receiptRows(page).last().getByRole('button',{name:'Editar',exact:true}).scrollIntoViewIfNeeded();
  assert(await list.evaluate(el=>el.scrollTop>0));
  await noOverflow(page);
});
test('receipt validates zero, protects draft edits and reuses idempotency key after lost response',async t=>{
  const page=await open(t,390,'?receipt');
  await page.getByLabel('Fecha de ingreso',{exact:true}).fill('2020-01-02');
  await page.getByRole('spinbutton').fill('0');
  await page.getByRole('spinbutton').press('Enter');
  await page.locator('.ant-form-item-explain-error').first().waitFor();
  assert.equal(await receiptRows(page).count(),0);
  await page.getByRole('spinbutton').fill('3');
  await page.getByRole('button',{name:'Registrar ingreso',exact:true}).click();
  await page.getByText('Agregá el producto a la lista antes de registrar el ingreso.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__requests.length),0);
  await page.getByRole('button',{name:'Agregar',exact:true}).click();
  await entryCleared(page);
  await receiptRows(page).getByRole('button',{name:'Editar',exact:true}).click();
  await page.getByRole('spinbutton').fill('4');
  await page.getByRole('button',{name:'Registrar ingreso',exact:true}).click();
  await page.getByText('Guardá o cancelá la edición antes de registrar el ingreso.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__requests.length),0);
  await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
  await entryCleared(page);
  await page.evaluate(()=>{window.__failAfterSave=true;});
  await page.getByRole('button',{name:'Registrar ingreso',exact:true}).click();
  await page.waitForFunction(()=>window.__requests.filter(r=>r.method==='post').length===1);
  await page.getByText('Respuesta interrumpida',{exact:true}).waitFor();
  const retryReceipt=page.locator('.inventory-receipt-footer button[type=submit]:not(.ant-btn-loading):not(:disabled)');
  await retryReceipt.waitFor();
  assert.equal(await page.evaluate(()=>window.__saveCount||0),0);
  await retryReceipt.click();
  await page.waitForFunction(()=>window.__saved===true);
  const result=await page.evaluate(()=>({requests:window.__requests.filter(r=>r.method==='post'),saved:window.__saveCount}));
  assert.equal(result.requests.length,2);assert.equal(result.requests[0].key,result.requests[1].key);assert.equal(result.saved,1);
});
test('create product remains in section header and keeps existing callback',async t=>{
  const page=await open(t,390,'?receipt&create');
  await page.locator('.inventory-receipt-heading').getByRole('button',{name:'Crear nuevo producto',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__createCount),1);
});

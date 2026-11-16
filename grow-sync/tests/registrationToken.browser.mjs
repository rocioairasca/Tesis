import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
let server, browser, origin;
const secret = 'ab'.repeat(32), reference='11111111-1111-4111-8111-111111111111';
const apiOrigin = 'https://registration-test.invalid';
before(async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  server=await createServer({root,configFile:false,envDir:false,cacheDir:join(tmpdir(),'growsync-vite-registration-token'),
    define:{'import.meta.env.VITE_API_URL':JSON.stringify(apiOrigin)},
    plugins:[{name:'registration-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
      if(req.url.split('?')[0]!=='/')return next();
      res.setHeader('Content-Type','text/html');res.end('<script type="module">import * as service from "/src/services/publicService.js"; window.service=service;</script>');
    });}}],server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},optimizeDeps:{include:['axios']}});
  await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});

async function pageFixture(t) {
  const context = await browser.newContext();t.after(()=>context.close());
  const page = await context.newPage(), requests=[], logs=[];
  page.on('console',message=>logs.push(message.text()));
  await page.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.origin===origin)return route.continue();
    if(url.origin!==apiOrigin)return route.abort();
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    requests.push({url:req.url(),headers:req.headers(),body:req.postData(),method:req.method()});
    const payment={id:'12345',externalReference:reference,status:'approved'};
    let json;
    if(url.pathname.endsWith('/preference'))json={registrationToken:secret,preference:{id:'pref',externalReference:reference,checkoutUrl:'https://checkout.example.invalid'}};
    else if(url.pathname==='/api/public/payments' && req.method()==='POST')json={registrationToken:secret,payment:{id:reference,status:'pending'}};
    else if(url.pathname.endsWith('/register-company'))json={company:{id:'company'},message:'ok'};
    else json={payment,found:true};
    await route.fulfill({headers,json});
  });
  await page.goto(origin);await page.waitForFunction(()=>window.service);
  return {page,requests,logs};
}

test('same-tab return retains token in session only; queries and registration send headers then clear it',async t=>{
  const {page,requests,logs}=await pageFixture(t);
  const initial=await page.evaluate(()=>window.service.createMercadoPagoPreference({plan:'basic'}));
  assert.equal(JSON.stringify(initial).includes(secret),false);
  await page.goto(origin+'/?externalReference='+reference+'&payment_id=12345');await page.waitForFunction(()=>window.service);
  const before=await page.evaluate(()=>({session:{...sessionStorage},local:{...localStorage},url:location.href}));
  assert.equal(Object.values(before.session).includes(secret),true);
  assert.equal(JSON.stringify(before.local).includes(secret),false);
  assert.equal(before.url.includes(secret),false);
  await page.evaluate(async ref=>{
    await window.service.getMercadoPagoPaymentByReference(ref);
    await window.service.getMercadoPagoPaymentStatus('12345');
    await window.service.registerCompany({mercadoPagoExternalReference:ref,companyName:'Synthetic',adminName:'Admin',email:'synthetic@example.invalid',password:'synthetic'});
  },reference);
  for(const req of requests.slice(1)) {
    assert.equal(req.headers['x-registration-token'],secret);
    assert.equal(req.headers['x-registration-reference'],reference);
    assert.equal(req.url.includes(secret),false);assert.equal((req.body||'').includes(secret),false);
  }
  assert.equal(JSON.stringify(await page.evaluate(()=>({...sessionStorage}))).includes(secret),false);
  assert.equal(logs.join(' ').includes(secret),false);
});

test('reference from another browser session cannot issue payment queries or registration',async t=>{
  const {page,requests}=await pageFixture(t);
  await page.evaluate(ref=>localStorage.setItem('growsync_mp_external_reference',ref),reference);
  const failures=await page.evaluate(async ref=>{
    const operations=[()=>window.service.getMercadoPagoPaymentByReference(ref),()=>window.service.getMercadoPagoPaymentStatus('12345',ref),()=>window.service.registerCompany({mercadoPagoExternalReference:ref})];
    return Promise.all(operations.map(async fn=>{try{await fn();return false;}catch{return true;}}));
  },reference);
  assert.deepEqual(failures,[true,true,true]);assert.equal(requests.length,0);
});

test('simulation uses session token for confirmation, query and final registration',async t=>{
  const {page,requests,logs}=await pageFixture(t);
  await page.evaluate(async()=>{
    const result=await window.service.createSimulatedPayment({plan:'basic',payment_method:'qr'});
    await window.service.confirmSimulatedPayment(result.payment.id);
    await window.service.getSimulatedPayment(result.payment.id);
    await window.service.registerCompany({paymentId:result.payment.id});
  });
  for(const req of requests.slice(1))assert.equal(req.headers['x-registration-token'],secret);
  assert.equal(JSON.stringify(await page.evaluate(()=>({...localStorage}))).includes(secret),false);
  assert.equal(logs.join(' ').includes(secret),false);
});

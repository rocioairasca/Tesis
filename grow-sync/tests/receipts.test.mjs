import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {metadataPayload,linesPayload} from '../src/features/receipts/receiptPresentation.js';
const read=p=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8'),asModule=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const url=asModule(read('constants/permissions.jsx')),catalog=await import(url),{hasPermission,getEffectivePermissions}=await import(asModule(read('utils/permissions.jsx').replace('"../constants/permissions"',JSON.stringify(url))));
const backend=createRequire(import.meta.url)('../../growsync-backend/constants/permissions.js');
test('receipts catalog agrees in frontend/backend and custom capture grants nothing else',()=>{
 assert.deepEqual(catalog.PERMISSIONS,backend.PERMISSIONS);
 for(const key of ['CAPTURE','REVIEW','APPROVE','VIEW_ECONOMICS'])assert.ok(catalog.PERMISSIONS['RECEIPTS_'+key]);
 const employee={role:3,custom_permissions:['receipts.capture']};assert.deepEqual(getEffectivePermissions(employee),['receipts.capture']);
 for(const p of ['receipts.review','receipts.approve','receipts.view_economics','inventory.view','inventory.edit','planning.view','users.view'])assert.equal(hasPermission(employee,p),false);
 assert.equal(hasPermission({role:0,custom_permissions:['all']},'receipts.review'),true);
});
test('payload builders select only writable operational fields and preserve quantities',()=>{
 const values={supplier_name:'Proveedor',price:12,economics:{total:1},company_id:'forged'};assert.equal(metadataPayload(values).price,undefined);assert.equal(metadataPayload(values).economics,undefined);assert.equal(metadataPayload(values).company_id,undefined);
 const result=linesPayload([{id:'server-id',raw_description:'Documental',quantity:'1.123456',unit:'kg',expiration_date:'',cost:12,match_status:'approved'}]).lines[0];assert.equal(result.quantity,'1.123456');assert.equal(result.expiration_date,null);assert.equal(result.cost,undefined);assert.equal(result.id,undefined);assert.equal(result.match_status,undefined);
});
test('route exists inside authenticated PrivatePage; receipt route enforces capture or review',()=>{
 assert.match(read('App.jsx'),/path="\/remitos" element={<PrivatePage><Receipts \/><\/PrivatePage>}/);
 assert.match(read('features/receipts/Receipts.jsx'),/if\(!capture&&!review\)return <Navigate/);
 for(const file of ['features/receipts/Receipts.jsx','features/receipts/ReceiptDetail.jsx','features/receipts/ReceiptLines.jsx'])assert.doesNotMatch(read(file),/stockService|receiveStock|api\.[a-z]+\(['"`]\/products/);
});

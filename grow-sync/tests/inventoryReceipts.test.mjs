import {test} from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {inventoryReceiptPayload} from '../src/features/inventory/inventoryReceiptModel.mjs';
const products=[{id:'a',name:'A',unit:'kg'},{id:'b',name:'B',unit:'litros'}];
const common={received_date:'2020-01-02',supplier:' Proveedor ',document_type:'Remito',reference:'R-1',notes:' Entrega '};
test('one or multiple products use shared fields, exact quantities and inherited units',()=>{
  for(const items of [[{product_id:'a',quantity:'2.000001'}],[{product_id:'a',quantity:'2.000001'},{product_id:'b',quantity:'0.123456',expiration_period:dayjs('2030-05-01')}]] ){
    const p=inventoryReceiptPayload({...common,items},products);
    assert.equal(p.supplier,'Proveedor');assert.equal(p.notes,'Entrega');assert.equal(p.items.length,items.length);
    assert.equal(p.items[0].quantity,'2.000001');assert.equal(p.items[0].unit,'kg');assert.equal(p.items[0].expiration_month,null);
    if(items.length>1){assert.equal(p.items[1].unit,'L');assert.equal(p.items[1].expiration_month,5);}
    assert(!JSON.stringify(p).includes('unit_price'));
  }
});
test('reject duplicate, unavailable or missing products and empty/invalid quantities',()=>{
  for(const items of [[],[{product_id:'missing',quantity:1}], [{product_id:'a',quantity:1},{product_id:'a',quantity:2}],
    ...[null,'0','-1','1.0000001'].map(quantity=>[{product_id:'a',quantity}])])assert.throws(()=>inventoryReceiptPayload({...common,items},products));
  assert.throws(()=>inventoryReceiptPayload({...common,items:[{product_id:'a',quantity:'1'}]},[{...products[0],enabled:false}]));
});
test('ignores injected monetary/tenant and line unit data; cost remains deferred',()=>{
  const p=inventoryReceiptPayload({...common,company_id:'foreign',items:[{product_id:'a',quantity:1,unit:'L',unit_price:10}]},products);
  assert.equal(p.items[0].unit,'kg');assert.equal(p.company_id,undefined);assert.equal(p.items[0].unit_price,undefined);
});

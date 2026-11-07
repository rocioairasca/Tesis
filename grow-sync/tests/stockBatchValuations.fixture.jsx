import React from 'react';
import {createRoot} from 'react-dom/client';
import '@ant-design/v5-patch-for-react-19';
import ProductDetailDrawer from '../src/features/inventory/components/ProductDetailDrawer';
import ReceiptModal from '../src/features/inventory/components/ReceiptModal';
import api from '../src/services/apiClient';
const query=new URLSearchParams(location.search);
const batch={id:'batch-one',unit:'kg',initial_quantity:'500.000000',available_quantity:'350.000000',origin:'purchase',
  received_date:'2026-10-01',enabled:true,unit_price:'99.000000',currency:'USD',exchange_rate:'1000'};
const product={id:'product-one',name:'Producto sintético',category:'fertilizantes',unit:'kg',enabled:true,on_hand_quantity:'350'};
const first={id:'revision-one',revision:1,supersedes_id:null,status:'confirmed',currency:'USD',unit_cost_original:'3.800000',
  unit_cost_usd:'3.800000',invoice_total_original:'1900.000000',invoice_reference:'FC-00123',invoice_date:'2026-10-10',supplier_name:'Proveedor sintético',
  created_at:'2026-10-10T15:00:00Z',provenance:'manual',reason:null};
window.__valuations=query.has('confirmed')?[first]:[];
window.__requests=[];
const keys=new Map();
api.defaults.adapter=async config=>{
  const body=typeof config.data==='string'?JSON.parse(config.data):config.data;
  const request={url:config.url,method:config.method,body,key:config.headers.get('Idempotency-Key')};
  window.__requests.push(request);
  let data;
  if(config.url.endsWith('/valuation/history')) data={data:[...window.__valuations].reverse()};
  else if(config.url.endsWith('/valuation')) {
    if(config.method==='get') data={batch,status:window.__valuations.at(-1)?.status||'pending',current:window.__valuations.at(-1)||null};
    else {
      if(keys.has(request.key)) data=keys.get(request.key);
      else {
        const row={...body,id:'revision-'+(window.__valuations.length+1),revision:window.__valuations.length+1,
          unit_cost_usd:body.status==='confirmed'?body.unit_cost_original:null,created_at:new Date().toISOString()};
        window.__valuations.push(row);data={valuation:row};keys.set(request.key,data);
      }
      if(window.__failAfterSave) {window.__failAfterSave=false;throw new Error('Respuesta interrumpida');}
    }
  } else if(config.url.endsWith('/batches')) data={data:[batch]};
  else if(config.url.endsWith('/receipts')) {
    data={movements:[]};
    if(window.__failAfterSave){window.__failAfterSave=false;throw new Error('Respuesta interrumpida');}
  }
  else if(config.url.endsWith('/movements')) data={data:[]};
  else throw new Error('Unexpected synthetic request: '+config.url);
  return {data,status:200,statusText:'OK',headers:{},config};
};
createRoot(document.getElementById('root')).render(query.has('receipt')
  ? <ReceiptModal products={[product,{id:'product-two',name:'Segundo producto',unit:'L',enabled:true,on_hand_quantity:'0'}]} product={product} enabled canEdit canCreate={false} onClose={()=>{}} onSaved={()=>{window.__saved=true;window.__saveCount=(window.__saveCount||0)+1;}} />
  : <ProductDetailDrawer product={product} enabled canEdit={!query.has('readonly')} mobile={innerWidth<600}
      onClose={()=>{}} onReceipt={()=>{}} onAdjust={()=>{}} revision={0}/>);

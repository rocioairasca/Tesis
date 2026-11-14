// Synthetic data and local Axios adapter only. No live API/Storage.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router-dom';import {ConfigProvider} from 'antd';
import Receipts from '../src/features/receipts/Receipts';import Sidebar from '../src/layout/Sidebar';import BottomNavigation from '../src/components/NavbarBottom';
import api from '../src/services/apiClient';import {appTheme} from '../src/theme/theme';import {cssVariables} from '../src/theme/tokens';
import '../src/index.css';import '../src/App.css';
const flags=new URLSearchParams(location.search);const permissions=flags.has('denied')?[]:flags.has('review')?['receipts.review']:['receipts.capture'];
const user={id:'employee',email:'synthetic@example.invalid',role:0,company_id:'synthetic-company',custom_permissions:permissions};localStorage.setItem('user',JSON.stringify(user));
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const product={id:'product',name:'Semilla sintética',unit:'kg'};
const rows=flags.has('review')?[{id:'pending',status:'pending_validation',created_by:'someone',created_by_name:'Otra persona',supplier_name:'Proveedor sintético',document_number:'R-1',document_date:'2026-11-14',line_count:1,lines:[{raw_description:'Semilla documental',quantity:'3',unit:'kg',presentation:'Bolsa',supplier_batch:'A1',expiration_date:null}],warnings:[]}]:[];
window.__receiptRequests=[];window.__receiptWrites=[];window.__receiptRows=rows;
api.defaults.adapter=async config=>{
 window.__receiptRequests.push({method:config.method,url:config.url,params:config.params});
 const response=data=>({data:structuredClone(data),status:200,statusText:'OK',headers:{},config});
 if(config.method==='get'){
  if(config.url==='/receipts/products')return response([product]);
  if(['/receipts/mine','/receipts/review'].includes(config.url))return response({data:rows.filter(r=>!config.params.status||r.status===config.params.status),total_count:rows.length,page:1,pageSize:25});
  if(config.url.endsWith('/document-url'))return response({url:location.origin+'/document.pdf',filename:'synthetic.pdf'});
  const row=rows.find(r=>config.url==='/receipts/'+r.id);if(row)return response(row);
 }
 const body=config.data instanceof FormData?{filename:config.data.get('file').name}:JSON.parse(config.data||'{}');window.__receiptWrites.push({method:config.method,url:config.url,body});
 if(config.method==='post'&&config.url==='/receipts'){const row={id:'draft-'+rows.length,status:'draft',created_by:user.id,created_by_name:'Empleado sintético',line_count:0,lines:[],warnings:[],...body};rows.unshift(row);return response(row);}
 const row=rows.find(r=>config.url.startsWith('/receipts/'+r.id));
 if(row){
  if(config.url.endsWith('/lines')){row.lines=body.lines;row.line_count=body.lines.length;}
  else if(config.url.endsWith('/submit'))row.status='pending_validation';
  else if(config.url.endsWith('/reject')){row.status='rejected';row.rejection_reason=body.reason;}
  else if(config.url.endsWith('/document'))Object.assign(row,{source_filename:body.filename,source_mime_type:'application/pdf'});
  else Object.assign(row,body);
  return response(row);
 }
 throw new Error('Unexpected request: '+config.method+' '+config.url);
};
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/remitos']}>
 {flags.has('menu')&&<Sidebar collapsed={false} onCollapse={()=>{}}/>}
 {flags.has('mobileMenu')&&<BottomNavigation/>}
 <Routes><Route path="/remitos" element={flags.has('menu')?<p>Menú de prueba</p>:<Receipts/>}/><Route path="/dashboard" element={<h1>Inicio</h1>}/></Routes>
</MemoryRouter></ConfigProvider>);

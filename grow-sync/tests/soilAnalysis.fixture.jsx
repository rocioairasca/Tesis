// Synthetic UI only: no external APIs, uploads or production documents.
import '@ant-design/v5-patch-for-react-19';
import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';import {ConfigProvider} from 'antd';
import api from '../src/services/apiClient';import {appTheme} from '../src/theme/theme';import {cssVariables} from '../src/theme/tokens';
import SoilAnalysis from '../src/features/lots/soilAnalysis/SoilAnalysis';import LotsOverview from '../src/features/lots/LotsOverview';
import '../src/index.css';import '../src/App.css';
const flags=new URLSearchParams(location.search),lotId='10000000-0000-4000-8000-000000000001',subId='20000000-0000-4000-8000-000000000001';
const user={id:'synthetic',company_id:'synthetic',role:0,custom_permissions:flags.has('denied')?['lots.view']:flags.has('readOnly')?['lots.view','soil_analysis.view']:['lots.view',...['view','create','edit','disable','enable','view_disabled'].map(k=>'soil_analysis.'+k)]};localStorage.clear();localStorage.setItem('user',JSON.stringify(user));
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const lot={id:lotId,name:'Lote sintético',enabled:true,area_ha:20,active_layout:{status:'active',sub_lots:[{id:subId,name:'División sintética',enabled:true,area_ha:10}]}},sub={id:subId,lot_id:lotId,name:'División sintética',enabled:true};
const sample={id:'sample-a',lot_id:lotId,lot_name:lot.name,sub_lot_id:null,sub_lot_name:null,sample_date:'2026-09-22',depth_from_cm:'0.00',depth_to_cm:'20.00',sample_name:'Muestra sintética',sampled_by:'Equipo sintético',results:[{id:'result-a',parameter_name:'pH',method:'Método sintético',unit:'UpH',raw_value:'7,1',numeric_value:'7.100000',result_status:'measured',sort_order:0},{id:'result-b',parameter_name:'Zinc',method:'Método sintético',unit:'ppm',raw_value:'N.R.',numeric_value:null,result_status:'not_requested',sort_order:1}]};
const report={id:'30000000-0000-4000-8000-000000000001',report_number:'SYN-001',laboratory:'Laboratorio sintético',received_date:'2026-10-01',enabled:true,original_filename:'synthetic.pdf',samples:[sample,{...sample,id:'sample-b',sample_name:'Otra muestra sintética',sub_lot_id:subId,sub_lot_name:sub.name,sample_date:'2026-09-23',depth_from_cm:'20.00',depth_to_cm:'40.00'}]};
const reports=flags.has('empty')?[]:[report];window.__soilWrites=[];window.__soilReads=[];window.__soilPreviewFail=flags.has('previewError');window.__soilExternalCalls=0;window.__soilSigns=[];window.__soilAborts=0;window.__soilPreviewDelay=0;window.__soilPreviewTtl=300000;window.__soilUrlMode="valid";
api.defaults.adapter=async config=>{
 const response=data=>({data,status:200,statusText:'OK',headers:{},config});window.__soilReads.push({url:config.url,params:config.params});
 if(config.method==='get'){
  if(config.url.startsWith('/soil-analysis/lot-context/'))return response({lot,lots:[{...lot,sub_lots:[sub]}]});
  if(config.url.endsWith('/file-url')){
   const sequence=window.__soilSigns.length+1;window.__soilSigns.push(sequence);
   if(window.__soilPreviewDelay)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,window.__soilPreviewDelay);config.signal.addEventListener('abort',()=>{clearTimeout(timer);window.__soilAborts++;reject(new Error('Synthetic request cancelled'));},{once:true});});
   if(window.__soilPreviewFail)throw new Error('Synthetic preview unavailable');
   return response({url:window.__soilUrlMode==='empty'?null:location.origin+'/fixture.pdf?signature='+sequence,expires_at:new Date(Date.now()+(window.__soilUrlMode==='expired'?-1000:window.__soilPreviewTtl)).toISOString(),filename:'synthetic.pdf'});
  }
  if(config.url==='/soil-analysis')return response(reports.filter(r=>config.params.enabled==='all'||r.enabled===(config.params.enabled!=='false')));
  return response(structuredClone(reports.find(r=>config.url.endsWith('/'+r.id))));
 }
 let body=config.data;if(body instanceof FormData){body={metadata:JSON.parse(body.get('metadata')),filename:body.get('file').name,isMultipart:true};}else if(typeof body==='string')body=JSON.parse(body);
 window.__soilWrites.push({url:config.url,method:config.method,body});
 if(config.method==='delete'||config.url.endsWith('/enable')){const r=reports.find(r=>config.url.includes(r.id));r.enabled=config.method!=='delete';return response({id:r.id,enabled:r.enabled});}
 const metadata=body.metadata||body,r=config.method==='put'?reports.find(r=>config.url.endsWith('/'+r.id)):{id:crypto.randomUUID(),enabled:true,original_filename:body.filename};
 Object.assign(r,metadata,{samples:metadata.samples.map((s,i)=>({...s,id:crypto.randomUUID(),lot_name:lot.name,sub_lot_name:s.sub_lot_id?sub.name:null,results:s.results.map(result=>({...result,id:crypto.randomUUID()}))}))});
 if(config.method==='post')reports.push(r);return response(structuredClone(r));
};
function Debug(){const route=useLocation();useEffect(()=>{window.__soilRoute=route.pathname+route.search;},[route]);return null;}
function MapStub({rows,onSelect}){return <div>{rows.flatMap(row=>[row,...row.children]).map(row=><button key={row.key} onClick={()=>onSelect(row.key)}>Seleccionar {row.name}</button>)}</div>;}
const source={lots:async()=>[lot],productive:async()=>({})};
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={[flags.has('lots')?'/lotes':'/lotes/'+lotId+'/analisis-suelo'+(flags.has('sub')?'?subLotId='+subId:'')]}><Debug/><Routes><Route path="/lotes" element={<LotsOverview user={user} source={source} MapView={MapStub} tiles={false} />} /><Route path="/lotes/:lotId/analisis-suelo" element={<SoilAnalysis/>} /></Routes></MemoryRouter></ConfigProvider>);

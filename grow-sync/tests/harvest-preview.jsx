// Isolated browser fixture: no network, real storage changes or geolocation.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import AppLayout from '../src/layout/Layout';
import Harvest from '../src/features/harvest/Harvest';
import BottomNavigation from '../src/components/NavbarBottom';
import useIsMobile from '../src/hooks/useIsMobile';
import { NotificationsProvider } from '../src/context/NotificationsContext';
import api from '../src/services/apiClient';
import { appTheme } from '../src/theme/theme';
import { cssVariables } from '../src/theme/tokens';
import '../src/index.css';
import '../src/App.css';
import '../src/layout/shell.css';
import '@ant-design/v5-patch-for-react-19';
const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
const user={id:'author',role:scenario==='readonly'?0:3,full_name:'Ana Pérez',nickname:'Ana',company_name:'Establecimiento de prueba',custom_permissions:scenario==='readonly'?['harvest.view']:['all']};
Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>key==='user'?JSON.stringify(user):null,setItem:()=>{},removeItem:()=>{}}});
const geom={type:'Polygon',coordinates:[[[-63,-32],[-62.998,-32],[-62.998,-31.998],[-63,-31.998],[-63,-32]]]};
const lots=[{id:'lot',name:'Lote 15',area_ha:38.46,geom,active_layout:{sub_lots:[{id:'sub',name:'15-A',area_ha:25.02,geom}]}},{id:'whole',name:'Lote 8',area_ha:45.2,geom}];
const long='TEST TEMP — Cosechas parciales — 20260909 — Nombre extenso de prueba';
let records=scenario==='empty'?[]:Array.from({length:14},(_,i)=>({id:String(i+1),lot_id:i%2?'whole':'lot',lot_name:i%2?'Lote 8':'Lote 15',sub_lot_id:i%2?null:'sub',sub_lot_name:i%2?null:'15-A',crop_id:i%3===0?'maiz':'soja',crop_name:i===3?long:i%3===0?'Maíz':'Soja',campaign_name:scenario==='seasonal'?'Gruesa':i===3?long:i%2?'2025/26':'2026/27',harvest_date:'2026-09-10',production_kg:12500+i*1000,harvested_area_ha:5,yield_kg_ha:(12500+i*1000)/5,created_by:i===1?'missing-author':'author',created_at:'2026-09-10T15:00:00Z',registered_retroactively:i%3===0?true:i%3===1?false:null,retroactive_reason:'pending_record',notes:i===0?'Cosecha parcial de la superficie seleccionada.':null,enabled:i!==2,has_productive_cycle:true}));
const active=p=>records.filter(r=>r.enabled&&(!p.campaign||r.campaign_name===p.campaign)&&(!p.crop||r.crop_name===p.crop));
const aggregate=rows=>({total_records:rows.length,total_production_kg:rows.reduce((s,r)=>s+r.production_kg,0),total_area_ha:rows.reduce((s,r)=>s+r.harvested_area_ha,0),avg_yield_kg_ha:rows.length?rows.reduce((s,r)=>s+r.production_kg,0)/(rows.length*5):null});
const grouped=(rows,key)=>[...new Set(rows.map(r=>r[key]))].map(name=>{const sum=aggregate(rows.filter(r=>r[key]===name));return {[key==='crop_name'?'crop':'campaign']:name,production_kg:sum.total_production_kg,area_ha:sum.total_area_ha,yield_kg_ha:sum.avg_yield_kg_ha};});
api.defaults.adapter=async config=>{
 const p=config.params||{};let data;
 if(config.url==='/lots')data={data:lots,total:lots.length};
 else if(config.url==='/crops')data=[{id:'maiz',name:'Maíz'},{id:'soja',name:'Soja'}];
 else if(config.url==='/users')data={data:[user],total:1};
 else if(config.url==='/lots/productive-states')data=lots.map(lot=>({lot_id:lot.id,units:[{lot_id:lot.id,current_crop:{crop_id:'soja',crop_name:'Soja',campaign_name:'2026/27'}},...(lot.active_layout?.sub_lots||[]).map(sub=>({lot_id:lot.id,sub_lot_id:sub.id,current_crop:{crop_id:'soja',crop_name:'Soja',campaign_name:'2026/27'}}))]}));
 else if(config.url.endsWith('/context'))data={assignments:[{id:'cycle',crop_name:'Soja',campaign_name:'2026/27',start_date:'2026-01-01',remaining_area_ha:20,total_area_ha:25,harvested_area_ha:5}]};
 else if(config.url.endsWith('/stats/filters'))data={campaigns:[...new Set(records.map(r=>r.campaign_name))],crops:[...new Set(records.map(r=>r.crop_name))]};
 else if(config.url.endsWith('/stats/summary'))data=aggregate(active(p));
 else if(config.url.endsWith('/stats/by-crop'))data=grouped(active(p),'crop_name');
 else if(config.url.endsWith('/stats/by-campaign'))data=grouped(active(p),'campaign_name');
 else if(config.method==='get'){if(scenario==='error')throw new Error('Error de prueba');const rows=records.filter(r=>(p.onlyDisabled==='true'?!r.enabled:p.includeDisabled==='true'||r.enabled)&&(!p.campaign||r.campaign_name===p.campaign)&&(!p.crop||r.crop_name===p.crop));data={data:rows.slice((p.page-1)*p.pageSize,p.page*p.pageSize),pagination:{total:rows.length,page:p.page,pageSize:p.pageSize,totalPages:Math.ceil(rows.length/p.pageSize)}};}
 else if(config.method==='post'){const values=JSON.parse(config.data);records.unshift({...values,id:'new',crop_name:'Soja',lot_name:'Lote 8',campaign_name:'2026/27',enabled:true,created_by:'author',yield_kg_ha:values.production_kg/values.harvested_area_ha});data=records[0];}
 else {const row=records.find(r=>r.id===config.url.split('/')[2]);if(config.method==='put'){Object.assign(row,JSON.parse(config.data));row.yield_kg_ha=row.production_kg/row.harvested_area_ha;}else row.enabled=config.url.endsWith('/enable');data=row;}
 return {data,status:200,statusText:'OK',headers:{},config};
};
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
function Preview(){const mobile=useIsMobile();return <NotificationsProvider><AppLayout><Harvest/></AppLayout>{mobile&&<BottomNavigation/>}</NotificationsProvider>;}
if(import.meta.env.DEV)createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/harvest']}><Preview/></MemoryRouter></ConfigProvider>);

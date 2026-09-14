// Isolated browser fixture: no network, real storage changes or geolocation.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import AppLayout from '../src/layout/Layout';
import RainRecords from '../src/features/rainRecords/RainRecords';
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
const user={nickname:'Ana',company_name:'Establecimiento de prueba',custom_permissions:scenario==='readonly'?['rain_records.view']:['all']};
Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>key==='user'?JSON.stringify(user):null,setItem:()=>{},removeItem:()=>{}}});
Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:success=>success({coords:{latitude:0,longitude:0}})}});
let records=scenario==='empty'?[]:[{id:1,date:'2026-09-12',rain_mm:2.5,source:'manual',enabled:true,notes:'Lluvia pareja durante la mañana.'},...(scenario==='single'?[]:[{id:2,date:'2026-08-24',rain_mm:38,source:'api',enabled:true},{id:3,date:'2026-07-09',rain_mm:17,source:'edited_api',enabled:true,notes:'Lectura corregida con el pluviómetro del establecimiento.'},{id:4,date:'2026-06-01',rain_mm:3,source:'manual',enabled:false}])];
api.defaults.adapter=async config=>{
 if(scenario==='loading')await new Promise(resolve=>setTimeout(resolve,20000));
 if(scenario==='error')throw new Error('fixture error');
 let data;
 if(config.url.endsWith('/stats/monthly')){const months=new Map();records.filter(r=>r.enabled).forEach(r=>months.set(r.date.slice(0,7),(months.get(r.date.slice(0,7))||0)+r.rain_mm));data=[...months].map(([month,rain_mm])=>({month,rain_mm}));}
 else if(config.method==='get'){const rows=records.filter(r=>config.params.onlyDisabled?!r.enabled:config.params.includeDisabled||r.enabled);data={data:rows,pagination:{page:1,pageSize:10,total:rows.length,totalPages:1}};}
 else if(config.url.endsWith('sync-today'))data={skipped:true,message:'Prueba: sincronización omitida.'};
 else if(config.method==='post'){records.unshift({...JSON.parse(config.data),id:5,enabled:true});data=records[0];}
 else {const id=Number(config.url.split('/')[2]);const row=records.find(r=>r.id===id);if(config.method==='put')Object.assign(row,JSON.parse(config.data),{source:row.source==='api'?'edited_api':row.source});else row.enabled=config.url.endsWith('/enable');data=row;}
 return {data,status:200,statusText:'OK',headers:{},config};
};
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
function Preview(){const mobile=useIsMobile();return <NotificationsProvider><AppLayout><RainRecords/></AppLayout>{mobile&&<BottomNavigation/>}</NotificationsProvider>;}
if(import.meta.env.DEV)createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/registro-lluvias']}><Preview/></MemoryRouter></ConfigProvider>);

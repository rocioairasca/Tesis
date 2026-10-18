// Real Dashboard with a synthetic source. No API, geolocation or session writes.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {ConfigProvider} from 'antd';
import Dashboard from '../src/features/dashboard/Dashboard';import {appTheme} from '../src/theme/theme';import {cssVariables} from '../src/theme/tokens';
import '../src/index.css';import '../src/App.css';import '../src/layout/shell.css';
const mode=new URLSearchParams(location.search).get('mode')||'normal';
const personal=mode==='personal',restricted=mode==='restricted',empty=['empty','single'].includes(mode);
const user={id:'fixture',full_name:'Ana Pérez',role:personal||restricted?0:2,...(personal?{custom_permissions:['planning.view','rain_records.view']}:restricted?{custom_permissions:['rain_records.view']}:{})};
const tasks=Array.from({length:mode==='many'?6:2},(_,i)=>({id:'task-'+i,title:'Trabajo de prueba '+(i+1),activity_type:'riego',status:'pendiente',status_effective:'pendiente',start_at:'2026-10-18T00:00:00Z',end_at:'2026-10-18T00:00:00Z',taskGroup:'today',isToday:true,crop_name:'Maíz',responsible_name:'Ana Pérez',lots:[{name:'Lote Norte',lot_name:'Lote Norte'}]}));
window.__calls=[];window.__weatherRetry=false;
const result=(key,data)=>{window.__calls.push(key);return Promise.resolve(data);};
const source={
 delayed:()=>result('delayed',['empty','single','personal'].includes(mode)?0:1),
 inventory:()=>result('inventory',mode==='empty'?{}:mode==='single'?{low:1}:{low:2,empty:1,expired:1}),
 myTasks:()=>result('myTasks',{rows:empty?[]:tasks,total:empty?0:tasks.length}),
 work:()=>result('work',empty?[]:tasks),
 weather:()=>{window.__calls.push('weather');if(mode==='error'&&!window.__weatherRetry)return Promise.reject(Error('Synthetic weather failure'));return Promise.resolve({reading:{temperature:21.4,humidity:64,wind_speed:12.8,wind_direction:45,weather_code:2,observed_at:'2026-10-18T12:00:00Z'},fallback:mode==='fallback',retryable:true});},
 field:()=>result('field',{lots:3}),fieldMap:()=>result('fieldMap',{area:120,divisions:2,geometries:[],missing:0}),
 filters:()=>result('filters',{campaigns:[],crops:[]}),production:()=>result('production',{summary:{total_records:0},byCrop:[],byCampaign:[]}),
};
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter><main style={{padding:16,maxWidth:1400,margin:'auto',minWidth:0}}><Dashboard source={source} user={user} today="2026-10-18"/></main></MemoryRouter></ConfigProvider>);

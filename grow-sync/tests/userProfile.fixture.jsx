import {renderUserOption} from '../src/components/users/UserOption';
// Synthetic identities and adapter only; no real auth/session/network.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {ConfigProvider,Select} from 'antd';
import Header from '../src/layout/Header';import {FixtureNotifications} from './dashboardNotifications.fixtureContext';
import api from '../src/services/apiClient';import {userOptions} from '../src/utils/userDisplay.mjs';
import {appTheme} from '../src/theme/theme';import {cssVariables} from '../src/theme/tokens';
import '../src/index.css';import '../src/App.css';import '../src/layout/shell.css';
const mode=new URLSearchParams(location.search).get('mode');
const cached={id:'self',full_name:mode==='empty'?null:'Rocío Airasca',email:'rocio@example.test',role:0,enabled:true,company_id:'company',custom_permissions:['planning.view']};
localStorage.clear();localStorage.setItem('user',JSON.stringify(cached));window.__marked=[];window.__profileReads=0;window.__profileWrites=[];window.__profileFailGet=mode==='loadError';window.__profileFailSave=false;window.__profileDelay=100;
const profile={id:'self',full_name:mode==='empty'?null:'Nombre actual del servidor',email:cached.email,role:0,enabled:true,company_id:'company',company_name:'Empresa de prueba'};
api.defaults.adapter=async config=>{
 await new Promise(resolve=>setTimeout(resolve,window.__profileDelay));
 const fail=()=>{const error=new Error('Synthetic profile error');error.response={status:503,data:{message:'No pudimos completar la operación. Intentá nuevamente.'}};throw error;};
 if(config.method==='get'&&config.url==='/users/me'){window.__profileReads++;if(window.__profileFailGet)fail();return {data:{...profile},status:200,headers:{},config};}
 if(config.method==='patch'&&config.url==='/users/me/profile'){const body=JSON.parse(config.data);window.__profileWrites.push(body);if(window.__profileFailSave)fail();profile.full_name=body.full_name.trim();return {data:{...profile},status:200,headers:{},config};}
 throw Error('Unexpected synthetic request '+config.url);
};
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const options=userOptions([{id:'named',full_name:'Juan Pérez',email:'juan@example.test'},{id:'unnamed',full_name:null,email:'sin-nombre@example.test'}]);
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter><FixtureNotifications><Header companyName="Empresa de prueba"/><main><h1>Perfil de prueba</h1><Select aria-label="Responsable de prueba" style={{width:260}} options={options} optionRender={renderUserOption} onChange={value=>{window.__responsible=value;}}/></main></FixtureNotifications></MemoryRouter></ConfigProvider>);

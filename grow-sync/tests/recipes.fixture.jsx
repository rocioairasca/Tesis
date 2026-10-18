// Synthetic UI acceptance fixture. All requests are intercepted in memory.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import Sidebar from '../src/layout/Sidebar';
import NavbarBottom from '../src/components/NavbarBottom';
import GuardedRoute from '../src/routes/GuardedRoute';
import UserTable from '../src/components/users/UserTable';
import {PERMISSIONS} from '../src/constants/permissions';
import {ConfigProvider} from 'antd';
import {appTheme} from '../src/theme/theme';
import {cssVariables} from '../src/theme/tokens';
import api from '../src/services/apiClient';
import Recipes from '../src/features/recipes/Recipes';
import '../src/index.css';
import '../src/App.css';
const mode=new URLSearchParams(location.search).get('mode');
const actions=['view','create','edit','disable','enable','view_disabled'];
const user={id:'advisor',email:'advisor@example.test',role:0,custom_permissions:mode==='editor'?['users.permissions']:mode==='none'?[]:mode==='view'?['recipes.view']:actions.map(action=>(mode==='legacy'?'usage.':'recipes.')+action)};
localStorage.clear();localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('access_token','synthetic-only');
window.__permissionWrites=[];
window.fetch=async(url,options={})=>{
 let data;
 if(String(url).endsWith('/debug/me'))data={user};
 else if(String(url).includes('/users/email/'))data=user;
 else if(String(url).endsWith('/users/target/permissions')&&options.method==='PUT'){window.__permissionWrites.push(JSON.parse(options.body));data={};}
 else throw Error('Unexpected fixture fetch: '+url);
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const products=[{id:'liquid',name:'Glifosato',unit:'L',enabled:true},{id:'adjuvant',name:'Coadyuvante',unit:'L',enabled:true},{id:'mass',name:'Fertilizante',unit:'kg',enabled:true}];
const catalog={products,crops:[{id:'corn',name:'Maíz',enabled:true}]};
const rows=[{id:'a',name:'Barbecho Maíz',activity_type:'fumigacion',field_context:'stubble',crop_id:'corn',crop_name:'Maíz',enabled:true,
  items:[{id:'ia',product_id:'liquid',product_name:'Glifosato',product_unit:'L',product_enabled:true,dose_amount:'2.500000',dose_unit:'L'}]},
  {id:'b',name:'Fertilización general',activity_type:'fertilizacion',field_context:null,crop_id:null,crop_name:null,enabled:true,
    items:[{id:'ib',product_id:'mass',product_name:'Fertilizante',product_unit:'kg',product_enabled:true,dose_amount:'300',dose_unit:'g'}]},
  {id:'c',name:'Receta anterior',activity_type:'fumigacion',field_context:'fallow',crop_id:null,crop_name:null,enabled:false,
    items:[{id:'ic',product_id:'liquid',product_name:'Glifosato',product_unit:'L',product_enabled:true,dose_amount:'1',dose_unit:'L'}]}];
window.__recipeRows=rows;window.__recipeWrites=[];
api.defaults.adapter=async config=>{
  const response=data=>({data,status:200,statusText:'OK',headers:{},config});
  const path=config.url,method=config.method;
  if(path==='/users'&&method==='get')return response([{id:'target',email:'target@example.test',full_name:'Asesor',role:0,custom_permissions:[]}]);
  if(path==='/recipes/options'&&method==='get')return response(catalog);
  if(path==='/recipes'&&method==='get')return response(rows.filter(r=>config.params.enabled==='all'||r.enabled===(config.params.enabled!=='false')).map(r=>structuredClone(r)));
  if(!path.startsWith('/recipes'))throw new Error('Unexpected operational request: '+path);
  window.__recipeWrites.push({method,path,body:config.data?JSON.parse(config.data):null});
  if(method==='delete'||path.endsWith('/enable')){
    const row=rows.find(r=>r.id===path.split('/')[2]);row.enabled=path.endsWith('/enable');return response(structuredClone(row));
  }
  if(method==='post'||method==='put'){
    const body=JSON.parse(config.data),existing=rows.find(r=>r.id===path.split('/')[2]);
    const next={...body,id:existing?.id||'new-'+rows.length,enabled:existing?.enabled??true,crop_name:catalog.crops.find(c=>c.id===body.crop_id)?.name||null,
      items:body.items.map((i,n)=>{const p=products.find(p=>p.id===i.product_id);return {...i,id:'item-'+n,product_name:p.name,product_unit:p.unit,product_enabled:true};})};
    if(existing)Object.assign(existing,next);else rows.push(next);return response(structuredClone(next));
  }
  throw new Error('Unexpected fixture request');
};
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/usage']}>{mode==='editor'?<UserTable/>:<>
 {(mode==='nav'||mode==='none')&&(innerWidth>767?<Sidebar collapsed={false} onCollapse={()=>{}}/>:<NavbarBottom/>)}
 <Routes><Route path="/usage" element={<GuardedRoute requiredPermission={PERMISSIONS.RECIPES_VIEW}><Recipes/></GuardedRoute>}/><Route path="/dashboard" element={<p>Sin acceso a Recetas</p>}/></Routes>
 </>}</MemoryRouter></ConfigProvider>);

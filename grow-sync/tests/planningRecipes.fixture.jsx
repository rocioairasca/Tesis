// Real Planning UI with synthetic API only. No credentials or operational effects.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ConfigProvider} from 'antd';
import {MemoryRouter} from 'react-router-dom';
import {appTheme} from '../src/theme/theme';
import {cssVariables} from '../src/theme/tokens';
import api from '../src/services/apiClient';
import '../src/index.css';
import '../src/App.css';
localStorage.clear();localStorage.setItem('user',JSON.stringify({id:'user',role:0,custom_permissions:['planning.view','planning.create','planning.edit']}));
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const items=[{product_id:'glifo',product_name:'Glifosato',product_unit:'L',dose_amount:'2.5',dose_unit:'L',available_quantity:'5'},
  {product_id:'finesse',product_name:'Finesse',product_unit:'kg',dose_amount:'15',dose_unit:'g',available_quantity:'100'},
  {product_id:'mso',product_name:'MSO',product_unit:'L',dose_amount:'250',dose_unit:'mL',available_quantity:'100'}];
const recipes=[{id:'fresh',name:'Mezcla nueva',activity_type:'fumigacion',field_context:'stubble',crop_id:'crop',crop_name:'Maíz',items},
  {id:'old',name:'Fuente renombrada',activity_type:'fumigacion',field_context:'stubble',crop_id:'crop',crop_name:'Maíz',items:[{...items[0],dose_amount:'99'}]}];
const row={id:'plan',status:'planificado',activity_type:'fumigacion',field_context:'stubble',crop_id:'crop',crop_name:'Maíz',campaign_id:'campaign',campaign_name:'2026',
  start_at:'2026-10-15',end_at:'2026-10-15',responsible_user:'user',recipe_id:'old',recipe_name_snapshot:'Nombre guardado',
  lots:[{lot_id:'lot',id:'lot',name:'Lote de prueba',lot_name:'Lote de prueba',area_ha:25,effective_area_ha:10}],planned_area_ha:10,
  products:[{id:'pp',product_id:'glifo',name:'Glifosato',amount:'25.000000',unit:'L',dose_amount:'2.500000',dose_unit:'L',available_quantity:'5'}]};
window.__planningRecipeWrites=[];
api.defaults.adapter=async config=>{
  const response=data=>({data,status:200,statusText:'OK',headers:{},config});
  if(config.method!=='get'){
    if(config.url!=='/planning'&&config.url!=='/planning/register-completed'&&!config.url.startsWith('/planning/plan'))throw new Error('Unexpected operational write: '+config.url);
    window.__planningRecipeWrites.push({path:config.url,method:config.method,body:JSON.parse(config.data)});return response({id:'saved',ok:true});
  }
  if(config.url==='/planning/plan')return response(row);
  if(config.url==='/planning')return response({data:[row],total:1});
  if(config.url==='/planning/recipe-options')return response(recipes.filter(r=>r.activity_type===config.params.activity_type&&r.field_context===config.params.field_context&&r.crop_id===config.params.crop_id));
  if(config.url==='/users/planning-responsibles')return response([{id:'user',full_name:'Responsable'}]);
  if(config.url==='/crops')return response([{id:'crop',name:'Maíz'}]);
  if(config.url==='/lots')return response([{id:'lot',name:'Lote de prueba',area_ha:25}]);
  if(config.url==='/products')return response(items.map(i=>({id:i.product_id,name:i.product_name,unit:i.product_unit,available_quantity:i.available_quantity})));
  if(config.url==='/campaigns')return response([{id:'campaign',name:'2026',start_date:'2026-01-01',end_date:'2026-12-31',status:'active'}]);
  return response([]);
};
const {default:Planning}=await import('../src/features/planning/Planning.jsx');
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/planificaciones']}><Planning /></MemoryRouter></ConfigProvider>);

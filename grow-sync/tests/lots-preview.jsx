// Development only: fake geometry and mutations in memory, no API or storage.
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Link, useLocation } from 'react-router-dom';
import { ConfigProvider, Select } from 'antd';
import LotsOverview from '../src/features/lots/LotsOverview';
import { fixtureLots, fixtureProductive } from './lotsOverview.fixtures.mjs';
import { appTheme } from '../src/theme/theme';
import { cssVariables } from '../src/theme/tokens';
import Sidebar from '../src/layout/Sidebar';
import useIsMobile from '../src/hooks/useIsMobile';
import '../src/App.css';
import '../src/index.css';
import '../src/layout/shell.css';
import '@ant-design/v5-patch-for-react-19';

function Preview() {
  const [tiles,setTiles] = useState(false);
  const [mode, setMode] = useState('normal'), [notice, setNotice] = useState('');
  const [data, setData] = useState(fixtureLots);
  const location = useLocation();
  const source = useMemo(() => {
    let failures = 0;
    const delay = async () => new Promise(resolve => setTimeout(resolve, mode === 'loading' ? 7000 : 160));
    return {
      lots: async ({ includeDisabled }) => { await delay(); if (mode === 'error' && failures++ === 0) throw new Error('Network Error'); return mode === 'empty' ? [] : (mode === 'distant' ? [...data,{id:'far',name:'Lote distante',area:12,enabled:true,location:[[{lng:-58,lat:-28},{lng:-57.99,lat:-28},{lng:-57.99,lat:-27.99},{lng:-58,lat:-28}]]}] : data).filter(lot => includeDisabled || lot.enabled).map(lot => {
  if(mode === 'invalid') return {...lot,location:[[null,null,null,null]],active_layout:null};
  if(mode !== 'legacy' || !lot.location) return lot;
  const rings=JSON.parse(lot.location).map(ring=>ring.slice(0,-1).map(p=>({lat:String(p.lat),lng:String(p.lng)})));
  return {...lot,location:JSON.stringify(rings)};
}); },
      productive: async () => { await delay(); if (mode === 'productive-error') throw new Error('Network Error'); return fixtureProductive; },
    };
  }, [mode, data]);
  const user = { id: 'fixture', company_id: 'fixture-only', role: 2, ...(mode === 'readonly' ? { custom_permissions: ['lots.view'] } : {}) };
  const change = async (lot, enabled) => { await new Promise(resolve => setTimeout(resolve, 200)); setData(rows => rows.map(row => row.id === lot.id ? { ...row, enabled } : row)); setNotice(`${lot.name}: ${enabled ? 'habilitado' : 'deshabilitado'} en memoria.`); };
  return <main style={{ maxWidth: 1500, margin: '0 auto', padding: '24px 16px' }}><aside style={{ marginBottom: 24 }}><p>Vista de desarrollo · geometrías ficticias · sin operaciones reales</p><label><input type="checkbox" checked={tiles} onChange={event => setTiles(event.target.checked)} />Cargar tiles de los proveedores actuales</label><Select aria-label="Escenario de prueba" value={mode} onChange={setMode} style={{ width: '100%', maxWidth: 300 }} options={[['normal','Con datos'],['distant','Lote distante'],['legacy','Legacy abierto y números en texto'],['invalid','Geometrías inválidas'],['empty','Sin lotes'],['error','Error y reintento'],['productive-error','Error de contexto productivo'],['loading','Carga lenta'],['readonly','Solo lectura']].map(([value,label]) => ({ value,label }))} /><p role="status">{notice}</p></aside>
    {location.pathname === '/lotes' ? <div className="gs-workspace-surface" style={{ padding: 'clamp(16px, 2vw, 24px)' }}><LotsOverview user={user} source={source} tiles={tiles} onCreate={() => setNotice('Acceso al formulario actual de nuevo lote. Simulado.')} onEdit={lot => setNotice(`Acceso al formulario actual de ${lot.name}. Simulado.`)} onDisable={lot => change(lot, false)} onEnable={lot => change(lot, true)} /></div> : <section><h1>Destino de prueba: {location.pathname}</h1><Link to="/lotes">Volver a Lotes de prueba</Link></section>}
  </main>;
}
Object.entries(cssVariables).forEach(([key,value]) => document.documentElement.style.setProperty(key,value));
if (import.meta.env.DEV) {
  const root = import.meta.hot?.data.root || createRoot(document.getElementById('root'));
  if (import.meta.hot) import.meta.hot.data.root = root;
  root.render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/lotes']}><PreviewShell><Preview /></PreviewShell></MemoryRouter></ConfigProvider>);
}

function PreviewShell({children}) {
  const [collapsed,setCollapsed] = useState(false);
  const mobile = useIsMobile();
  return <div className="gs-shell" style={{'--gs-sidebar-width':`${mobile ? 0 : collapsed ? 80 : 240}px`}}>
    {!mobile && <Sidebar collapsed={collapsed} onCollapse={setCollapsed}/>}
    <div className="gs-shell-main">{children}</div>
  </div>;
}



// Development-only visual fixture. No credentials, business pages or API requests.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ConfigProvider, Card, Button, Space, Tag } from 'antd';
import AppLayout from '../src/layout/Layout';
import BottomNavigation from '../src/components/NavbarBottom';
import { NotificationsProvider } from '../src/context/NotificationsContext';
import useIsMobile from '../src/hooks/useIsMobile';
import { appTheme } from '../src/theme/theme';
import { cssVariables } from '../src/theme/tokens';
import '../src/index.css';
import '../src/App.css';
import '../src/layout/shell.css';
import '@ant-design/v5-patch-for-react-19';
import { MapContainer, Polygon, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
// Shadow storage only in this document, preserving the real browser session.
const previewStorage = new Map([['user', JSON.stringify({nickname:'Ana Pérez',email:'ana@example.test',company_name:'Empresa de prueba',role:2})]]);
Object.defineProperty(window, 'localStorage', { configurable:true, value:{getItem:key=>previewStorage.get(key)??null,setItem:(key,value)=>previewStorage.set(key,String(value)),removeItem:key=>previewStorage.delete(key)} });
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
function Preview(){
  const mobile=useIsMobile(),location=useLocation();
  if(location.pathname==='/login')return <p>Sesión de prueba cerrada.</p>;
  return <NotificationsProvider><AppLayout><div style={{padding:24}}>
    <h1 className="gs-page-title">Base visual</h1><p>Vista aislada del shell. Ruta seleccionada: {location.pathname}</p>
    <Card title="Componentes existentes" style={{marginTop:24}}><Space wrap><Button type="primary">Acción principal</Button><Button>Secundaria</Button><Button disabled>No disponible</Button><Tag color="success">Disponible</Tag></Space></Card>
    <MapContainer center={[-32.4,-63.2]} zoom={12} style={{height:600,marginTop:24}} zoomControl={false} scrollWheelZoom={false}><ZoomControl position="topright"/><Polygon positions={[[-32.39,-63.21],[-32.39,-63.19],[-32.41,-63.19],[-32.39,-63.21]]}/></MapContainer>
    <section style={{minHeight:900,paddingTop:24}}><h2>Contenido desplazable</h2><p>El encabezado del módulo y sus controles se desplazan con el contenido.</p></section>
  </div></AppLayout>{mobile&&<BottomNavigation/>}</NotificationsProvider>;
}
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/dashboard']}><Preview/></MemoryRouter></ConfigProvider>);

import { fieldOverview } from '../src/features/dashboard/fieldOverview.mjs';
import { fixtureLots as fieldLots } from './lotsOverview.fixtures.mjs';
// Development fixture. No session/storage changes, no geolocation or API calls.
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, Link } from 'react-router-dom';
import { ConfigProvider, Select } from 'antd';
import AppLayout from '../src/layout/Layout';
import BottomNavigation from '../src/components/NavbarBottom';
import { NotificationsProvider } from '../src/context/NotificationsContext';
import useIsMobile from '../src/hooks/useIsMobile';
import Dashboard from '../src/features/dashboard/Dashboard';
import { appTheme } from '../src/theme/theme';
import { cssVariables } from '../src/theme/tokens';
import { workRows } from '../src/features/dashboard/dashboardModel.mjs';
import '../src/index.css';
import '../src/layout/shell.css';
import '@ant-design/v5-patch-for-react-19';

const harvestRows = [
  { campaign: '2025/26', crop: 'Soja', production: 960000, area: 200 },
  { campaign: '2025/26', crop: 'Maíz', production: 1200000, area: 150 },
  { campaign: '2024/25', crop: 'Soja', production: 850000, area: 200 },
];
const planning = [
  { id: 'p1', activity_type: 'fumigacion', status_effective: 'en_demora', start_at: '2026-09-12T00:00:00.000Z', end_at: '2026-09-13T00:00:00.000Z', crop_name: 'Soja', responsible_name: 'Ana Pérez', lots: [{ lot_name: 'El Ombú', sub_lot_name: 'Norte' }] },
  { id: 'p2', activity_type: 'siembra', status_effective: 'en_progreso', start_at: '2026-09-13T00:00:00.000Z', end_at: '2026-09-15T00:00:00.000Z', crop_name: 'Maíz', responsible_name: 'Diego López', lots: [{ lot_name: 'La Esperanza' }] },
  { id: 'p3', activity_type: 'mantenimiento', status_effective: 'planificado', start_at: '2026-09-16T00:00:00.000Z', end_at: '2026-09-16T00:00:00.000Z', responsible_name: 'Lucía Gómez', lots: [{ lot_name: 'El Ombú', sub_lot_name: 'Sur' }] },
];
function fixture(mode) {
  let weatherAttempt = 0;
  const result = async (value, name) => {
    await new Promise(resolve => setTimeout(resolve, mode === 'loading' ? 8000 : 180));
    if (mode === 'error' || (mode === 'weather-error' && name === 'weather' && weatherAttempt++ === 0)) throw new Error('Network Error');
    return value;
  };
  return {
    delayed: () => result(mode === 'empty' ? 0 : 3),
    inventory: () => result(['empty', 'single'].includes(mode) ? {} : { low: 2, empty: 1, expired: 1, expiring: 0 }),
    fieldMap: () => result({ ...fieldOverview(mode === 'empty' ? [] : fieldLots), tiles:false }),
    field: () => result({ lots: mode === 'empty' ? 0 : 3 }),
    work: ({ today }) => result(['empty', 'single'].includes(mode) ? [] : workRows(planning, today)),
    weather: () => result({ reading: mode === 'empty' ? null : { temperature: 21.4, humidity: 64, wind_speed: 12.8, wind_direction: '45', weather_code: 2, date: '2026-09-13T12:00:00Z', rainfall: 0 }, fallback: mode === 'fallback' }, 'weather'),
    filters: () => result({ campaigns: ['2025/26', '2024/25', '2023/24'], crops: ['Soja', 'Maíz'] }),
    async production({ filters }) {
      // Longer first-campaign response exercises stale-request protection.
      await new Promise(resolve => setTimeout(resolve, filters.campaign === '2025/26' ? 900 : 100));
      const inputRows = mode === 'long' ? harvestRows.map(row => ({ ...row, campaign: 'TEST TEMP — Cosechas parciales — 20260909-123456789', crop: row.crop === 'Soja' ? 'trigo' : 'Trigo' })) : harvestRows;
      const rows = mode === 'empty' ? [] : inputRows.filter(row => (!filters.campaign || row.campaign === filters.campaign) && (!filters.crop || row.crop === filters.crop));
      const divisor = filters.unit === 'tn' ? 1000 : filters.unit === 'qq' ? 100 : 1;
      const aggregate = list => {
        const production = list.reduce((sum, row) => sum + row.production, 0) / divisor;
        const area = list.reduce((sum, row) => sum + row.area, 0);
        return { production_kg: production, area_ha: area, yield_kg_ha: area ? production / area : null };
      };
      const totals = aggregate(rows);
      const group = key => [...new Set(rows.map(row => row[key]))].map(value => ({ [key]: value, ...aggregate(rows.filter(row => row[key] === value)) }));
      return result({ summary: { total_records: rows.length, total_production_kg: totals.production_kg, total_area_ha: totals.area_ha, avg_yield_kg_ha: totals.yield_kg_ha }, byCrop: group('crop'), byCampaign: group('campaign') });
    },
  };
}
// Page-local storage double: never reads or changes the real browser session.
const previewStorage = new Map([['user', JSON.stringify({name:'Ana', nickname:'Ana', company_name:'Empresa de prueba', role:2})]]);
Object.defineProperty(window, 'localStorage', { configurable:true, value:{ getItem:key => previewStorage.get(key) ?? null, setItem:(key,value) => previewStorage.set(key,String(value)), removeItem:key => previewStorage.delete(key) } });
function Preview() {
  const mobile = useIsMobile();
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).get('scenario') || 'normal');
  const source = useMemo(() => fixture(mode), [mode]);
  const location = useLocation();
  const user = { id: 'fixture', company_id: 'fixture-only', full_name: 'Ana Pérez', role: mode === 'restricted' ? 0 : 2, ...(mode === 'restricted' ? { custom_permissions: ['inventory.view'] } : {}) };
  return <NotificationsProvider><AppLayout><div style={{ padding: '12px 20px' }}>
    <aside style={{ marginBottom: 24 }}><p>Vista de desarrollo · datos ficticios · sin operaciones reales</p><Select aria-label="Escenario de prueba" value={mode} onChange={setMode} style={{ width: '100%', maxWidth: 300 }} options={[['normal','Con datos'],['single','Una alerta y trabajo vacío'],['long','Nombres largos'],['empty','Sin datos'],['error','Error de red'],['weather-error','Error de clima con reintento'],['fallback','Clima guardado'],['loading','Carga lenta'],['restricted','Permisos limitados']].map(([value,label]) => ({ value, label }))} /></aside></div>
    {location.pathname === '/dashboard' ? <div><Dashboard source={source} user={user} today="2026-09-13" /></div> : <section><h1>Destino de prueba: {location.pathname}</h1><Link to="/dashboard">Volver al Inicio de prueba</Link></section>}
  </AppLayout>{mobile && <BottomNavigation />}</NotificationsProvider>;
}
Object.entries(cssVariables).forEach(([key,value]) => document.documentElement.style.setProperty(key,value));
if (import.meta.env.DEV) {
  const root = import.meta.hot?.data.root || createRoot(document.getElementById('root'));
  if (import.meta.hot) import.meta.hot.data.root = root;
  root.render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/dashboard']}><Preview /></MemoryRouter></ConfigProvider>);
}

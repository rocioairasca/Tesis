// Synthetic Planning in the real application shell. No real API or credentials.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider, Tag } from 'antd';
import AppLayout from '../src/layout/Layout';
import BottomNavigation from '../src/components/NavbarBottom';
import { NotificationsProvider } from '../src/context/NotificationsContext';
import useIsMobile from '../src/hooks/useIsMobile';
import { appTheme } from '../src/theme/theme';
import { cssVariables } from '../src/theme/tokens';
import api from '../src/services/apiClient';
import '../src/index.css';
import '../src/App.css';
import '../src/layout/shell.css';

const nonAdmin = new URLSearchParams(location.search).has('nonadmin');
localStorage.clear();
localStorage.setItem('user', JSON.stringify({ id: 'user', role: nonAdmin ? 0 : 3,
  ...(nonAdmin ? { custom_permissions: ['planning.view', 'planning.create', 'planning.edit'] } : {}),
  company_name: 'Empresa de prueba', nickname: 'Usuario de prueba' }));
Object.entries(cssVariables).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));
const today = new Date().toISOString().slice(0, 10);
const rows = ['planificado', 'en_progreso', 'completado'].map((status, index) => ({
  id: `planning-${index}`, status: nonAdmin && index === 0 ? 'completado' : status, title: 'Planificación de prueba', activity_type: 'fumigacion',
  inventory_impact_mode: index === 2 ? 'HISTORICAL_NO_STOCK' : 'NORMAL',
  start_at: today, end_at: today, effective_date: today, responsible_user: 'user',
  crop_id: 'crop', crop_name: 'Cultivo de prueba', campaign_name: 'Campaña de prueba',
  lots: [{ id: 'lot', lot_id: 'lot', name: 'Lote de prueba con nombre extenso', area_ha: 25 }], products: [],
}));
window.__planningPatches = [];
api.defaults.adapter = async config => {
  if (nonAdmin && config.method === 'patch' && config.url.startsWith('/planning/')) {
    window.__planningPatches.push(JSON.parse(config.data));
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
  }
  if (config.method !== 'get') throw new Error('Read-only layout test: unexpected mutation');
  let data = [];
  if (config.url === '/planning') data = { data: rows };
  if (config.url === '/users/planning-responsibles') data = [{ id: 'user', full_name: 'Responsable de prueba' },
    { id: 'colleague', full_name: 'Compañero habilitado' }, { id: 'supervisor', full_name: 'Supervisor habilitado' },
    { id: 'admin', full_name: 'Admin habilitado' }];
  if (config.url === '/crops') data = [{ id: 'crop', name: 'Cultivo de prueba' }];
  if (config.url === '/lots') data = [{ id: 'lot', name: 'Lote de prueba', area_ha: 25 }];
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
// Import after storage initialization: the existing table/card modules read permissions at module load.
const { default: Planning } = await import('../src/features/planning/Planning.jsx');
const { default: PlanningTable } = await import('../src/features/planning/components/PlanningTable.jsx');
function Fixture() {
  const mobile = useIsMobile();
  return <NotificationsProvider><AppLayout>
    {new URLSearchParams(location.search).has('fallback')
      ? <div style={{ width: 550, maxWidth: '100%', minWidth: 0 }}><PlanningTable list={rows} rowKey={r => r.id}
        userIx={{ user: 'Responsable' }} cropIx={{}} statusTag={status => <Tag>{status}</Tag>}
        onEdit={() => { window.__actionReached = true; }} /></div>
      : <Planning />}
  </AppLayout>{mobile && <BottomNavigation />}</NotificationsProvider>;
}
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}>
  <MemoryRouter initialEntries={['/planificaciones']}><Fixture /></MemoryRouter>
</ConfigProvider>);

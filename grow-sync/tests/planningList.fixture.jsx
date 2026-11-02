// Real Planning and shell scroll CSS; only the HTTP transport is synthetic.
import '@ant-design/v5-patch-for-react-19';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { appTheme } from '../src/theme/theme';
import { cssVariables } from '../src/theme/tokens';
import api from '../src/services/apiClient';
import '../src/index.css';
import '../src/App.css';
import '../src/layout/shell.css';

const uid = '22222222-2222-4222-8222-222222222222';
const user = { id: uid, company_id: 'company', full_name: 'Agustina Airasca', role: 0, custom_permissions: ['planning.view', 'planning.edit', 'planning.disable'] };
if (new URLSearchParams(location.search).has('denied')) user.custom_permissions = [];
localStorage.clear();
localStorage.setItem('user', JSON.stringify(user));
Object.entries(cssVariables).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));
const rows = Array.from({ length: 47 }, (_, i) => ({
  id: '11111111-1111-4111-8111-' + String(i + 1).padStart(12, '0'),
  title: 'Trabajo ' + (i + 1), description: 'Trabajo sintético',
  activity_type: 'mantenimiento', field_context: null, crop_name: 'Cultivo ' + (i + 1), crop_id: 'crop',
  campaign_id: 'campaign', status: i === 46 ? 'cancelado' : 'pendiente',
  status_effective: i === 46 ? 'cancelado' : 'pendiente', enabled: i !== 45,
  start_at: '2026-10-21T00:00:00.000Z', end_at: '2026-10-21T00:00:00.000Z',
  responsible_user: uid, responsible_name: user.full_name, assigned_by_name: 'Juan Pérez',
  lots: [{ id: 'lot', lot_id: 'lot', name: 'Lote T4', area_ha: 10 }], products: [],
}));
window.__requests = [];
window.__mutations = [];
window.__delay = 0;
api.defaults.adapter = async config => {
  const params = config.params || {}, response = data => ({ data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config });
  if (config.method !== 'get') {
    const row = rows.find(row => config.url === '/planning/' + row.id);
    if (!row || !['patch', 'delete'].includes(config.method)) throw Error('Unexpected write');
    const body = JSON.parse(config.data || '{}');
    window.__mutations.push({ method: config.method, path: config.url, body });
    if (config.method === 'delete') Object.assign(row, { enabled: false, status: 'cancelado', status_effective: 'cancelado' });
    else { Object.assign(row, body); row.status_effective = row.status; }
    return response({ ok: true });
  }
  const request = { path: config.url, params };
  window.__requests.push(request);
  if (config.url === '/planning') {
    let selected = rows.filter(row => row.enabled && row.status !== 'cancelado');
    if (params.mine) selected = selected.filter(row => row.responsible_user === uid && ['pendiente', 'planificado', 'en_progreso'].includes(row.status));
    if (params.status) selected = selected.filter(row => row.status_effective === params.status);
    if (params.search) selected = selected.filter(row => (row.title + ' ' + row.description).includes(params.search));
    if (params.responsible) selected = selected.filter(row => row.responsible_user === params.responsible);
    if (params.type) selected = selected.filter(row => row.activity_type === params.type);
    const page = Number(params.page || 1), pageSize = Number(params.pageSize || 20);
    const result = response({ data: selected.slice((page - 1) * pageSize, page * pageSize), total: selected.length, page, pageSize });
    if (window.__delay) await new Promise(resolve => setTimeout(resolve, window.__delay));
    if (window.__fail) throw Error('Synthetic list failure');
    // Test-only evidence: correlate rendered rows with the exact completed response.
    request.response = structuredClone(result.data);
    return result;
  }
  if (config.url.startsWith('/planning/')) return response(rows.find(row => config.url === '/planning/' + row.id));
  if (config.url === '/users/planning-responsibles') return response([user]);
  if (config.url === '/crops') return response([{ id: 'crop', name: 'Maíz' }]);
  if (config.url === '/lots') return response([{ id: 'lot', name: 'Lote T4', area_ha: 10 }]);
  if (config.url === '/campaigns') return response([{ id: 'campaign', name: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'active' }]);
  return response([]);
};
const { default: Planning } = await import('../src/features/planning/Planning.jsx');
function Fixture() {
  const navigate = useNavigate(), [, render] = useState(0);
  window.__navigate = path => navigate(path);
  window.__setUser = changes => {
    localStorage.setItem('user', JSON.stringify({ ...JSON.parse(localStorage.getItem('user')), ...changes }));
    render(value => value + 1);
  };
  return <div className="gs-shell" style={{ display: 'flex', flexDirection: 'column' }}>
    <main className="gs-shell-scroll"><div className="gs-workspace gs-workspace--wide"><Planning /></div></main>
  </div>;
}
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><BrowserRouter><Fixture /></BrowserRouter></ConfigProvider>);

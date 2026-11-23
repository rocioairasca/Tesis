// Synthetic data and a local Axios adapter only. No live API, production data or credentials.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import Harvest from '../src/features/harvest/Harvest';
import api from '../src/services/apiClient';
import { appTheme } from '../src/theme/theme';
import { cssVariables } from '../src/theme/tokens';
import '../src/index.css';
import '../src/App.css';

const flags = new URLSearchParams(location.search);
const user = { id: 'u1', email: 'synthetic@example.invalid', role: 2, company_id: 'synthetic-company',
  custom_permissions: ['harvest.view', 'harvest.create', 'harvest.edit'] };
localStorage.setItem('user', JSON.stringify(user));
Object.entries(cssVariables).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));

const campaign = { campaign_id: 'cmp-1', campaign: 'Gruesa 2026/27', campaign_name: 'Gruesa 2026/27', campaign_start_date: '2026-10-01', campaign_end_date: '2027-05-31' };
const older = { campaign_id: 'cmp-0', campaign: 'Gruesa 2025/26', campaign_name: 'Gruesa 2025/26', campaign_start_date: '2025-10-01', campaign_end_date: '2026-05-31' };
const lots = [
  { id: 'lot-1', name: 'T4', active_layout: { sub_lots: [{ id: 'sub-1', name: 'Norte' }, { id: 'sub-2', name: 'Sur' }] } },
  { id: 'lot-2', name: 'T5', active_layout: { sub_lots: [] } },
];
// 12 individual records (two table pages of 10) for the first lot; yields differ so averages would be visible.
const records = Array.from({ length: 12 }, (_, index) => ({
  id: `rec-${index + 1}`, company_id: 'synthetic-company', lot_id: 'lot-1', sub_lot_id: index % 2 ? 'sub-2' : 'sub-1', lot_name: 'T4', sub_lot_name: index % 2 ? 'Sur' : 'Norte',
  crop_id: 'crop-1', crop_name: 'Soja', crop: 'soja', ...campaign, campaign: '2026-2027', harvest_date: `2027-04-${String(index + 1).padStart(2, '0')}`,
  production_kg: '1000.00', harvested_area_ha: '10.00', yield_kg_ha: '100.00', enabled: true, created_by: 'u1',
  registered_retroactively: false, registration_timezone: 'America/Argentina/Buenos_Aires',
}));
const results = Array.from({ length: 30 }, (_, index) => {
  const n = String(index + 1).padStart(2, '0');
  const row = { key: `lot-${n}|cmp-1|crop-1`, level: 'lot', lot: { id: `lot-${n}`, name: `Lote ${n}` }, sub_lot: null, campaign: { id: 'cmp-1', name: 'Gruesa 2026/27' },
    crop: { id: 'crop-1', name: 'Soja' }, surface_ha: '68.30', surface_source: 'cycles', production_kg: '610000.00', harvested_area_ha: '68.30', yield_kg_ha: '8931.19',
    records_count: 4, harvest_status: 'in_progress', production_basis: { prorated_records: 0, method: null }, children: [] };
  if (index === 0) {
    row.lot = { id: 'lot-1', name: 'T4' }; row.key = 'lot-1|cmp-1|crop-1';
    row.children = [{ ...row, key: 'lot-1|sub-1|cmp-1|crop-1', level: 'sub_lot', sub_lot: { id: 'sub-1', name: 'Norte' }, production_kg: '300000.00', harvested_area_ha: '30.00', yield_kg_ha: '10000.00', records_count: 2, children: [], production_basis: { prorated_records: 1, method: 'area_proportional' } },
      { ...row, key: 'lot-1|sub-2|cmp-1|crop-1', level: 'sub_lot', sub_lot: { id: 'sub-2', name: 'Sur' }, production_kg: null, harvested_area_ha: null, yield_kg_ha: null, records_count: 0, harvest_status: 'not_started', children: [], production_basis: { prorated_records: 0, method: null } }];
    row.production_basis = { prorated_records: 1, method: 'area_proportional' };
  }
  return row;
});
window.__requests = [];
api.defaults.adapter = async config => {
  const params = config.params || {};
  window.__requests.push({ method: config.method, path: config.url, params: structuredClone(params) });
  const ok = data => ({ data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config });
  const url = config.url;
  if (url === '/lots') return ok({ data: lots });
  if (url === '/crops') return ok([{ id: 'crop-1', name: 'Soja' }, { id: 'crop-2', name: 'Maíz' }]);
  if (url === '/lots/productive-states') return ok([]);
  if (url === '/harvest-records/stats/filters') return ok({ campaigns: ['Gruesa 2026/27', 'Gruesa 2025/26'], campaign_details: [campaign, older], crops: ['Soja', 'Maíz'] });
  if (url === '/harvest-records/stats/summary') return ok({ total_records: 12, total_production_kg: 12000, total_area_ha: 120, avg_yield_kg_ha: 100 });
  if (url === '/harvest-records/stats/by-crop') return ok([{ crop: 'Soja', production_kg: 12000, area_ha: 120, yield_kg_ha: 100 }]);
  if (url === '/harvest-records/stats/by-campaign') return ok([{ campaign_id: 'cmp-1', campaign_name: 'Gruesa 2026/27', production_kg: 12000, area_ha: 120, yield_kg_ha: 100 }]);
  if (url === '/harvest-records/results') {
    const page = Number(params.page || 1), size = Number(params.pageSize || 25);
    const rows = flags.has('empty') ? [] : results;
    return ok({ summary: { lots: rows.length, results: rows.length, results_with_harvest: rows.length, harvested_area_ha: '2049.00', production_kg: '18300000.00', records: 120, prorated_records: 1,
      unclassified: { records: flags.has('unclassified') ? 2 : 0, production_kg: '0.00', harvested_area_ha: '0.00', reasons: {}, record_ids: [] } },
      data: rows.slice((page - 1) * size, page * size), pagination: { total: rows.length, page, pageSize: size, totalPages: Math.ceil(rows.length / size) } });
  }
  if (url === '/harvest-records') {
    let rows = records;
    if (params.sub_lot_id) rows = rows.filter(r => r.sub_lot_id === params.sub_lot_id);
    return ok({ data: rows, pagination: { total: rows.length, page: 1, pageSize: 100, totalPages: 1 } });
  }
  throw new Error('Unexpected request: ' + config.method + ' ' + url);
};
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/harvest']}><Harvest /></MemoryRouter></ConfigProvider>);

import { MY_TASKS_LIMIT, myTasksPreview } from '../planning/myTasks.mjs';
import { readLots } from '../lots/lotsOverviewSource';
import { fieldOverview } from './fieldOverview.mjs';
import api from '../../services/apiClient';
import { getCurrentLocation } from '../../utils/geolocation.mjs';
import { getHarvestFilters, getHarvestSummary, getHarvestByCrop, getHarvestByCampaign } from '../../services/harvestService';
import { filteredHarvest, inventoryAlerts, readAllPages, workRows, workWindow, numberValue } from './dashboardModel.mjs';

export function createDashboardSource(client = api, harvest = { getHarvestFilters, getHarvestSummary, getHarvestByCrop, getHarvestByCampaign }, geolocation = () => globalThis.navigator?.geolocation) {
  const get = async (path, params, signal) => (await client.get(path, { params, signal })).data;
  return {
    async fieldMap({ signal }) { return fieldOverview(await readLots(client, false, signal)); },
    async field({ signal }) {
      const result = await get('/stats', undefined, signal);
      const lots = numberValue(result?.kpis?.lots);
      if (lots == null) throw new Error('Estadísticas incompletas');
      return { lots };
    },
    async delayed({ signal }) {
      const result = await get('/planning', { status: 'en_demora', page: 1, pageSize: 1 }, signal);
      const total = numberValue(result?.total);
      if (total == null) throw new Error('Planificaciones incompletas');
      return total;
    },
    async myTasks({ signal, today }) {
      const { to, end } = workWindow(today);
      // No lower date bound: overdue work remains visible regardless of age.
      // Backend sorts before LIMIT and counts the full horizon, without fetching it all.
      const result = await get('/planning', { mine: true, to, page: 1, pageSize: MY_TASKS_LIMIT }, signal);
      if (!Array.isArray(result?.data) || numberValue(result.total) == null) throw new Error('Tareas incompletas');
      return myTasksPreview(result.data, today, end, Number(result.total));
    },
    async work({ signal, today }) {
      const { from, to } = workWindow(today);
      const result = await readAllPages(params => get('/planning', params, signal), { from, to }, signal);
      return workRows(result.data, today);
    },
    async inventory({ signal, today }) {
      const result = await readAllPages(params => get('/products', params, signal), {}, signal);
      if (typeof result.inventory_v1_enabled !== 'boolean') throw new Error('Modelo de inventario no informado');
      return inventoryAlerts(result.data, result.inventory_v1_enabled === true, today);
    },
    async filters() {
      const result = await harvest.getHarvestFilters();
      if (!Array.isArray(result?.campaigns) || !Array.isArray(result?.crops)) throw new Error('Filtros incompletos');
      return result;
    },
    async production({ filters }) {
      const { campaign, crop, unit } = filters;
      const [summary, byCrop, byCampaign] = await Promise.all([
        harvest.getHarvestSummary({ campaign: campaign || undefined, crop: crop || undefined, unit }),
        harvest.getHarvestByCrop({ campaign: campaign || undefined, unit }),
        harvest.getHarvestByCampaign({ crop: crop || undefined, unit }),
      ]);
      if (numberValue(summary?.total_records) == null || !Array.isArray(byCrop) || !Array.isArray(byCampaign)) throw new Error('Cosechas incompletas');
      return filteredHarvest(summary, byCrop, byCampaign, filters);
    },
    async weather({ signal, onProgress }) {
      const checkAbort = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
      checkAbort();
      let location = null;
      let stage = 'location';
      try {
        onProgress?.('location');
        location = await getCurrentLocation({ signal, geolocation: geolocation() });
        checkAbort();
        stage = 'weather'; onProgress?.('weather');
        const { latitude, longitude } = location;
        // Preserve the existing endpoint; tests/previews always inject a mock client.
        const { data } = await client.post('/weather/update', {}, { params: { latitude, longitude }, signal, timeout: 15000 });
        checkAbort();
        if (!data || ['temperature', 'humidity', 'wind_speed', 'wind_direction'].some(key => numberValue(data[key]) == null)) {
          throw new Error('Respuesta meteorológica incompleta');
        }
        return { reading: data, fallback: false, location };
      } catch (error) {
        checkAbort();
        // Existing historical fallback has no saved coordinates or WMO code.
        // Never present this row as current weather for the device location.
        const rateLimited = stage === 'weather' && error.response?.status === 429 && error.response?.data?.error === 'WeatherRateLimited';
        const retryAfter = Number(error.response?.data?.retry_after_seconds);
        let data = null;
        try { data = (await client.get('/weather/latest', { signal, timeout: 10000 })).data; }
        catch { checkAbort(); }
        return { reading: data && Object.keys(data).length ? data : null, fallback: true, location,
          failure: stage === 'location' ? error.code || 'position_unavailable' : rateLimited ? 'rate_limited' : 'provider_error',
          retry_after_seconds: rateLimited && Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
          retryable: stage !== 'location' || !['permission_denied', 'unsupported'].includes(error.code) };
      }
    },
  };
}
export const dashboardSource = createDashboardSource();

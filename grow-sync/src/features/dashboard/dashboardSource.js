import { readLots } from '../lots/lotsOverviewSource';
import { fieldOverview } from './fieldOverview.mjs';
import api from '../../services/apiClient';
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
    async weather({ signal }) {
      const checkAbort = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
      const reading = value => value && Object.keys(value).length ? value : null;
      checkAbort();
      try {
        const location = geolocation();
        if (!location) throw new Error('Ubicación no disponible');
        const position = await new Promise((resolve, reject) => location.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }));
        checkAbort();
        const { latitude, longitude } = position.coords;
        // Existing weather flow: this endpoint stores the reading. Never invoke it
        // from previews/tests; they inject an in-memory source or a mocked client.
        const { data } = await client.post('/weather/update', {}, { params: { latitude, longitude }, signal });
        return { reading: reading(data), fallback: false };
      } catch (error) {
        checkAbort();
        return { reading: reading(await get('/weather/latest', undefined, signal)), fallback: true };
      }
    },
  };
}
export const dashboardSource = createDashboardSource();

import api from '../../services/apiClient';

export async function readLots(client, includeDisabled, signal) {
  const rows = [];
  for (let page = 1; ; page++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { data } = await client.get('/lots', { signal, params: { includeActiveLayout: true, ...(includeDisabled ? { includeDisabled: true } : {}), page, pageSize: 1000 } });
    if (!Array.isArray(data?.data) || data.total == null || !Number.isFinite(Number(data.total))) throw new Error('No se pudo leer el listado de lotes.');
    rows.push(...data.data);
    if (rows.length >= Number(data.total)) return [...new Map(rows.map(row => [row.id, row])).values()];
    if (!data.data.length) throw new Error('No se pudo completar el listado de lotes.');
  }
}
export const lotsOverviewSource = {
  lots: ({ includeDisabled, signal }) => readLots(api, includeDisabled, signal),
  async productive({ signal }) {
    const { data } = await api.get('/lots/productive-states', { signal });
    if (!Array.isArray(data?.data)) throw new Error('No se pudo leer el contexto productivo.');
    return Object.fromEntries(data.data.map(state => [state.lot_id, state]));
  },
};

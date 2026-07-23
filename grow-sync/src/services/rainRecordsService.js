import api from './apiClient';

export const getRainRecords = async (params = {}) => {
  const res = await api.get('/rain-records', { params });
  return res.data;
};

export const getMonthlyRainStats = async () => {
  const res = await api.get('/rain-records/stats/monthly');
  return res.data;
};

export const createRainRecord = async (payload) => {
  const res = await api.post('/rain-records', payload);
  return res.data;
};

export const updateRainRecord = async (id, payload) => {
  const res = await api.put(`/rain-records/${id}`, payload);
  return res.data;
};

export const disableRainRecord = async (id) => {
  const res = await api.patch(`/rain-records/${id}/disable`);
  return res.data;
};

export const enableRainRecord = async (id) => {
  const res = await api.patch(`/rain-records/${id}/enable`);
  return res.data;
};

export const syncTodayRainRecord = async ({ latitude, longitude }) => {
  const res = await api.post('/rain-records/sync-today', { latitude, longitude });
  return res.data;
};

import api from '../services/apiClient';

export const getHarvestFilters = async () => {
    const res = await api.get('/harvest-records/stats/filters');
    return res.data;
};

export const getHarvestSummary = async (params = {}) => {
    const res = await api.get('/harvest-records/stats/summary', { params });
    return res.data;
};

export const getHarvestByCrop = async (params = {}) => {
    const res = await api.get('/harvest-records/stats/by-crop', { params });
    return res.data;
};

export const getHarvestByCampaign = async (params = {}) => {
    const res = await api.get('/harvest-records/stats/by-campaign', { params });
    return res.data;
};

export const getHarvestRecords = async (params = {}) => {
  const res = await api.get('/harvest-records', { params });
  return res.data;
};

export const getHarvestRecordById = async (id) => {
  const res = await api.get(`/harvest-records/${id}`);
  return res.data;
};

export const createHarvestRecord = async (payload) => {
  const res = await api.post('/harvest-records', payload);
  return res.data;
};

export const updateHarvestRecord = async (id, payload) => {
  const res = await api.put(`/harvest-records/${id}`, payload);
  return res.data;
};

export const disableHarvestRecord = async (id) => {
  const res = await api.patch(`/harvest-records/${id}/disable`);
  return res.data;
};

export const enableHarvestRecord = async (id) => {
  const res = await api.patch(`/harvest-records/${id}/enable`);
  return res.data;
};
import api from '../services/apiClient';

export const getHarvestContext = async (params) => (await api.get('/harvest-records/context', { params })).data;
export const finalizeHarvestCycle = async (assignmentId, payload) => (
  await api.post(`/harvest-records/cycles/${assignmentId}/finalize`, payload)
).data;

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

export const getHarvestResults = async (params = {}) => {
  const res = await api.get('/harvest-records/results', { params });
  return res.data;
};

export const getHarvestResultDetail = async (params = {}) => {
  const res = await api.get('/harvest-records/results/detail', { params });
  return res.data;
};

export const getHarvestRecords = async (params = {}) => {
  const res = await api.get('/harvest-records', { params });
  return res.data;
};

export const getDisabledHarvestRecords = async (params = {}) => {
  const res = await api.get('/harvest-records/disabled', { params });
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

// FIN-01C: additional costs and completeness. Writes are idempotent: one Idempotency-Key per user intent (kept while the form is open).
export const newIdempotencyKey = () => (globalThis.crypto?.randomUUID?.() || `gs-${Date.now()}-${Math.random().toString(16).slice(2)}`);
export const createCostEntry = async (payload, key) => (await api.post('/cost-entries', payload, { headers: { 'Idempotency-Key': key } })).data;
export const reviseCostEntry = async (id, payload, key) => (await api.post(`/cost-entries/${id}/revisions`, payload, { headers: { 'Idempotency-Key': key } })).data;
export const getCostEntries = async (params = {}) => (await api.get('/cost-entries', { params })).data;
export const declareCompleteness = async (payload, key) => (await api.post('/harvest-records/results/completeness', payload, { headers: { 'Idempotency-Key': key } })).data;

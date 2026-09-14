import api from './apiClient';

// Keep the same key when retrying a receipt after a timeout.
export const registerStockReceipt = async (productId, payload, idempotencyKey) => (
  await api.post(`/products/${productId}/receipts`, payload, { headers: { 'Idempotency-Key': idempotencyKey } })
).data;
export const getStockBatches = async (productId, params) => (
  await api.get(`/products/${productId}/batches`, { params })
).data;
export const getStockMovements = async (productId, params) => (
  await api.get(`/products/${productId}/movements`, { params })
).data;
export const registerStockAdjustment = async (productId, payload, idempotencyKey) => (
  await api.post(`/products/${productId}/adjustments`, payload, { headers: { 'Idempotency-Key': idempotencyKey } })
).data;

import { quantityInput } from '../../utils/inventoryConversion.js';
import { receiptExpirationPayload } from './inventoryModel.mjs';

export const initialBlockers = {
  CONTROL_DATE_MISSING: 'Primero elegí la fecha desde la que GrowSync empezará a controlar el inventario.',
  OPENING_ALREADY_EXISTS: 'El inventario inicial ya fue registrado.',
  INVENTORY_NOT_EMPTY: 'Ya existen movimientos de inventario y no se puede volver a cargar un inventario inicial.',
};
export const enabledProducts = products => products.filter(p => p.enabled !== false);
export const canOpenInitial = (allowed, status) => allowed && status?.opening?.exists === false;
export const canConfirmInitial = (status, preview) => status?.can_confirm === true && !status.opening?.exists
  && /^[a-f0-9]{64}$/.test(preview?.preview_hash || '');

export function initialManifest(date, rows, products) {
  if (!date) throw new Error(initialBlockers.CONTROL_DATE_MISSING);
  const seen = new Set(), entries = [];
  const productMap = new Map(enabledProducts(products).map(product => [product.id, product]));
  for (const row of rows || []) {
    if (row.quantity == null || row.quantity === '') continue;
    if (/^0+(?:[.,]0+)?$/.test(String(row.quantity).trim())) continue;
    const product = productMap.get(row.product_id);
    if (!product) throw new Error('Seleccioná un producto habilitado.');
    const input = quantityInput(row.quantity, row.unit, product.unit, true);
    if (/^0+(\.0+)?$/.test(input.quantity)) continue;
    const expiry = receiptExpirationPayload(row.expiration_period);
    const key = JSON.stringify([product.id, expiry]);
    if (seen.has(key)) throw new Error('El producto y vencimiento están repetidos. Unificá la cantidad o seleccioná otro vencimiento.');
    seen.add(key);
    entries.push({ product_id: product.id, ...input, ...expiry });
  }
  if (!entries.length) throw new Error('Ingresá al menos una cantidad mayor que cero.');
  if (entries.length > 10000) throw new Error('El inventario inicial admite hasta 10000 registros.');
  return { date, entries };
}

// Keep the original request, never the normalized response entries.
export function confirmationAttempt(manifest, preview, key = crypto.randomUUID()) {
  return { key, body: JSON.parse(JSON.stringify({ ...manifest, confirmed: true, preview_hash: preview.preview_hash })) };
}
export const initialApi = api => ({
  status: async () => (await api.get('/history/stock-initial/status')).data,
  setDate: async date => (await api.put('/history/inventory-control-start', { inventory_control_start_date: date })).data,
  prepare: async manifest => (await api.post('/history/stock-initial/prepare', manifest)).data,
  confirm: async attempt => (await api.post('/history/stock-initial/confirm', attempt.body,
    { headers: { 'Idempotency-Key': attempt.key } })).data,
});

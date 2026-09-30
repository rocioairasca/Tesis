import { normalizeQuantity } from '../../utils/inventoryConversion.js';
import { receiptExpirationPayload } from './inventoryModel.mjs';

// Visual groups only: the form and API continue to contain flat entries.
export function initialProductGroups(rows) {
  const groups = new Map();
  rows.forEach((row, index) => {
    if (!groups.has(row.product_id)) groups.set(row.product_id, []);
    groups.get(row.product_id).push(index);
  });
  return [...groups.entries()].map(([product_id, indices]) => ({ product_id, indices }));
}

export function replaceInitialProductEntries(rows, productId, entries) {
  const first = rows.findIndex(row => row.product_id === productId);
  return rows.flatMap((row, index) => index === first ? entries.map(entry => ({ ...entry, product_id: productId }))
    : row.product_id === productId ? [] : [row]);
}

export function initialProductTotal(rows, product) {
  let total = 0n;
  for (const row of rows) {
    if (row.quantity == null || row.quantity === '') continue;
    const { normalized_quantity } = normalizeQuantity({ quantity: row.quantity, inputUnit: row.unit, productUnit: product?.unit, allowZero: true });
    const [whole, fraction] = normalized_quantity.split('.');
    total += BigInt(whole) * 1000000n + BigInt(fraction);
  }
  return `${total / 1000000n}.${String(total % 1000000n).padStart(6, '0')}`;
}

export function validateInitialProductEntries(rows, product) {
  if (!rows.length) throw new Error('Agregá al menos un vencimiento.');
  const seen = new Set();
  for (const row of rows) {
    normalizeQuantity({ quantity: row.quantity, inputUnit: row.unit, productUnit: product.unit });
    const key = JSON.stringify(receiptExpirationPayload(row.expiration_period));
    if (seen.has(key)) throw new Error('El producto y vencimiento están repetidos. Unificá la cantidad o seleccioná otro vencimiento.');
    seen.add(key);
  }
  return rows;
}

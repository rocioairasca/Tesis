import { formatCalendarDate, calendarDateKey, parseCalendarDate } from '../../utils/calendarDate.js';

export const categories = ['semillas', 'agroquimicos', 'fertilizantes', 'combustible'].map((value, i) => ({ value, label: ['Semillas', 'Agroquímicos', 'Fertilizantes', 'Combustible'][i] }));
export const categoryLabel = value => categories.find(c => c.value === value)?.label || value;
export {quantityLabel} from '../../utils/inventoryUnits.js';
export const receivedLabel = value => formatCalendarDate(value, 'Fecha no registrada');
const monthlyExpiration = value => value?.expiration_year != null && value?.expiration_month != null;
export const expirationLabel = value => monthlyExpiration(value)
  ? `${String(value.expiration_month).padStart(2, '0')}/${value.expiration_year}`
  : formatCalendarDate(value && typeof value === 'object' ? value.expiration_date : value, 'Sin vencimiento');
export function receiptExpirationPayload(value) {
  if (value == null) return { expiration_year: null, expiration_month: null };
  if (!value.isValid?.() || value.year() < 2000 || value.year() > 2100) throw new Error('Seleccioná un vencimiento entre 2000 y 2100.');
  return { expiration_year: value.year(), expiration_month: value.month() + 1 };
}
// Effective dates are used only for comparisons, never for labels or receipt payloads.
export const expirationForComparison = value => {
  if (!value || typeof value !== 'object') return parseCalendarDate(value);
  if (value.effective_expiration_date) return parseCalendarDate(value.effective_expiration_date);
  if (monthlyExpiration(value)) return parseCalendarDate(`${value.expiration_year}-${String(value.expiration_month).padStart(2, '0')}-01`)?.endOf('month');
  return parseCalendarDate(value.expiration_date);
};
export const isExpired = (value, today = new Date()) => expirationForComparison(value)?.isBefore(today, 'day') ?? false;
export const stockQuantity = (p, enabled) => Number((enabled ? p.on_hand_quantity : p.available_quantity) || 0);
export const expiration = (p, enabled) => enabled ? {
  expiration_date: p.next_expiration_date, expiration_year: p.next_expiration_year,
  expiration_month: p.next_expiration_month, effective_expiration_date: p.next_effective_expiration_date,
} : p;
export const lowStock = (p, enabled) => stockQuantity(p, enabled) <= Number(p.minimum_stock ?? 5);
export const soon = value => { const d = expirationForComparison(value); const days = d?.startOf('day').diff(new Date(new Date().setHours(0, 0, 0, 0)), 'day'); return days >= 0 && days <= 15; };
export const productState = (p, enabled) => stockQuantity(p, enabled) <= 0 ? 'Sin stock' : soon(expiration(p, enabled)) ? 'Próximo a vencer' : lowStock(p, enabled) ? 'Stock bajo' : 'Disponible';
export const origins = { legacy: 'Apertura legacy', stock_initial: 'Existencia física inicial', purchase: 'Compra', adjustment: 'Ajuste', return: 'Devolución' };
export const movementTypes = { opening: 'Apertura legacy', stock_initial: 'Existencia física inicial', receipt: 'Ingreso', consumption: 'Consumo', adjustment_in: 'Ajuste positivo', adjustment_out: 'Ajuste negativo', reversal: 'Reversión' };
export const batchState = (b, today = new Date()) => !b.enabled ? 'Deshabilitada' : Number(b.available_quantity) <= 0 ? 'Agotada' : isExpired(b, today) ? 'Vencida' : 'Disponible';
export const identityFields = ['name', 'category', 'unit', 'active_ingredient', 'formulation', 'manufacturer', 'minimum_stock', 'notes'];
export const identityPayload = values => Object.fromEntries(identityFields.filter(k => values[k] !== undefined).map(k => [k, values[k]]));
export const canReceipt = (enabled, canEdit) => enabled === true && canEdit === true;
export const canAdjust = canReceipt;
export const normalizeProductName = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const similarProducts = (products, name) => {
  const normalized=normalizeProductName(name);
  if(!normalized) return [];
  return products.filter(p=> { const n=normalizeProductName(p.name); return n && (n.includes(normalized)||normalized.includes(n)); })
    .sort((a,b)=>Number(normalizeProductName(b.name)===normalized)-Number(normalizeProductName(a.name)===normalized)||Number(b.enabled!==false)-Number(a.enabled!==false)).slice(0,5);
};
export const adjustmentReasons = direction => direction === 'in'
  ? ['Diferencia de inventario','Stock encontrado','Corrección de carga','Otro']
  : ['Diferencia de inventario','Pérdida','Rotura / derrame','Corrección de carga','Otro'];
export function adjustmentPreview(values,current){
  if(!['in','out'].includes(values.direction)) throw new Error('Seleccioná el tipo de ajuste.');
  const q=fixed(values.quantity), balance=fixed(current);
  if(q<=0n) throw new Error('La cantidad debe ser mayor a cero.');
  if(!adjustmentReasons(values.direction).includes(values.reason)) throw new Error('Seleccioná un motivo.');
  if(values.reason==='Otro'&&!values.reason_detail?.trim()) throw new Error('Detallá el motivo del ajuste.');
  if(values.direction==='out'&&q>balance) throw new Error('No hay stock suficiente para realizar este ajuste.');
  return {after:decimal(values.direction==='in'?balance+q:balance-q),reason:values.reason==='Otro'?values.reason_detail.trim():values.reason};
}

// Fixed six-place arithmetic matches the inventory service and avoids floating point totals.
const scale = 1000000n;
const fixed = value => {
  const text = String(value ?? '0');
  if (!/^\d{1,14}(\.\d{1,6})?$/.test(text)) throw new Error('Ingresá un número positivo con hasta seis decimales.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
};
const decimal = n => `${n / scale}.${String(n % scale).padStart(6, '0')}`;
export function receiptPreview(values, current) {
  const q = fixed(values.quantity), price = values.unit_price == null || values.unit_price === '' ? null : fixed(values.unit_price);
  const total = price == null ? null : (q * price + scale / 2n) / scale;
  const ars = total == null ? null : values.currency === 'USD' ? (total * fixed(values.exchange_rate) + scale / 2n) / scale : total;
  return { after: decimal(fixed(current) + q), total_original: total == null ? null : decimal(total), total_ars: ars == null ? null : decimal(ars) };
}
export function validateReceipt(v, enabled) {
  if (!v.product_id) throw new Error('Seleccioná un producto.');
  if (fixed(v.quantity) <= 0n) throw new Error('La cantidad debe ser mayor a cero.');
  if (!enabled) return;
  if (!calendarDateKey(v.received_date)) throw new Error('Ingresá una fecha de ingreso válida.');
  if (parseCalendarDate(v.received_date).isAfter(new Date(), 'day')) throw new Error('La fecha de ingreso no puede ser futura.');
  if (v.expiration_date && !calendarDateKey(v.expiration_date)) throw new Error('El vencimiento no es una fecha válida.');
  if (v.currency === 'USD' && fixed(v.exchange_rate) <= 0n) throw new Error('USD requiere tipo de cambio mayor a cero.');
  receiptPreview(v, 0);
}

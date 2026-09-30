import conversion from '../../../shared/inventoryConversion.cjs';
import { unitLabel, normalizeUnit } from './inventoryUnits.js';

export const { normalizeQuantity, decimalText } = conversion;
export function compatibleUnitOptions(baseUnit, enabled = true) {
  const base = normalizeUnit(baseUnit);
  const units = enabled ? conversion.compatibleUnits(base) : base ? [base] : [];
  // cc is an input alias of mL, not a separate base unit or conversion rule.
  if (enabled && units.includes('mL')) units.splice(units.indexOf('mL') + 1, 0, 'cc');
  return units.map(value => ({ value, label: unitLabel(value) }));
}

export function quantityInput(quantity, unit, baseUnit, allowZero = false) {
  const inputUnit = unit || normalizeUnit(baseUnit);
  const result = normalizeQuantity({ quantity, inputUnit, productUnit: baseUnit, allowZero });
  return { quantity: result.entered_quantity, unit: inputUnit };
}

export function conversionPreview(quantity, unit, baseUnit, prefix = 'Equivale a', allowZero = false) {
  if (quantity == null || quantity === '' || !baseUnit || !unit || unit === normalizeUnit(baseUnit)) return '';
  const result = normalizeQuantity({ quantity, inputUnit: unit, productUnit: baseUnit, allowZero });
  // Format the decimal string without passing large quantities through Number.
  const [whole, fraction] = result.normalized_quantity.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${prefix} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${trimmed ? ',' + trimmed : ''} ${unitLabel(baseUnit)}`;
}

const micros = value => {
  const [whole, fraction = ''] = decimalText(value).split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
};
export function exceedsAvailable(quantity, unit, baseUnit, available, allowZero = false) {
  const result = normalizeQuantity({ quantity, inputUnit: unit, productUnit: baseUnit, allowZero });
  return micros(result.normalized_quantity) > micros(available ?? 0);
}

export function receiptQuantityPayload(values, product) {
  const price = values.unit_price == null || values.unit_price === '' ? null : values.unit_price;
  return {
    ...quantityInput(values.quantity, values.unit, product.unit),
    unit_price: price,
    ...(price != null ? { unit_price_unit: normalizeUnit(product.unit) } : {}),
  };
}
export function usageQuantityPayload(values, product) {
  const input = quantityInput(values.amount_used, values.unit, product.unit);
  return { amount_used: input.quantity, unit: input.unit };
}
export function planningProductPayload(values, product) {
  const input = quantityInput(values.amount, values.unit, product.unit);
  return { product_id: values.product_id, amount: input.quantity, unit: input.unit };
}
export function actualProductPayload(product, values, baseUnit) {
  const input = quantityInput(values?.actual_amount ?? product.amount ?? 0, values?.unit || product.unit || baseUnit, baseUnit, true);
  return { planning_product_id: product.id, actual_amount: input.quantity, unit: input.unit };
}

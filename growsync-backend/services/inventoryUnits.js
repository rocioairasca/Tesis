const catalog = require('../../shared/inventoryUnits.json');
const codes = catalog.units.map(unit => unit.value);
const normalizeUnit = value => typeof value === 'string' ? (catalog.legacyAliases[value.trim()] || value.trim()) : null;
const validUnit = value => codes.includes(normalizeUnit(value));
const sameUnit = (left, right) => validUnit(left) && normalizeUnit(left) === normalizeUnit(right);
const unitSchema = require('zod').z.string().trim().refine(validUnit, 'Seleccioná una unidad base válida.').transform(normalizeUnit);
// cc is an input alias, never a product base unit.
const inputUnitSchema = require('zod').z.string().trim().transform(value => value === 'cc' ? 'mL' : value).pipe(unitSchema);
const UNIT_LOCK_MESSAGE = 'La unidad base no puede modificarse porque el producto ya posee movimientos o registros asociados.';
function assertSameUnit(productUnit, suppliedUnit) {
  if (!validUnit(productUnit) || (suppliedUnit != null && !sameUnit(productUnit, suppliedUnit))) {
    throw Object.assign(new Error('Unidad incompatible: debe coincidir con la unidad base del producto.'), {status:400});
  }
  // Retain the stored spelling for existing products; composite FKs and immutable
  // movements must remain intact. New products use canonical codes.
  return productUnit;
}
module.exports={codes,normalizeUnit,validUnit,sameUnit,unitSchema,inputUnitSchema,assertSameUnit,UNIT_LOCK_MESSAGE};

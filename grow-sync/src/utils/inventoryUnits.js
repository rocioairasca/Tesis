import catalog from '../../../shared/inventoryUnits.json' with { type: 'json' };
import {formatNumber} from './numberFormat.js';
export const unitOptions = catalog.units;
export const normalizeUnit = value => typeof value === 'string' ? catalog.legacyAliases[value.trim()] || value.trim() : value;
export const unitLabel = value => {const code=normalizeUnit(value);return code==='unit'?'unidades':code==='bag'?'bolsas':code||'—';};
export const quantityLabel = (value,unit) => `${formatNumber(value,6)} ${unitLabel(unit)}`;

import { campaignLabel, campaignValue, sortCampaigns } from '../../utils/campaigns.mjs';
import { numberValue, formatNumber } from '../../utils/numberFormat.js';

export const areaLabel = value => `${formatNumber(value)} ha`;
export const lotId = lot => lot?.id ?? lot?._id;
export { parseLocation, displayGeometry } from '../../utils/mapGeometry.mjs';
import { displayGeometry } from '../../utils/mapGeometry.mjs';
const unique = values => [...new Set(values.filter(Boolean))];
export function buildLotRows(lots, states = {}, statesAvailable = true) {
  return lots.map(lot => {
    const id = lotId(lot), state = states[id];
    const units = Array.isArray(state?.units) ? state.units : [];
    const available = lot.enabled !== false && statesAvailable && Boolean(state);
    const make = (entity, sub = false) => {
      const matchingUnits = sub ? units.filter(unit => String(unit.sub_lot_id) === String(entity.id)) : units;
      return {
        key: sub ? `sub:${id}:${entity.id}` : `lot:${id}`, lot, subLot: sub ? entity : null,
        name: entity.name || entity.code || (sub ? 'División sin nombre' : 'Lote sin nombre'),
        area: numberValue(sub ? entity.area_ha : entity.area_ha ?? entity.area),
        geometry: displayGeometry(entity.geom) || displayGeometry(entity.location),
        enabled: lot.enabled !== false, productiveAvailable: available && (!sub || matchingUnits.length > 0),
        units: matchingUnits, crops: unique(matchingUnits.map(unit => unit.current_crop?.crop_name)),
        campaigns: unique(sortCampaigns(matchingUnits.map(unit => unit.current_crop).filter(c=>c?.campaign_id || c?.campaign_name),'desc').map(campaignLabel)),
      };
    };
    const row = make(lot);
    // Only the server's current division is visualized; versions stay in editor.
    row.children = lot.active_layout?.status === 'active' && Array.isArray(lot.active_layout.sub_lots)
      ? lot.active_layout.sub_lots.filter(sub => sub.enabled !== false).map(sub => make(sub, true)) : [];
    return row;
  });
}
export const flattenRows = rows => rows.flatMap(row => [row, ...(row.children || [])]);
// Ant Table interprets `children` as automatic nested rows. The list uses explicit
// expandable division summaries, so keep those outside its reserved field.
export const listRows = rows => rows.map(({ children, ...row }) => ({ ...row, divisions: children || [] }));
export const selectedRow = (rows, key) => flattenRows(rows).find(row => row.key === key) || null;
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function filterLotRows(rows, filters) {
  const query = normalize(filters.search);
  return rows.filter(row => {
    if (filters.state === 'enabled' && !row.enabled) return false;
    if (filters.state === 'disabled' && row.enabled) return false;
    if (query && ![row.name, ...row.children.map(sub => sub.name)].some(name => normalize(name).includes(query))) return false;
    if (filters.divided === 'yes' && !row.children.length) return false;
    if (filters.divided === 'no' && row.children.length) return false;
    // Campaign + crop must match the same productive unit, not different siblings.
    if ((filters.crop || filters.campaign) && (!row.productiveAvailable || !row.units.some(unit => (!filters.crop || unit.current_crop?.crop_name === filters.crop) && (!filters.campaign || campaignValue(unit.current_crop) === filters.campaign)))) return false;
    return true;
  });
}
export function overviewMetrics(rows) {
  return {
    enabled: rows.filter(row => row.enabled).length,
    area: rows.every(row => row.area != null) ? rows.reduce((sum, row) => sum + row.area, 0) : null,
    divided: rows.filter(row => row.children.length).length,
    crops: rows.every(row => row.productiveAvailable) ? unique(rows.flatMap(row => row.crops)).length : null,
  };
}
export function lotActions(row, access) {
  return [
    { key: 'detail', label: 'Ver detalle y divisiones', hidden: !access.view || !row.enabled },
    { key: 'edit', label: 'Editar lote', hidden: !access.edit || Boolean(row.subLot), disabled: !row.enabled },
    { key: 'enable', label: 'Habilitar lote', hidden: !access.enable || row.enabled || Boolean(row.subLot) },
    { key: 'disable', label: 'Deshabilitar lote', danger: true, hidden: !access.disable || !row.enabled || Boolean(row.subLot) },
  ];
}


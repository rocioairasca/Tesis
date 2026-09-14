import { buildLotRows } from '../lots/lotsOverviewModel.mjs';
// Presentation summary: parent areas only, current divisions only, no geometry repair.
export function fieldOverview(lots) {
  const rows = buildLotRows(lots.filter(lot => lot.enabled !== false), {}, false);
  const geometries = rows.map(row => row.geometry).filter(geometry => geometry && ['Polygon', 'MultiPolygon'].includes(geometry.type));
  return { lots: rows.length, geometries, missing: rows.length - geometries.length,
    area: rows.every(row => row.area != null && row.area >= 0) ? rows.reduce((sum, row) => sum + row.area, 0) : null,
    divisions: rows.reduce((sum, row) => sum + row.children.length, 0) };
}

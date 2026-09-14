const polygon = (west, south, east, north) => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const legacy = geometry => JSON.stringify(geometry.coordinates.map(ring => ring.map(([lng, lat]) => ({ lat, lng }))));
export const fixtureLots = [
  { id: 'lot-15', name: 'Lote 15', enabled: true, area: 38.46, area_ha: '38.46', location: legacy(polygon(-63.25, -32.41, -63.242, -32.402)), active_layout: { id: 'current', status: 'active', sub_lots: [
    { id: '15-a', name: '15-A', area_ha: '19.23', geom: polygon(-63.25, -32.41, -63.246, -32.402) },
    { id: '15-b', name: '15-B', area_ha: '19.23', geom: polygon(-63.246, -32.41, -63.242, -32.402) },
  ] } },
  { id: 'north', name: 'Lote Norte', enabled: true, area: 25.5, location: legacy(polygon(-63.239, -32.407, -63.233, -32.401)), active_layout: null },
  { id: 'west', name: 'Lote Oeste', enabled: false, area: 12.5, location: legacy(polygon(-63.263, -32.409, -63.257, -32.403)), active_layout: null },
  { id: 'missing', name: 'Lote sin ubicación', enabled: true, area: 8, location: null, active_layout: null },
];
const crop = (crop_name, campaign_name) => ({ crop_name, campaign_name });
export const fixtureProductive = {
  'lot-15': { lot_id: 'lot-15', mode: 'sub_lots', units: [{ sub_lot_id: '15-a', current_crop: crop('Maíz', '2026/27') }, { sub_lot_id: '15-b', current_crop: crop('Soja', '2025/26') }] },
  north: { lot_id: 'north', mode: 'whole_lot', units: [{ sub_lot_id: null, current_crop: crop('Soja', '2026/27') }] },
  missing: { lot_id: 'missing', mode: 'whole_lot', units: [{ sub_lot_id: null, current_crop: null }] },
};

// Structural validation only. PostGIS is the authority for topology and area.
const MESSAGE = 'Dibujá la superficie del lote en el mapa antes de guardarlo.';
function lotPolygon(value) {
  try {
    const location = typeof value === 'string' ? JSON.parse(value) : value;
    let coordinates;
    if (location?.type === 'Polygon') coordinates = location.coordinates;
    else if (Array.isArray(location) && location.length === 1) {
      coordinates = location.map(ring => ring.map(point => Array.isArray(point)
        ? [point[1], point[0]] : [point.lng, point.lat]));
      for (const ring of coordinates) {
        if (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) ring.push([...ring[0]]);
      }
    } else return null;
    if (!Array.isArray(coordinates) || !coordinates.length) return null;
    for (const ring of coordinates) {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      if (!ring.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n)) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) return null;
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return null;
    }
    return { type: 'Polygon', coordinates };
  } catch { return null; }
}
module.exports = { lotPolygon, MESSAGE };

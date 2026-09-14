// Read-only display adapters. Never round coordinates or repair stored topology.
export function parseLocation(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}
const pair = p => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
  && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
function validRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(pair) || !same(ring[0], ring.at(-1))) return false;
  // Translation avoids catastrophic cancellation for small fields far from (0,0).
  const [x, y] = ring[0];
  const twiceArea = ring.slice(1).reduce((sum, p, i) => {
    const q = ring[i];
    return sum + (q[0] - x) * (p[1] - y) - (p[0] - x) * (q[1] - y);
  }, 0);
  return Math.abs(twiceArea) > 0;
}
const validPolygon = rings => Array.isArray(rings) && rings.length > 0 && rings.every(validRing);
function legacyNumber(value) {
  return (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
}
export function displayGeometry(value) {
  let geometry = parseLocation(value);
  if (geometry?.type === 'Feature') geometry = parseLocation(geometry.geometry);
  if (Array.isArray(geometry)) {
    const rings = geometry[0]?.lat !== undefined ? [geometry] : geometry;
    const coordinates = [];
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 3) return null;
      const points = ring.map(p => [legacyNumber(p?.lng), legacyNumber(p?.lat)]);
      if (!points.every(pair)) return null;
      // Leaflet Polygon closes legacy rings implicitly; GeoJSON needs an explicit
      // closing coordinate on a new array. Source data is never changed.
      if (!same(points[0], points.at(-1))) points.push([...points[0]]);
      coordinates.push(points);
    }
    geometry = { type: 'Polygon', coordinates };
  }
  if (geometry?.type === 'Point' && pair(geometry.coordinates)) return geometry;
  if (geometry?.type === 'Polygon' && validPolygon(geometry.coordinates)) return geometry;
  if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) && geometry.coordinates.length && geometry.coordinates.every(validPolygon)) return geometry;
  return null;
}
export function geometryPolygons(value) {
  const geometry = displayGeometry(value);
  return geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
}
// Bounds use geographic names to keep coordinate order explicit at API boundaries.
export function geometryBounds(values = []) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const value of values) {
    const g = displayGeometry(value);
    if (!g) continue;
    const points = g.type === 'Point' ? [g.coordinates] : geometryPolygons(g).flat(2);
    for (const [lng, lat] of points) {
      west = Math.min(west, lng); east = Math.max(east, lng);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
  }
  return Number.isFinite(west) ? { west, south, east, north } : null;
}
export const leafletBounds = bounds => bounds ? [[bounds.south, bounds.west], [bounds.north, bounds.east]] : null;
export function geometryFeatures(values = []) {
  return { type: 'FeatureCollection', features: values.map(displayGeometry).filter(Boolean).map(geometry => ({ type: 'Feature', properties: {}, geometry })) };
}

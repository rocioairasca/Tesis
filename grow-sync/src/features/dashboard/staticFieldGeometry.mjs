import { geometryPolygons, geometryBounds } from '../../utils/mapGeometry.mjs';
// Display-only local projection. Preserves polygons, holes and relative positions;
// never repairs stored geometry or computes business area values.
export function projectField(geometries = [], width = 640, height = 180) {
  const polygons = geometries.map(geometryPolygons).filter(parts => parts.length);
  if (!polygons.length || !(width > 0 && height > 0)) return { paths:[], count:0 };
  const {west,east,south,north} = geometryBounds(geometries.filter(g => geometryPolygons(g).length));
  const cos = Math.max(1e-6, Math.cos((south+north)/2*Math.PI/180));
  const spanX=(east-west)*cos,spanY=north-south;
  const padding=Math.min(16,width/8,height/8);
  const scale=Math.min((width-padding*2)/spanX,(height-padding*2)/spanY);
  const offsetX=(width-spanX*scale)/2,offsetY=(height-spanY*scale)/2;
  const point = ([lng,lat]) => `${(offsetX+(lng-west)*cos*scale).toFixed(3)},${(offsetY+(north-lat)*scale).toFixed(3)}`;
  return { count:polygons.length, paths:polygons.map(parts => parts.map(rings => rings.map(ring => `M${ring.map(point).join('L')}Z`).join('')).join('')) };
}


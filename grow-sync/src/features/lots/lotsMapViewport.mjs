import { geometryBounds } from '../../utils/mapGeometry.mjs';

// Viewport only: every row stays available for rendering, filtering and selection.
// A parent and its divisions count as one lot, avoiding subdivision bias.
export function initialLotViewport(rows) {
  const lots = rows.map(row => ({bounds:geometryBounds([row.geometry,...(row.children || []).map(child=>child.geometry)])})).filter(lot=>lot.bounds);
  const merge = entries => entries.length ? entries.reduce((b,{bounds:g})=>({west:Math.min(b.west,g.west),south:Math.min(b.south,g.south),east:Math.max(b.east,g.east),north:Math.max(b.north,g.north)}),{west:Infinity,south:Infinity,east:-Infinity,north:-Infinity}) : null;
  const all = {bounds:merge(lots),omittedCount:0};
  if(lots.length<3) return all;
  const latitude = lots.map(l=> (l.bounds.south+l.bounds.north)/2).sort((a,b)=>a-b)[Math.floor(lots.length/2)];
  const cos=Math.max(.01,Math.cos(latitude*Math.PI/180));
  const centers=lots.map(({bounds:b})=>[(b.west+b.east)/2*cos,(b.south+b.north)/2]);
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
  const nearest=centers.map((p,i)=>Math.min(...centers.filter((_,j)=>i!==j).map(q=>distance(p,q))));
  const spans=lots.map(({bounds:b})=>Math.hypot((b.east-b.west)*cos,b.north-b.south));
  const threshold=Math.max(median(nearest)*4,median(spans)*4);
  const visited=new Set(),groups=[];
  for(let i=0;i<lots.length;i++) {
    if(visited.has(i)) continue;
    const group=[],queue=[i];visited.add(i);
    while(queue.length) {const j=queue.pop();group.push(lots[j]);for(let k=0;k<lots.length;k++) if(!visited.has(k)&&distance(centers[j],centers[k])<=threshold){visited.add(k);queue.push(k);}}
    groups.push(group);
  }
  const largest=groups.sort((a,b)=>b.length-a.length)[0];
  // No arbitrary geographic preference when there is no clear majority.
  return largest.length>lots.length/2 ? {bounds:merge(largest),omittedCount:lots.length-largest.length} : all;
}

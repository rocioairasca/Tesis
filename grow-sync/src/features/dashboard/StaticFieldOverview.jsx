import React, { useEffect, useId, useRef, useState } from 'react';
import { EmptyState } from '../../components/ui';
import { projectField } from './staticFieldGeometry.mjs';
export default function StaticFieldOverview({ geometries = [] }) {
  const ref=useRef();
  const [size,setSize]=useState({width:640,height:180});
  const patternId=`field-lines-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;
  const projected=projectField(geometries,size.width,size.height);
  useEffect(() => {
    if (!ref.current) return;
    const observer=new ResizeObserver(([entry]) => {
      const {width,height}=entry.contentRect;
      if (width>0 && height>0) setSize(previous => previous.width === width && previous.height === height ? previous : {width,height});
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [projected.count > 0]);
  if (!projected.count) return <EmptyState title="No hay geometrías de lotes disponibles" />;
  return <div ref={ref} className="gs-static-field-overview">
    <svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={`Vista vectorial del establecimiento: ${projected.count} lotes con geometría válida.`}>
      <defs><pattern id={patternId} width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(28)"><path d="M0 0V18" className="gs-static-field-texture" /></pattern></defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} aria-hidden="true" />
      {projected.paths.map((d,index) => <path key={index} d={d} className="gs-static-field-lot" fillRule="evenodd" vectorEffect="non-scaling-stroke" />)}
    </svg>
  </div>;
}

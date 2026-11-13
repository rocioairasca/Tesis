import React from 'react';
import {Card, Collapse} from 'antd';
import {formatNumber} from '../../../utils/numberFormat';
import ProductiveStateLabel from './ProductiveStateLabel';

export function LotInformation({lot,layout,divisionCount,cropNames,units,productiveDetails}) {
  return <Card size="small" title="Información del lote" className="lot-detail-information">
    <dl className="lot-detail-facts">
      <div><dt>Superficie total</dt><dd>{formatNumber(lot?.area_ha ?? lot?.area)} ha</dd></div>
      <div><dt>Divisiones</dt><dd>{divisionCount?`${divisionCount} sublotes`:'Lote completo'}</dd></div>
      <div><dt>Versión actual</dt><dd>{layout?`V${layout.version} · Activa`:'Sin división activa'}</dd></div>
      <div><dt>Cultivos históricos</dt><dd>{cropNames.join(' · ') || 'Sin registros'}</dd></div>
      <div><dt>Estado productivo</dt><dd>{units.length?units.map((unit,index)=><div key={unit.sub_lot_id||unit.lot_id||index}>
        {units.length>1&&<span className="lot-detail-unit-name">{unit.name}: </span>}<ProductiveStateLabel unit={unit}/>
      </div>):'Estado no determinado'}</dd></div>
    </dl>
    <Collapse ghost size="small" items={[{key:'productive',label:'Detalle del estado productivo',children:productiveDetails}]}/>
  </Card>;
}
export function LotIndicators({lot,divisionCount,cropCount,activityCount}) {
  return <Card size="small" title="Indicadores del lote"><dl className="lot-detail-metrics">
    {[
      ['Superficie',`${formatNumber(lot?.area_ha ?? lot?.area)} ha`],
      ['Divisiones',formatNumber(divisionCount)],
      ['Cultivos registrados',formatNumber(cropCount)],
      ['Actividades',formatNumber(activityCount)],
    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl></Card>;
}

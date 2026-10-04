import React from 'react';
import {Alert,Descriptions} from 'antd';
import {formatCalendarDate} from '../../../utils/calendarDate';
const number=value=>value==null?'Sin dato':new Intl.NumberFormat('es-AR',{maximumFractionDigits:4}).format(Number(value));
export default function HistoricalHarvestPreview({harvests=[],lots=[],sublots=[]}) {
  if(!harvests.length)return null;
  const lotNames=new Map(lots.map(l=>[l.id,l.name]));
  const sublotNames=new Map(sublots.map(l=>[l.id,l.name||l.code]));
  return <>
    <Alert type="info" showIcon message="Esta actividad tiene una cosecha relacionada. La siembra, el ciclo productivo y la cosecha se conservarán tal como están y quedarán identificados como registros históricos. Las existencias del inventario no se modificarán." />
    <h4>Cosechas relacionadas</h4>
    {harvests.map(h=><Descriptions key={h.id} column={1} size="small" style={{marginBottom:16}}>
      <Descriptions.Item label="Lote">{lotNames.get(h.lot_id)||'Lote sin nombre'}{h.sub_lot_id?` · ${sublotNames.get(h.sub_lot_id)||'Sublote sin nombre'}`:''}</Descriptions.Item>
      <Descriptions.Item label="Fecha de cosecha">{formatCalendarDate(h.harvest_date,'Sin fecha válida')}</Descriptions.Item>
      <Descriptions.Item label="Superficie cosechada (ha)">{number(h.harvested_area_ha)}</Descriptions.Item>
      <Descriptions.Item label="Producción (kg)">{number(h.production_kg)}</Descriptions.Item>
    </Descriptions>)}
  </>;
}
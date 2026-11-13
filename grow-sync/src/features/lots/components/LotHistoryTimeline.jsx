import React from 'react';
import {Button, Card, Empty, Select, Tag} from 'antd';
import {Leaf, HarvestOutlined, CalendarOutlined, Package} from '../../../components/AppIcons';
import {formatNumber} from '../../../utils/numberFormat';
import {formatCalendarDate, calendarDateKey} from '../../../utils/calendarDate';
import HarvestTrace from '../../harvest/HarvestTrace';

const labels={siembra:'Siembra',fumigacion:'Fumigación',fertilizacion:'Fertilización',cosecha:'Cosecha',riego:'Riego',mantenimiento:'Mantenimiento',otro:'Actividad',uso_producto:'Uso de producto',ciclo_cultivo:'Ciclo de cultivo',harvest_closure:'Cierre de cosecha'};
const typeOf=event=>event.activity_type || ({harvest:'cosecha',crop_cycle:'ciclo_cultivo',harvest_closure:'harvest_closure'}[event.type]) || 'otro';
const toneOf=event=>({fertilizacion:'green',siembra:'green',cosecha:'ochre',fumigacion:'blue'}[typeOf(event)] || 'neutral');
const date=value=>formatCalendarDate(value,'Fecha no registrada');
const filterKey=(event,field)=>event[field+'_id'] || event[field];
const choices=(history,field)=>Array.from(new Map(history.filter(e=>e[field]).map(e=>[filterKey(e,field),{value:filterKey(e,field),label:e[field]}])).values());
function EventDetails({event}) {
  if(event.type==='harvest')return <>
    <dl className="lot-history-harvest-metrics">
      {event.details?.production_kg!=null&&<div><dt>Producción</dt><dd>{formatNumber(event.details.production_kg)} kg</dd></div>}
      {event.details?.yield_kg_ha!=null&&<div><dt>Rendimiento</dt><dd>{formatNumber(event.details.yield_kg_ha)} kg/ha</dd></div>}
    </dl><div className="lot-history-trace"><HarvestTrace record={event}/></div>
  </>;
  if(event.type==='harvest_closure'){
    const reasons={measurement_difference:'Diferencia de medición',unharvested_area:'Superficie no cosechada',loss:'Pérdida',weather:'Condiciones climáticas',other:'Otro'};
    return <div className="lot-history-trace">
      <div>Motivo: {reasons[event.details?.reason] || event.details?.reason || 'No documentado'}</div>
      <div>Usuario: {event.details?.created_by || 'No documentado'} · Total: {formatNumber(event.details?.total_area_ha)} ha</div>
      <div>Cosechado al finalizar: {formatNumber(event.details?.harvested_area_ha)} ha · Pendiente al finalizar: {formatNumber(event.details?.remaining_area_ha)} ha</div>
      {event.details?.notes&&<div>{event.details.notes}</div>}
    </div>;
  }
  if(event.type==='crop_cycle')return <p className="lot-history-note">{date(event.details?.start_date)} — {event.details?.end_date?date(event.details.end_date):'Actual'}</p>;
  return null;
}
export default function LotHistoryTimeline({history,filters,onFiltersChange,condensed=false,onShowAll,onEditCycle}) {
  const types=Array.from(new Set(history.map(typeOf))).map(value=>({value,label:labels[value] || value}));
  const filtered=history.filter(e=>(!filters.campaign||filterKey(e,'campaign')===filters.campaign)&&(!filters.crop||filterKey(e,'crop')===filters.crop)&&(condensed||!filters.type||typeOf(e)===filters.type))
    .slice().sort((a,b)=>String(calendarDateKey(b.event_date)||'').localeCompare(String(calendarDateKey(a.event_date)||'')));
  const visible=condensed?filtered.slice(0,5):filtered;
  return <Card size="small" title="Historial del lote" className="lot-detail-history">
    <div className="lot-history-filters">
      {[['campaign','Campaña',choices(history,'campaign')],['crop','Cultivo',choices(history,'crop')],...(!condensed?[['type','Tipo de actividad',types]]:[])].map(([key,label,options])=>options.length>0&&
        <Select key={key} aria-label={'Filtrar por '+label.toLowerCase()} allowClear placeholder={label} options={options} value={filters[key]} onChange={value=>onFiltersChange({...filters,[key]:value})}/>)}
    </div>
    {!visible.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={history.length?'No hay actividades para estos filtros':'No hay actividades registradas'}/>:<ol className="lot-history-timeline">
      {visible.map((event,index)=>{
        const type=typeOf(event),Icon=type==='cosecha'?HarvestOutlined:type==='siembra'||type==='fertilizacion'?Leaf:type==='fumigacion'?Package:CalendarOutlined;
        return <li key={event.id || `${event.type}-${event.source_id}-${index}`} className={'lot-history-event lot-history-'+toneOf(event)}>
          <span className="lot-history-icon" aria-hidden="true"><Icon/></span>
          <article>
            <div className="lot-history-event-heading"><h3>{event.title || labels[type] || type}</h3><div className="lot-history-tags">
              {event.campaign&&<Tag>{event.campaign}</Tag>}{event.registered_retroactively&&<Tag>Registrada posteriormente</Tag>}
              {onEditCycle&&event.type==='crop_cycle'&&<Button type="link" size="small" onClick={()=>onEditCycle(event)}>Editar</Button>}
            </div></div>
            <div className="lot-history-metadata"><span>{date(event.event_date)}</span><span>{event.sub_lot_name || 'Lote completo'}</span>
              {event.area_ha!=null&&<span>{formatNumber(event.area_ha)} ha</span>}{event.crop&&<span>Cultivo: {event.crop}</span>}
            </div>
            {event.products?.length>0&&<ul className="lot-history-products">{event.products.map((product,i)=><li key={product.product_id||i}>{product.name || 'Producto'} · {formatNumber(product.amount ?? 0)}{product.unit?` ${product.unit}`:''}</li>)}</ul>}
            <EventDetails event={event}/>
            {event.description&&<p className="lot-history-note">{event.description}</p>}
          </article>
        </li>;
      })}
    </ol>}
    {condensed&&filtered.length>5&&<Button type="link" className="lot-history-all" onClick={onShowAll}>Ver todas las actividades ({filtered.length})</Button>}
  </Card>;
}

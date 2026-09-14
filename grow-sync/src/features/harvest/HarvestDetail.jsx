import React from 'react';
import { Button } from 'antd';
import { FormDrawer, Metric, StatusBadge } from '../../components/ui';
import { AppIcons } from '../../components/AppIcons';
import { formatCalendarDate } from '../../utils/calendarDate';
import { formatNumber } from '../../utils/numberFormat';
import { formatHectares } from '../../utils/harvestUtils';
import { projectField } from '../dashboard/staticFieldGeometry.mjs';
import { authorLabel, cropLabel, campaignLabel, surfaceLabel, harvestGeometry } from './harvestPresentation.mjs';
import HarvestTrace from './HarvestTrace';

export default function HarvestDetail({ record, lots, users, onClose, onEdit }) {
  const projection = record ? projectField([harvestGeometry(record,lots)], 600, 220) : null;
  return <FormDrawer open={!!record} onClose={onClose} title="Detalle de cosecha" wide footer={record?.enabled && onEdit && <Button onClick={()=>onEdit(record)}>Editar cosecha</Button>}>
    {record && <div className="gs-harvest-detail"><div><h2><AppIcons.crop/> Cosecha · {cropLabel(record)}</h2><p>{formatCalendarDate(record.harvest_date)}</p>{!record.enabled && <StatusBadge>Deshabilitada</StatusBadge>}</div>
      <section><h3>Resultado</h3><div className="gs-harvest-metrics"><Metric compact label="Superficie" value={formatHectares(record.harvested_area_ha)}/><Metric compact label="Producción" value={`${formatNumber(record.production_kg)} kg`}/><Metric compact label="Rendimiento" value={`${formatNumber(record.yield_kg_ha)} kg/ha`}/></div></section>
      <section><h3>Ubicación</h3><strong>{surfaceLabel(record)}</strong>{record.sub_lot_name && <p className="gs-ui-helper">Lote: {record.lot_name || 'No informado'}</p>}{projection.paths.length ? <figure className="gs-harvest-map"><svg viewBox="0 0 600 220" role="img" aria-label={`Geometría de ${surfaceLabel(record)}`}>{projection.paths.map((path,index)=><path key={index} d={path} fillRule="evenodd"/>)}</svg><figcaption>Vista de la superficie · geometría disponible</figcaption></figure> : <p className="gs-ui-helper">No hay geometría disponible para esta superficie.</p>}</section>
      <section><h3>Contexto productivo</h3><dl><div><dt>Cultivo</dt><dd>{cropLabel(record)}</dd></div><div><dt>Campaña</dt><dd>{campaignLabel(record)}</dd></div></dl></section>
      <section><h3>Registro</h3><dl><div><dt>Registrado por</dt><dd>{authorLabel(record,users)}</dd></div></dl><HarvestTrace record={record} showAuthor={false}/>{record.notes && <><h4>Observaciones</h4><p className="gs-harvest-notes">{record.notes}</p></>}</section>
    </div>}
  </FormDrawer>;
}

import {conflictMessage} from '../productiveStatePresentation.mjs';
import React from 'react';
import { Button } from 'antd';
import { StatusBadge, CategoryTag, EntityLink, EmptyState, RowActions } from '../../../components/ui';
import { areaLabel } from '../lotsOverviewModel.mjs';

export const cropText = row => !row.productiveAvailable ? 'No disponible' : (row.stateLabels || row.crops).join(', ') || 'Estado no determinado';
export const campaignText = row => !row.productiveAvailable ? 'No disponible' : row.campaigns.join(', ') || 'Sin campaña';
export default function LotOverviewContext({ row, actions, onClose }) {
  if (!row) return <div className="gs-lots-context-empty"><EmptyState title="Seleccioná un lote" description="Elegí un lote en el mapa o en la lista para consultar su información." /></div>;
  const availableActions = actions(row);
  const detail = availableActions.find(action => action.key === 'detail' && !action.hidden);
  return <div className={`gs-lots-context-content${!row.enabled ? ' gs-lots-muted' : ''}`}>
    <div className="gs-lots-context-heading"><CategoryTag>{row.subLot ? 'División' : 'Lote'}</CategoryTag><div><RowActions label={`Acciones de ${row.name}`} actions={availableActions.filter(action => action.key !== 'detail')} />{onClose && <Button aria-label="Cerrar selección" onClick={onClose}>Cerrar</Button>}</div></div>
    <h2>{row.name}</h2>{row.subLot && <p className="gs-lots-secondary">{row.lot.name}</p>}
    {row.productiveConflict && <p className="gs-lots-secondary">{conflictMessage}</p>}{row.observations?.map(text=><p key={text} className="gs-lots-secondary">{text}</p>)}<strong className="gs-lots-area">{areaLabel(row.area)}</strong>
    <p><StatusBadge tone="neutral">{row.enabled ? 'Activo' : 'Deshabilitado'}</StatusBadge></p>
    <dl className="gs-lots-context-facts"><div><dt>Cultivo</dt><dd>{cropText(row)}</dd></div><div><dt>Campaña</dt><dd>{campaignText(row)}</dd></div>{!row.subLot && <div><dt>Divisiones vigentes</dt><dd>{row.children.length}</dd></div>}</dl>
    {!row.geometry && <p className="gs-lots-secondary">No hay una ubicación representable en el mapa.</p>}
    {!row.enabled && <p className="gs-lots-secondary">El contexto productivo no está disponible para lotes deshabilitados.</p>}
    {detail && <EntityLink onClick={detail.onClick}>Ver detalle →</EntityLink>}
  </div>;
}

import { authorLabel } from './harvestPresentation.mjs';

export const retroactiveReasons = [
  { value: 'pending_record', label: 'Registro pendiente' },
  { value: 'historical_regularization', label: 'Regularización de datos históricos' },
  { value: 'information_correction', label: 'Corrección de información' },
  { value: 'other', label: 'Otro' },
];
export default function HarvestTrace({ record, showAuthor = true }) {
  const historical = record.registered_retroactively;
  return <div>
    <p className="gs-ui-helper">{historical === true ? 'Registro histórico' : historical === false ? 'Registro actual' : 'Procedencia no documentada'}</p>
      {historical === true && <>
        <div>Motivo: {retroactiveReasons.find(r => r.value === record.retroactive_reason)?.label || 'No informado'}</div>
        {record.retroactive_notes && <div>Observación: {record.retroactive_notes}</div>}
      </>}
      {showAuthor && <div>Registrado por: {authorLabel(record, [JSON.parse(localStorage.getItem('user') || 'null')])}</div>}
      <div>Registrado en GrowSync: {record.created_at ? new Date(record.created_at).toLocaleString('es-AR') : 'No documentado'}</div>
  </div>;
}

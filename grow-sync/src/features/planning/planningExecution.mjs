const sameId = (a,b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
export function canExecutePlanning(row, { canEdit, canExecute, userId, companyId }) {
  if (!row || row.enabled === false || row.status === 'cancelado' || row.inventory_impact_mode === 'HISTORICAL_NO_STOCK') return false;
  // Older list payloads omit company_id; server still verifies tenancy on every action.
  if (row.company_id && !sameId(row.company_id, companyId)) return false;
  return Boolean(canEdit || (canExecute && sameId(row.responsible_user,userId)));
}
export function completionEndpoint(activity) {
  if (activity === 'siembra') return 'complete-sowing';
  if (['fumigacion','fertilizacion'].includes(activity)) return 'complete-work';
  if (['riego','mantenimiento','otro','cosecha'].includes(activity)) return 'complete-activity';
  return null;
}
export function primaryExecutionAction(row, capabilities) {
  if (!canExecutePlanning(row, capabilities)) return null;
  const noun = capabilities.canEdit ? 'trabajo' : 'tarea';
  if (['pendiente','planificado'].includes(row.status)) return {key:'progress',label:'Iniciar '+noun,ctaLabel:'Iniciar',status:'en_progreso'};
  if (row.status === 'en_progreso' && completionEndpoint(row.activity_type)) return {key:'done',label:'Completar '+noun,ctaLabel:'Completar',status:'completado'};
  return null;
}
export const executionDeniedMessage = 'No tenés permiso para ejecutar esta tarea. Puede haber sido reasignada.';

import { getPlanningDatePart } from './planningDisplay.js';
export const MY_TASKS_LIMIT = 6;
export const MY_TASKS_URL = '/planificaciones?mine=1';
export const myTaskUrl = id => MY_TASKS_URL + '&planningId=' + encodeURIComponent(id);
export const TASK_GROUP_LABELS = { delayed: 'En demora', today: 'Hoy', upcoming: 'Próximas' };
// The server owns status_effective. Calendar strings must not shift with browser UTC offsets.
export function classifyMyTasks(rows, today, horizon) {
  const groups = { delayed: [], today: [], upcoming: [] }, seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id) || row.enabled === false || ['completado', 'cancelado'].includes(row.status) || ['completado', 'cancelado'].includes(row.status_effective)) continue;
    const state = row.status_effective || row.status;
    if (!['pendiente', 'planificado', 'en_progreso', 'en_demora'].includes(state)) continue;
    const start = getPlanningDatePart(row.start_at), end = getPlanningDatePart(row.end_at);
    const group = state === 'en_demora' ? 'delayed' : start && start <= today && end >= today ? 'today' : start > today && (!horizon || start <= horizon) ? 'upcoming' : null;
    if (group) { groups[group].push({ ...row, taskGroup: group }); seen.add(row.id); }
  }
  for (const rows of Object.values(groups)) rows.sort((a,b) => String(a.start_at).localeCompare(String(b.start_at)) || String(a.id).localeCompare(String(b.id)));
  return groups;
}
export function myTasksPreview(rows, today, horizon, total = rows.length) {
  const groups = classifyMyTasks(rows, today, horizon);
  return { rows: Object.values(groups).flat().slice(0, MY_TASKS_LIMIT), total };
}
// Only explicit assignment metadata identifies the assigner. No inferred author fallback.
export const taskAssignerName = row => row.assigned_by_name?.trim() || null;

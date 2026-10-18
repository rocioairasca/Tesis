import { parseCalendarDate } from '../../utils/calendarDate.js';
export const mineEnabled = params => ['1', 'true'].includes(params.get('mine'));
export function readPlanningFilters(params) {
  const mine = mineEnabled(params), from = parseCalendarDate(params.get('from')?.slice(0,10)), to = parseCalendarDate(params.get('to')?.slice(0,10));
  return {
    mine, responsible: mine ? null : params.get('responsible'), status: params.get('status'),
    cropId: params.get('cropId') || params.get('crop'), campaignId: params.get('campaignId') || params.get('campaign'),
    type: params.get('type'), search: params.get('search'),
    lotSelectionKey: params.get('lotSelectionKey') || (params.get('subLotId') ? 'sub:' + (params.get('lotId') || '') + ':' + params.get('subLotId') : (params.get('lotId') || params.get('lot')) ? 'lot:' + (params.get('lotId') || params.get('lot')) : null),
    dateRange: from && to ? [from, to] : null,
  };
}
const aliases = { cropId: ['crop'], campaignId: ['campaign'], lotSelectionKey: ['lot','lotId','subLotId'] };
export function updatePlanningFilters(previous, key, value) {
  const next = new URLSearchParams(previous);
  for (const alias of aliases[key] || []) next.delete(alias);
  if (key === 'dateRange') {
    next.delete('from'); next.delete('to');
    if (value?.[0] && value?.[1]) { next.set('from', value[0].format('YYYY-MM-DD')); next.set('to', value[1].format('YYYY-MM-DD')); }
  } else if (value) next.set(key, key === 'mine' ? '1' : value);
  else next.delete(key);
  if (key === 'mine' && value) next.delete('responsible');
  if (key === 'responsible') next.delete('mine');
  next.delete('page');
  return next;
}
export function clearPlanningFilters(previous) {
  const next = new URLSearchParams(previous);
  for (const key of ['mine','responsible','status','cropId','crop','campaignId','campaign','type','search','lotSelectionKey','lot','lotId','subLotId','from','to','page']) next.delete(key);
  return next;
}

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


// Only functional filters define this identity; drawer and presentation state do not.
export function planningFilterKey(params) {
  const filters = readPlanningFilters(params);
  const normalized = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'dateRange') {
      if (value) {
        normalized.set('from', value[0].format('YYYY-MM-DD'));
        normalized.set('to', value[1].format('YYYY-MM-DD'));
      }
    } else if (value) normalized.set(key, key === 'mine' ? '1' : value);
  }
  return normalized.toString();
}
const positiveInteger = (value, fallback, max = Number.MAX_SAFE_INTEGER) =>
  /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Math.min(Number(value), max) : fallback;
export function readPlanningListState(params) {
  return {
    page: positiveInteger(params.get('page'), 1),
    pageSize: positiveInteger(params.get('pageSize'), 8, 1000),
    view: params.get('view') === 'calendar' ? 'calendar' : 'table',
  };
}
export function updatePlanningPage(previous, page, pageSize) {
  const next = new URLSearchParams(previous);
  next.set('page', String(page));
  next.set('pageSize', String(pageSize));
  return next;
}
export const lastPlanningPage = (total, pageSize) => Math.max(1, Math.ceil(total / pageSize));

export function planningRequestParams(filters) {
  const params = {};
  for (const key of ['mine', 'search', 'status', 'responsible', 'cropId', 'type', 'campaignId']) {
    if (filters[key]) params[key] = filters[key];
  }
  const [kind, lotId, subLotId] = (filters.lotSelectionKey || '').split(':');
  if (kind === 'sub' && subLotId) params.subLotId = subLotId;
  else if (kind === 'lot' && lotId) params.lotId = lotId;
  if (filters.dateRange) {
    params.from = filters.dateRange[0].format('YYYY-MM-DD[T]00:00:00.000[Z]');
    params.to = filters.dateRange[1].format('YYYY-MM-DD[T]23:59:59.999[Z]');
  }
  return params;
}

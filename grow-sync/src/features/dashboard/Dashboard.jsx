import React, { useEffect, useMemo, useState } from 'react';
import { PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from '../../utils/permissions';
import { dashboardSource } from './dashboardSource';
import { localDayKey } from './dashboardModel.mjs';
import DashboardView from './DashboardView';

const pending = { status: 'loading', data: null, error: null };
// Loader identity includes filters and company context. Ignore stale responses.
export function useDashboardRequest(loader) {
  const [result, setResult] = useState(pending);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!loader) return;
    const controller = new AbortController();
    setResult({ ...pending, loader, attempt });
    Promise.resolve().then(() => loader(controller.signal)).then(
      data => { if (!controller.signal.aborted) setResult({ status: 'success', data, error: null, loader, attempt }); },
      error => { if (!controller.signal.aborted) setResult({ status: 'error', data: null, error, loader, attempt }); },
    );
    return () => controller.abort();
  }, [loader, attempt]);
  return { ...(!loader ? { status: 'hidden' } : result.loader === loader && result.attempt === attempt ? result : pending), retry: () => setAttempt(value => value + 1) };
}
export function dashboardAccess(user) {
  return {
    planning: hasPermission(user, PERMISSIONS.PLANNING_VIEW),
    inventory: hasPermission(user, PERMISSIONS.INVENTORY_VIEW),
    field: hasPermission(user, PERMISSIONS.LOTS_VIEW),
    production: user != null && Number(user.role) >= 1,
    harvest: hasPermission(user, PERMISSIONS.HARVEST_VIEW),
    rain: hasPermission(user, PERMISSIONS.RAIN_RECORDS_VIEW),
  };
}
// Optional dependencies isolate development fixtures from real API operations.
export default function Dashboard({ source = dashboardSource, user: providedUser, today = localDayKey() }) {
  const user = providedUser === undefined ? JSON.parse(localStorage.getItem('user') || 'null') : providedUser;
  const access = dashboardAccess(user);
  const [filters, setFilters] = useState({ campaign: undefined, crop: undefined, unit: 'kg' });
  const scope = `${user?.id || ''}:${user?.company_id || ''}`;
  const loaders = useMemo(() => ({
    delayed: access.planning ? signal => source.delayed({ signal }) : null,
    work: access.planning ? signal => source.work({ signal, today }) : null,
    inventory: access.inventory ? signal => source.inventory({ signal, today }) : null,
    fieldMap: access.field && source.fieldMap ? signal => source.fieldMap({ signal }) : null,
    field: access.field ? signal => source.field({ signal }) : null,
    options: access.production ? signal => source.filters({ signal }) : null,
    weather: signal => source.weather({ signal }),
  }), [source, scope, today, access.planning, access.inventory, access.field, access.production]);
  const productionLoader = useMemo(() => access.production ? signal => source.production({ signal, filters }) : null, [source, scope, access.production, filters]);
  const delayed = useDashboardRequest(loaders.delayed);
  const work = useDashboardRequest(loaders.work);
  const inventory = useDashboardRequest(loaders.inventory);
  const field = useDashboardRequest(loaders.field);
  const fieldMap = useDashboardRequest(loaders.fieldMap);
  const options = useDashboardRequest(loaders.options);
  const weather = useDashboardRequest(loaders.weather);
  const production = useDashboardRequest(productionLoader);
  return <DashboardView user={user} today={today} access={access} delayed={delayed} work={work} inventory={inventory} field={field} fieldMap={fieldMap} options={options} weather={weather} production={production} filters={filters} onFiltersChange={setFilters} />;
}

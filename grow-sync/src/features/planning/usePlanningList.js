import { useCallback, useEffect, useRef, useState } from 'react';
import { notification } from 'antd';
import api from '../../services/apiClient';
import { readAllPages } from '../dashboard/dashboardModel.mjs';
import { lastPlanningPage, planningRequestParams } from './planningFilters.mjs';

// The screen owns URL state. This hook owns only server results and request lifecycle.
export default function usePlanningList({ filters, page, pageSize, viewMode, scope, canView, changePage }) {
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null);
  const request = useRef(0);
  const controller = useRef(null);
  // Router setters may change identity on detail navigation; they are not query inputs.
  const changePageRef = useRef(changePage);
  changePageRef.current = changePage;
  const query = JSON.stringify([planningRequestParams(filters), viewMode, viewMode === 'table' ? [page, pageSize] : null]);

  const refresh = useCallback(async () => {
    const version = ++request.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    if (!canView) { setResult(null); setPending(null); return; }
    setPending({ scope, query, loading: true });
    try {
      const [params, view, pagination] = JSON.parse(query);
      const read = async pageParams => (await api.get('/planning', { params: pageParams, signal: abort.signal })).data;
      const data = view === 'calendar'
        ? await readAllPages(read, params, abort.signal)
        : await read({ ...params, page: pagination[0], pageSize: pagination[1] });
      if (version !== request.current || abort.signal.aborted) return;
      if (!Array.isArray(data?.data) || data.total == null || !Number.isInteger(Number(data.total)) || Number(data.total) < 0) {
        throw new Error('Respuesta de listado incompleta');
      }
      const total = Number(data.total);
      if (view === 'table' && pagination[0] > lastPlanningPage(total, pagination[1])) {
        // Keep the old rows until the valid page arrives, including after a mutation.
        changePageRef.current(lastPlanningPage(total, pagination[1]), pagination[1], true);
        return;
      }
      setResult({ scope, query, list: data.data, total });
    } catch (error) {
      if (version !== request.current || abort.signal.aborted) return;
      // A failed new query must not label old rows as matching the new filters.
      setResult(previous => ![401, 403].includes(error.response?.status) && previous?.scope === scope && previous?.query === query ? previous : null);
      notification.error({ message: 'Error al cargar planificaciones' });
    } finally {
      if (version === request.current) setPending({ scope, query, loading: false });
    }
  }, [scope, query, canView]);

  useEffect(() => {
    refresh();
    return () => { request.current++; controller.current?.abort(); };
  }, [refresh]);

  // Mask the previous security scope synchronously, before effects/network responses.
  const visible = canView && result?.scope === scope ? result : null;
  return {
    list: visible?.list || [],
    total: visible?.total || 0,
    loading: canView && (pending?.scope !== scope || pending?.query !== query || pending.loading),
    refresh,
  };
}

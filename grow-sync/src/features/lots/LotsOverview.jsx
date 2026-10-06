import {unitCampaign,conflictMessage} from './productiveStatePresentation.mjs';
import { campaignOptions, campaignValue } from '../../utils/campaigns.mjs';
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PageHeader, FilterBar, ViewSwitcher, StatusBadge, EntityLink, DataTable, LoadingState, ErrorState, EmptyState, ConfirmDialog } from '../../components/ui';
import useIsMobile from '../../hooks/useIsMobile';
import { PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from '../../utils/permissions';
import { formatNumber } from '../../utils/numberFormat';
import { areaLabel, buildLotRows, filterLotRows, flattenRows, listRows, selectedRow, overviewMetrics, lotActions, lotId } from './lotsOverviewModel.mjs';
import { lotsOverviewSource } from './lotsOverviewSource';
import LotsOverviewTree from './components/LotsOverviewTree';
import LotOverviewContext, { cropText, campaignText } from './components/LotOverviewContext';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import './lotsOverview.css';

const LotsOverviewMap = lazy(() => import('./components/LotsOverviewMap'));
const initialFilters = { search: '', state: 'enabled', crop: undefined, campaign: undefined, divided: undefined };
export const lotsAccess = user => Object.fromEntries(['view', 'create', 'edit', 'disable', 'enable', 'view_disabled'].map(key => [key === 'view_disabled' ? 'viewDisabled' : key, hasPermission(user, PERMISSIONS[`LOTS_${key.toUpperCase()}`])]));

function useOverviewRead(load, refresh) {
  const [state, setState] = useState({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', load, refresh, retry });
    Promise.resolve().then(() => load(controller.signal)).then(data => { if (!controller.signal.aborted) setState({ status: 'success', data, load, refresh, retry }); }, error => { if (!controller.signal.aborted) setState({ status: 'error', error, load, refresh, retry }); });
    return () => controller.abort();
  }, [load, refresh, retry]);
  return { ...(state.load === load && state.refresh === refresh && state.retry === retry ? state : { status: 'loading' }), retry: () => setRetry(value => value + 1) };
}

export default function LotsOverview({ user, source = lotsOverviewSource, initialState = 'enabled', refresh = 0, onLotsLoaded, onCreate, onEdit, onDisable, onEnable, tiles = true, MapView = LotsOverviewMap }) {
  const navigate = useNavigate(), mobile = useIsMobile();
  const access = lotsAccess(user);
  const [filters, setFilters] = useState({ ...initialFilters, state: access.viewDisabled ? (access.view ? initialState : 'disabled') : 'enabled' });
  const [view, setView] = useState('map');
  const [selectionKey, setSelectionKey] = useState(null);
  const [selectionRequest, setSelectionRequest] = useState(0);
  const [expanded, setExpanded] = useState([]);
  const [confirmation, setConfirmation] = useState(null);
  const [page, setPage] = useState(1);
  const scope = `${user?.id || ''}:${user?.company_id || ''}`;
  const loadLots = useMemo(() => signal => source.lots({ includeDisabled: access.viewDisabled, signal }), [source, scope, access.viewDisabled]);
  const loadProductive = useMemo(() => signal => source.productive({ signal }), [source, scope]);
  const lots = useOverviewRead(loadLots, refresh), productive = useOverviewRead(loadProductive, refresh);
  useEffect(() => { if (lots.status === 'success') onLotsLoaded?.(lots.data); }, [lots.data, lots.status, onLotsLoaded]);
  const rows = useMemo(() => buildLotRows((lots.data || []).filter(lot => lot.enabled === false ? access.viewDisabled : access.view), productive.data, productive.status === 'success'), [lots.data, productive.data, productive.status, access.viewDisabled, access.view]);
  const visible = useMemo(() => filterLotRows(rows, { ...filters, state: access.viewDisabled ? filters.state : 'enabled' }), [rows, filters, access.viewDisabled]);
  const selection = selectedRow(visible, selectionKey);
  useEffect(() => { if (!selection) setSelectionKey(null); }, [selectionKey, selection]);
  const choose = useCallback(key => {
    setSelectionKey(key);
    setSelectionRequest(value => value + 1);
    const row = selectedRow(visible, key);
    if (row?.subLot) setExpanded(keys => [...new Set([...keys, `lot:${lotId(row.lot)}`])]);
  }, [visible]);
  const updateFilter = (key, value) => {
    setFilters(current => ({ ...current, [key]: value, ...(key === 'state' && value === 'disabled' ? { crop: undefined, campaign: undefined } : {}) }));
    setPage(1);
  };
  const clearFilters = () => { setFilters({ ...initialFilters, state: access.view ? 'enabled' : 'disabled' }); setPage(1); };
  const metrics = overviewMetrics(visible);
  const crops = [...new Set(rows.filter(row => row.productiveAvailable).flatMap(row => row.crops))].sort();
  const campaigns = [...new Map(rows.filter(row=>row.productiveAvailable).flatMap(row=>row.units.map(unitCampaign)).filter(c=>c?.campaign_id || c?.campaign_name).map(c=>[campaignValue(c),c])).values()];
  const actionFor = row => lotActions(row, access).map(action => ({ ...action, label: action.key === 'edit' && action.disabled ? 'Editar (habilitá el lote primero)' : action.label,
    onClick: () => {
      if (action.hidden || action.disabled) return;
      if (action.key === 'detail') navigate(`/lotes/${lotId(row.lot)}/divisiones`);
      if (action.key === 'edit') onEdit?.(row.lot);
      if (action.key === 'disable' || action.key === 'enable') setConfirmation({ row, action: action.key });
    },
  }));
  const selectOptions = values => values.map(value => ({ value, label: value }));
  const filterControls = <>
    <Select aria-label="Estado de los lotes" value={access.viewDisabled ? filters.state : 'enabled'} onChange={value => updateFilter('state', value)} options={[{ value: 'enabled', label: 'Activos' }, ...(access.viewDisabled ? [{ value: 'disabled', label: 'Deshabilitados' }, { value: 'all', label: 'Todos los estados' }] : [])]} />
    <Select aria-label="Cultivo de los lotes" placeholder="Todos los cultivos" allowClear value={filters.crop} onChange={value => updateFilter('crop', value)} options={selectOptions(crops)} disabled={productive.status !== 'success' || filters.state === 'disabled'} />
    <Select aria-label="Campaña de los lotes" placeholder="Todas las campañas" allowClear value={filters.campaign} onChange={value => updateFilter('campaign', value)} options={campaignOptions(campaigns)} disabled={productive.status !== 'success' || filters.state === 'disabled'} />

  </>;
  const divisionFilter = <Select aria-label="Divisiones de los lotes" placeholder="Con y sin divisiones" allowClear value={filters.divided} onChange={value => updateFilter('divided', value)} options={[{ value: 'yes', label: 'Con divisiones' }, { value: 'no', label: 'Sin divisiones' }]} />;
  const activeFilters = [
    filters.search && { key: 'search', label: `Búsqueda: ${filters.search}`, onRemove: () => updateFilter('search', '') },
    access.viewDisabled && filters.state !== 'enabled' && { key: 'state', label: filters.state === 'disabled' ? 'Deshabilitados' : 'Todos los estados', onRemove: () => updateFilter('state', 'enabled') },
    filters.crop && { key: 'crop', label: filters.crop, onRemove: () => updateFilter('crop', undefined) },
    filters.campaign && { key: 'campaign', label: filters.campaign, onRemove: () => updateFilter('campaign', undefined) },
    filters.divided && { key: 'divided', label: filters.divided === 'yes' ? 'Con divisiones' : 'Sin divisiones', onRemove: () => updateFilter('divided', undefined) },
  ].filter(Boolean);
  const missing = flattenRows(visible).filter(row => !row.geometry).length;
  const openOnMap = row => { choose(row.key); setView('map'); };
  const columns = [
    { title: 'Lote', key: 'name', dataIndex: 'name', render: (_, row) => <div className={row.enabled ? '' : 'gs-lots-muted'}><EntityLink onClick={() => openOnMap(row)}>{row.name}</EntityLink>{row.divisions.length > 0 && <details className="gs-lots-sub-list"><summary>{row.divisions.length} divisiones</summary>{row.divisions.map(sub => <p key={sub.key}><EntityLink onClick={() => openOnMap(sub)}>{sub.name}</EntityLink><span> · {areaLabel(sub.area)}</span></p>)}</details>}</div> },
    { title: 'Superficie', key: 'area', render: (_, row) => areaLabel(row.area) },
    { title: 'Cultivo', key: 'crop', render: (_, row) => <span>{cropText(row)}{row.productiveConflict && <small style={{display:'block',whiteSpace:'normal'}}>{conflictMessage}</small>}</span> },
    { title: 'Campaña', key: 'campaign', render: (_, row) => campaignText(row) },
    { title: 'Divisiones', key: 'divisions', render: (_, row) => row.divisions.length },
    { title: 'Estado', key: 'state', render: (_, row) => <StatusBadge tone="neutral">{row.enabled ? 'Activo' : 'Deshabilitado'}</StatusBadge> },
  ];
  const noData = lots.status === 'success' && rows.length === 0;
  const filterUnavailable = productive.status !== 'success' && Boolean(filters.crop || filters.campaign);
  return <div className="gs-lots-overview">
    <PageHeader title="Lotes" description="Gestioná lotes, divisiones y su contexto productivo." primaryAction={access.create ? { label: 'Nuevo lote', icon: <PlusIcon size={18} />, onClick: onCreate } : undefined} />
    <div className="gs-lots-toolbar"><FilterBar search={{ label: 'Buscar lotes y divisiones', placeholder: 'Buscar lote o división…', value: filters.search, onChange: value => updateFilter('search', value) }} filters={filterControls} moreFilters={divisionFilter} activeFilters={activeFilters} onClear={clearFilters} />
    {access.viewDisabled && filters.state === 'disabled' && <p className="gs-lots-secondary">Cultivo y campaña no están disponibles para lotes deshabilitados.</p>}
    <div className="gs-lots-view-heading"><ViewSwitcher label="Vista de lotes" value={view} onChange={setView} options={[{ value: 'map', label: 'Mapa' }, { value: 'list', label: 'Lista' }]} />{lots.status === 'success' && <span className="gs-lots-secondary">{formatNumber(visible.length, 0)} {visible.length === 1 ? "lote" : "lotes"} en esta vista</span>}</div></div>
    {lots.status === 'loading' ? <LoadingState label="Cargando lotes…" /> : lots.status === 'error' ? <ErrorState error={lots.error} message="No se pudieron cargar los lotes." onRetry={lots.retry} /> : <>
      {productive.status === 'loading' && <LoadingState label="Cargando contexto productivo…" variant="action" />}
      {productive.status === 'error' && <div><p className="gs-lots-secondary">No se pudo cargar el contexto productivo. Los lotes y sus divisiones siguen disponibles.</p><ErrorState error={productive.error} onRetry={productive.retry} /></div>}
      {filterUnavailable ? <EmptyState title="No podemos aplicar el filtro productivo" description="Reintentá la consulta o limpiá los filtros para ver los lotes." action={{ label: 'Limpiar filtros', onClick: clearFilters }} /> : noData ? <EmptyState title="Todavía no hay lotes disponibles" description={access.create ? "Creá el primer lote para empezar a organizar tu campo." : "Todavía no hay lotes para consultar."} action={access.create ? { label: 'Nuevo lote', icon: <PlusIcon size={18} />, onClick: onCreate } : undefined} /> : !visible.length ? <EmptyState title="No hay lotes que coincidan con estos filtros" description="Probá otra búsqueda o cambiá el estado seleccionado." action={{ label: 'Limpiar filtros', onClick: clearFilters }} /> : <>
        <div className="gs-lots-summary" aria-label="Resumen de los lotes filtrados"><span><strong>{formatNumber(metrics.enabled, 0)}</strong> lotes activos</span><span><strong>{areaLabel(metrics.area)}</strong> de superficie</span><span><strong>{formatNumber(metrics.divided, 0)}</strong> con divisiones</span><span><strong>{formatNumber(metrics.crops, 0)}</strong> cultivos</span></div>
        {view === 'map' ? <>
          <div className="gs-lots-spatial">
            {!mobile && <LotsOverviewTree rows={visible} selection={selection} onSelect={choose} expanded={expanded} onExpand={setExpanded} />}
            <div className="gs-lots-map-surface"><Suspense fallback={<LoadingState label="Cargando mapa…" />}><MapView rows={visible} selectionRequest={selectionRequest} selection={selection} onSelect={choose} tiles={tiles} /></Suspense>{missing > 0 && <p className="gs-lots-secondary">{formatNumber(missing, 0)} {missing === 1 ? "ubicación no se puede representar" : "ubicaciones no se pueden representar"}. Consultá esos registros en la vista Lista.</p>}</div>
            {!mobile && <aside className="gs-lots-context" aria-label="Información del seleccionado"><LotOverviewContext row={selection} actions={actionFor} onClose={selection ? () => setSelectionKey(null) : undefined} /></aside>}
          </div>
          {mobile && <Drawer title="Lote seleccionado" closable={false} extra={<Button aria-label="Cerrar información del lote" onClick={() => setSelectionKey(null)}>Cerrar</Button>} placement="bottom" open={Boolean(selection)} onClose={() => setSelectionKey(null)} height="min(58dvh, 520px)" mask={false} rootClassName="gs-lots-bottom-sheet" destroyOnHidden><LotOverviewContext row={selection} actions={actionFor} /></Drawer>}
        </> : <DataTable title="Lista de lotes" columns={columns.map(column => ({ ...column, ellipsis: false }))} dataSource={listRows(visible)} rowKey="key" rowLabel={row => row.name} actions={actionFor} pagination={{ current: page, pageSize: 10, onChange: setPage }} renderMobile={row => <div className={row.enabled ? '' : 'gs-lots-muted'}><p>{areaLabel(row.area)} · {row.productiveAvailable ? `${cropText(row)} · ${campaignText(row)}` : "Contexto productivo no disponible"}</p>{row.productiveConflict && <p className="gs-lots-secondary">{conflictMessage}</p>}<StatusBadge tone="neutral">{row.enabled ? 'Activo' : 'Deshabilitado'}</StatusBadge><p><EntityLink onClick={() => openOnMap(row)}>Ver en mapa</EntityLink></p>{row.divisions.length > 0 && <details className="gs-lots-sub-list"><summary>{row.divisions.length} divisiones</summary>{row.divisions.map(sub => <p key={sub.key}><EntityLink onClick={() => openOnMap(sub)}>{sub.name}</EntityLink> · {areaLabel(sub.area)} · {cropText(sub)}</p>)}</details>}</div>} />}
      </>}
    </>}
    {confirmation && <ConfirmDialog open title={`${confirmation.action === 'disable' ? 'Deshabilitar' : 'Habilitar'} ${confirmation.row.name}`} description={confirmation.action === 'disable' ? 'El lote dejará de estar disponible para nuevas operaciones.' : 'El lote volverá a estar disponible en la lista de activos.'} consequences="El historial se conserva." destructive={confirmation.action === 'disable'} confirmLabel={confirmation.action === 'disable' ? 'Deshabilitar lote' : 'Habilitar lote'} onCancel={() => setConfirmation(null)} onConfirm={() => confirmation.action === 'disable' ? onDisable(confirmation.row.lot) : onEnable(confirmation.row.lot)} onSuccess={() => { setConfirmation(null); setSelectionKey(null); }} />}
  </div>;
}

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Tag } from 'antd';
import { AppIcons } from '../../components/AppIcons';
import { Metric, DataTable, EntityLink, ConfirmDialog, LoadingState, ErrorState } from '../../components/ui';
import { getHarvestRecords, disableHarvestRecord, enableHarvestRecord } from '../../services/harvestService';
import { dashboardSource } from '../dashboard/dashboardSource';
import { readAllPages } from '../dashboard/dashboardModel.mjs';
import api from '../../services/apiClient';
import { formatCalendarDate } from '../../utils/calendarDate';
import { formatNumber } from '../../utils/numberFormat';
import { formatHectares } from '../../utils/harvestUtils';
import { PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from '../../utils/permissions';
import { cropLabel, campaignLabel, surfaceLabel, filterHarvestRows, readHarvestPages } from './harvestPresentation.mjs';
import { formatYield } from './harvestResults.mjs';
import HarvestCharts from './HarvestCharts';
import HarvestDetail from './HarvestDetail';

// "Registros": the individual harvest records. Filters, page and unit are owned by Harvest.jsx (shared with Resultados).
export default function HarvestTable({ refreshKey = 0, onEdit, lots = [], filters, keyFilter, onClearKeyFilter, onBack,
  page, onPage, unit = 'kg', chartsOpen, onSurfaces }) {
  const [user] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const canStats = Number(user?.role) >= 1;
  const canDisabled = hasPermission(user, PERMISSIONS.HARVEST_VIEW_DISABLED);
  const canEdit = hasPermission(user, PERMISSIONS.HARVEST_EDIT);
  const [records, setRecords] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [analytics, setAnalytics] = useState(null), [statsLoading, setStatsLoading] = useState(false), [statsError, setStatsError] = useState(null);
  const [users, setUsers] = useState([user]);
  const [selected, setSelected] = useState(null), [confirmation, setConfirmation] = useState(null), [revision, setRevision] = useState(0);
  const idParams = useMemo(() => keyFilter ? { campaign_id: keyFilter.campaign_id, crop_id: keyFilter.crop_id, lot_id: keyFilter.lot_id, sub_lot_id: keyFilter.sub_lot_id } : {}, [keyFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    readHarvestPages(getHarvestRecords, {
      campaign: filters.campaign, crop: filters.crop, ...idParams,
      onlyDisabled: canDisabled && filters.state === 'disabled' ? 'true' : 'false',
      includeDisabled: canDisabled && filters.state === 'all' ? 'true' : 'false',
    }, () => cancelled)
      .then(rows => { if (!cancelled) { setRecords(rows); onSurfaces?.(rows.map(row => ({ value: row.sub_lot_id ? `sub:${row.sub_lot_id}` : `lot:${row.lot_id}`, label: surfaceLabel(row) }))); } })
      .catch(reason => { if (!cancelled) setError(reason); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters.campaign, filters.crop, filters.state, idParams, canDisabled, refreshKey, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!canStats) return;
    let cancelled = false; setStatsLoading(true); setStatsError(null); setAnalytics(null);
    dashboardSource.production({ filters: { campaign: filters.campaign, crop: filters.crop, unit: 'kg' } })
      .then(data => { if (!cancelled) setAnalytics(data); }).catch(reason => { if (!cancelled) setStatsError(reason); }).finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [canStats, filters.campaign, filters.crop, refreshKey, revision]);
  useEffect(() => {
    // Existing users endpoint requires administrator role, independently of UI permissions.
    if (!(Number(user?.role) >= 3) || !hasPermission(user, PERMISSIONS.USERS_VIEW)) return;
    let cancelled = false;
    readAllPages(async params => (await api.get('/users', { params })).data, { includeDisabled: true })
      .then(data => { if (!cancelled) setUsers([user, ...data.data]); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  const visible = useMemo(() => filterHarvestRows(records, filters), [records, filters]);
  const actions = row => [
    { key: 'detail', label: 'Ver detalle', onClick: () => setSelected(row) },
    { key: 'edit', label: 'Editar', hidden: !row.enabled || !canEdit, onClick: () => onEdit(row) },
    { key: 'disable', label: 'Deshabilitar', danger: true, hidden: !row.enabled || !hasPermission(user, PERMISSIONS.HARVEST_DISABLE), onClick: () => setConfirmation(row) },
    { key: 'enable', label: 'Habilitar', hidden: row.enabled || !hasPermission(user, PERMISSIONS.HARVEST_ENABLE), onClick: () => setConfirmation(row) },
  ];
  const clipped = value => <span className="gs-harvest-ellipsis" title={value}>{value}</span>;
  const columns = [
    { title: 'Fecha', dataIndex: 'harvest_date', width: 110, render: value => formatCalendarDate(value) },
    { title: 'Lote / subdivisión', key: 'surface', render: (_, row) => <><EntityLink onClick={() => setSelected(row)}>{clipped(surfaceLabel(row))}</EntityLink>{row.sub_lot_name && <small className="gs-harvest-ellipsis" title={row.lot_name}>{row.lot_name}</small>}</> },
    { title: 'Cultivo', key: 'crop', render: (_, row) => <span className="gs-harvest-crop"><AppIcons.crop />{clipped(cropLabel(row))}</span> },
    { title: 'Superficie', dataIndex: 'harvested_area_ha', width: 110, render: formatHectares, align: 'right' },
    { title: 'Producción', dataIndex: 'production_kg', width: 130, render: value => `${formatNumber(value)} kg`, align: 'right' },
    { title: 'Rendimiento', dataIndex: 'yield_kg_ha', width: 140, render: value => formatYield(value, unit), align: 'right' },
    { title: 'Campaña', key: 'campaign', render: (_, row) => clipped(campaignLabel(row)) },
  ];
  const summary = analytics?.summary;
  return <>
    {keyFilter && <div className="gs-harvest-keyfilter" role="status">
      <Tag closable onClose={onClearKeyFilter}>Resultado: {keyFilter.label}</Tag>
      {onBack && <Button type="link" onClick={onBack}>Volver a Resultados por lote</Button>}
    </div>}
    {canStats && (statsLoading ? <LoadingState label="Cargando resumen productivo…" rows={1} /> : statsError ? <ErrorState error={statsError} onRetry={() => setRevision(value => value + 1)} />
      : summary && <div className="gs-harvest-summary" aria-label="Resumen de la selección">
        <Metric compact label="Superficie cosechada" value={formatHectares(summary.total_area_ha)} />
        <Metric compact label="Producción total" value={`${formatNumber(summary.total_production_kg)} kg`} />
        <Metric compact label="Registros de cosecha" value={formatNumber(summary.total_records, 0)} />
      </div>)}
    <div className={`gs-harvest-workspace ${chartsOpen && canStats ? 'gs-harvest-workspace--with-panel' : ''}`}>
      <div className="gs-harvest-table"><DataTable title="Registros de cosecha" columns={columns} dataSource={visible} loading={loading} error={error} onRetry={() => setRevision(value => value + 1)}
        actions={actions} rowLabel={row => `${cropLabel(row)} · ${formatCalendarDate(row.harvest_date)}`} pagination={{ current: page, pageSize: 10, onChange: onPage }}
        renderMobile={row => <div className="gs-harvest-mobile"><EntityLink onClick={() => setSelected(row)}><AppIcons.crop /> {surfaceLabel(row)}</EntityLink>{row.sub_lot_name && <small>{row.lot_name}</small>}
          <span>{formatHectares(row.harvested_area_ha)} · {formatYield(row.yield_kg_ha, unit)}</span><span>{formatNumber(row.production_kg)} kg · {campaignLabel(row)}</span></div>} /></div>
      {chartsOpen && canStats && !statsLoading && !statsError && analytics && <aside aria-label="Analítica de cosechas"><HarvestCharts data={analytics} /></aside>}
    </div>
    <HarvestDetail record={selected} lots={lots} users={users} onClose={() => setSelected(null)} onEdit={canEdit ? row => { setSelected(null); onEdit(row); } : undefined} />
    <ConfirmDialog open={!!confirmation} title={confirmation?.enabled ? 'Deshabilitar cosecha' : 'Habilitar cosecha'} description="¿Querés cambiar el estado de este registro?" consequences="El registro conserva su historial."
      destructive={!!confirmation?.enabled} confirmLabel={confirmation?.enabled ? 'Deshabilitar' : 'Habilitar'} onCancel={() => setConfirmation(null)}
      onConfirm={() => confirmation.enabled ? disableHarvestRecord(confirmation.id) : enableHarvestRecord(confirmation.id)} onSuccess={() => { setConfirmation(null); setSelected(null); setRevision(value => value + 1); }} />
  </>;
}

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Pagination, Table, Tooltip } from 'antd';
import { Metric, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui';
import useIsMobile from '../../hooks/useIsMobile';
import { getHarvestResults } from '../../services/harvestService';
import { formatNumber } from '../../utils/numberFormat';
import { costStatus, formatArea, formatCostPerHa, formatCostPerTn, formatKnownCost, formatProduction, formatUsd, formatYield, harvestStatus, hasCostAccess,
  proratedNote, recordsFilterFor, resultKeyParams, resultParams, sameResult, summaryCostHelp, treeRows, unclassifiedNote } from './harvestResults.mjs';
import HarvestResultDetail from './HarvestResultDetail';

const PAGE_SIZE = 25;
const StatusCell = ({ row }) => {
  const status = harvestStatus(row.harvest_status);
  return status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : <span aria-label="Sin estado de cosecha">—</span>;
};
const CostStatus = ({ row }) => {
  const status = costStatus(row.costs);
  return status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : <span>—</span>;
};
const Prorated = ({ row }) => row.production_basis?.prorated_records > 0
  ? <Tooltip title={proratedNote}><span className="gs-harvest-prorated" tabIndex={0}>Prorrateada</span></Tooltip> : null;
const Provisional = ({ row }) => row.costs?.is_provisional ? <small className="gs-harvest-provisional">prov.</small> : null;

// "Resultados por lote": one row per lot + campaign + crop. The parent row is the authoritative total; sublots expand.
// Cost columns appear only when the server says cost_access: harvest.view alone never receives an amount.
export default function HarvestResults({ filters, page, onPage, expanded, onExpanded, unit, refreshKey = 0, onViewRecords, onSurfaces, selected, onSelect, onRegisterExpense, onChanged }) {
  const mobile = useIsMobile();
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null), [revision, setRevision] = useState(0);
  const params = useMemo(() => resultParams(filters, { page, pageSize: PAGE_SIZE }), [filters, page]);
  const needsCampaign = !params.campaign;

  useEffect(() => {
    if (needsCampaign) { setData(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true); setError(null);
    getHarvestResults(params).then(response => {
      if (cancelled) return;
      setData(response);
      onSurfaces?.(response.data.flatMap(row => [{ value: `lot:${row.lot.id}`, label: row.lot.name }, ...row.children.map(child => ({ value: `sub:${child.sub_lot.id}`, label: `${row.lot.name} · ${child.sub_lot.name}` }))]));
    }).catch(reason => { if (!cancelled) setError(reason); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params, needsCampaign, refreshKey, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  if (needsCampaign) return <EmptyState title="Seleccioná una campaña" description="Los resultados por lote se calculan para una campaña." />;
  if (error) return <ErrorState error={error} onRetry={() => setRevision(value => value + 1)} />;
  if (loading && !data) return <LoadingState label="Cargando resultados por lote…" rows={4} />;
  const summary = data?.summary, rows = data?.data || [];
  const costAccess = hasCostAccess(data);
  const note = unclassifiedNote(summary);
  const title = row => row.sub_lot ? `Subdivisión ${row.sub_lot.name}` : row.lot.name;
  const open = row => onSelect(resultKeyParams(row));
  const recordsButton = row => <Button type="link" size="small" className="gs-harvest-records-link" disabled={!row.records_count}
    aria-label={`Ver los ${row.records_count} registros de cosecha de ${row.lot.name}${row.sub_lot ? ' ' + row.sub_lot.name : ''}`} onClick={() => onViewRecords(recordsFilterFor(row))}>
    {formatNumber(row.records_count, 0)}</Button>;
  const columns = [
    { title: 'Lote', key: 'lot', render: (_, row) => <span className="gs-harvest-lot"><Button type="link" size="small" className="gs-harvest-open" onClick={() => open(row)} aria-label={`Ver detalle de ${row.lot.name}${row.sub_lot ? ' ' + row.sub_lot.name : ''}`}>
      <strong title={row.sub_lot ? row.sub_lot.name : row.lot.name}>{title(row)}</strong></Button><Prorated row={row} />{costAccess && <small className="gs-harvest-lot-surface">{formatArea(row.surface_ha)}</small>}</span> },
    { title: 'Cultivo', key: 'crop', width: 110, render: (_, row) => row.crop.name || '—' },
    { title: 'Superficie', key: 'surface', width: 100, align: 'right', render: (_, row) => formatArea(row.surface_ha) },
    { title: 'Producción', key: 'production', width: 130, align: 'right', render: (_, row) => formatProduction(row.production_kg) },
    ...(costAccess ? [] : [{ title: 'Sup. cosechada', key: 'harvested', width: 130, align: 'right', render: (_, row) => formatArea(row.harvested_area_ha) }]),
    { title: 'Rendimiento', key: 'yield', width: 130, align: 'right', render: (_, row) => formatYield(row.yield_kg_ha, unit) },
    { title: 'Registros', key: 'records', width: 80, align: 'right', render: (_, row) => recordsButton(row) },
    { title: 'Cosecha', key: 'status', width: 110, render: (_, row) => <StatusCell row={row} /> },
    ...(costAccess ? [
      { title: 'Gastos', key: 'cost', width: 150, align: 'right', render: (_, row) => <span className={hasKnownCostClass(row)}>{formatKnownCost(row.costs)}</span> },
      { title: 'Gasto / ha', key: 'cost_ha', width: 120, align: 'right', render: (_, row) => formatCostPerHa(row.costs) },
      { title: 'Costo / tn', key: 'cost_tn', width: 130, align: 'right', render: (_, row) => <>{formatCostPerTn(row.costs)}<Provisional row={row} /></> },
      { title: 'Estado económico', key: 'cost_status', width: 130, render: (_, row) => <CostStatus row={row} /> },
    ] : []),
  ];
  const panel = selected && !mobile && <HarvestResultDetail params={selected} unit={unit} refreshKey={refreshKey} onClose={() => onSelect(null)} onViewRecords={onViewRecords} onRegisterExpense={onRegisterExpense} onChanged={onChanged} />;
  return <>
    {summary && <div className={`gs-harvest-summary ${costAccess ? 'gs-harvest-summary--4' : ''}`} aria-label="Resumen de la selección">
      <Metric compact label="Superficie cosechada" value={formatArea(summary.harvested_area_ha)} />
      <Metric compact label="Producción total" value={`${formatNumber(summary.production_kg)} kg`} />
      <Metric compact label="Lotes con resultados" value={formatNumber(summary.results, 0)} helper={`${formatNumber(summary.records, 0)} registros de cosecha`} />
      {costAccess && <Metric compact label="Gasto conocido" value={formatUsd(summary.known_cost_usd)}
        helper={`${summaryCostHelp} · ${formatNumber(summary.incomplete_lots, 0)} ${summary.incomplete_lots === 1 ? 'lote' : 'lotes'} con costos incompletos`} />}
    </div>}
    {summary?.prorated_records > 0 && <p className="gs-ui-helper">Parte de la producción se repartió entre destinos en proporción a la superficie vinculada (prorrateo, no medición).</p>}
    {note && <p className="gs-harvest-warning" role="status">{note}</p>}
    <div className={`gs-harvest-results-layout ${panel ? 'gs-harvest-results-layout--panel' : ''}`}>
      <div className="gs-harvest-table" aria-busy={loading}>
        {!rows.length ? <EmptyState title="No hay resultados para esta selección" description="Probá otra campaña o cultivo." />
          : !mobile ? <><Table className="gs-harvest-results-table" columns={columns.map(c => ({ ...c, ellipsis: true }))} dataSource={treeRows(rows)} rowKey="key" size="middle" tableLayout="fixed" pagination={false}
            scroll={costAccess ? { x: 1320 } : undefined} rowClassName={row => sameResult(row, selected) ? 'gs-harvest-row--selected' : ''}
            expandable={{ expandedRowKeys: expanded, onExpandedRowsChange: keys => onExpanded([...keys]), indentSize: 16 }} />
            <Pagination className="gs-ui-pagination" current={data.pagination.page} pageSize={PAGE_SIZE} total={data.pagination.total} showSizeChanger={false} onChange={onPage} showTotal={total => `${total} resultados`} /></>
          : <ul className="gs-ui-records gs-harvest-result-cards">{rows.map(row => {
            const isOpen = expanded.includes(row.key);
            const card = (item, child) => <li key={item.key} className={child ? 'gs-harvest-result-child' : undefined}>
              <div className="gs-ui-record-heading"><Button type="link" size="small" className="gs-harvest-open" onClick={() => open(item)} aria-label={`Ver detalle de ${item.lot.name}${item.sub_lot ? ' ' + item.sub_lot.name : ''}`}><strong>{title(item)}</strong></Button><StatusCell row={item} /></div>
              <div className="gs-harvest-mobile"><span>{item.crop.name} · {formatArea(item.surface_ha)}</span>
                <span>Producción: {formatProduction(item.production_kg)}</span><span>Sup. cosechada: {formatArea(item.harvested_area_ha)}</span><span>Rendimiento: {formatYield(item.yield_kg_ha, unit)}</span>
                {costAccess && <span className="gs-harvest-card-costs"><span>Gasto conocido: {formatKnownCost(item.costs)}</span><span>Costo / tn: {formatCostPerTn(item.costs)}{item.costs?.is_provisional ? ' (prov.)' : ''}</span>
                  <span>Estado económico: <CostStatus row={item} /></span></span>}
                <Prorated row={item} />
                <span className="gs-harvest-card-actions">{recordsButton(item)}{!child && item.children.length > 0 && <Button type="link" size="small" aria-expanded={isOpen}
                  onClick={() => onExpanded(isOpen ? expanded.filter(key => key !== item.key) : [...expanded, item.key])}>{isOpen ? 'Ocultar subdivisiones' : `Ver ${item.children.length} subdivisiones`}</Button>}</span></div></li>;
            return <React.Fragment key={row.key}>{card(row, false)}{isOpen && row.children.map(child => card(child, true))}</React.Fragment>;
          })}</ul>}
        {mobile && data?.pagination.total > 0 && <Pagination simple className="gs-ui-pagination" current={data.pagination.page} pageSize={PAGE_SIZE} total={data.pagination.total} showSizeChanger={false} onChange={onPage} />}
      </div>
      {panel}
    </div>
    {selected && mobile && <HarvestResultDetail params={selected} unit={unit} refreshKey={refreshKey} onClose={() => onSelect(null)} onViewRecords={onViewRecords} onRegisterExpense={onRegisterExpense} onChanged={onChanged} />}
  </>;
}
const hasKnownCostClass = row => row.costs?.known_total_usd == null ? 'gs-harvest-cost--pending' : 'gs-harvest-cost';

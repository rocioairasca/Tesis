import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import { LoadingState, ErrorState, StatusBadge } from '../../components/ui';
import useIsMobile from '../../hooks/useIsMobile';
import { getHarvestResultDetail } from '../../services/harvestService';
import { formatCalendarDate } from '../../utils/calendarDate';
import { formatNumber } from '../../utils/numberFormat';
import { costDisclaimer, costStatus, formatArea, formatCostPerHa, formatCostPerTn, formatProduction, formatUsd, formatYield, harvestStatus,
  hasKnownCost, provisionalNote, proratedNote, recordsFilterFor, resultTitle } from './harvestResults.mjs';

const Row = ({ label, children }) => <div className="gs-harvest-detail-row"><dt>{label}</dt><dd>{children}</dd></div>;
const usdOrPending = value => value == null ? 'Pendiente' : formatUsd(value);

// Detail of one "Resultados por lote" row. Desktop: docked, non-modal panel. Mobile: full screen with a back button.
// Economic sections exist only when the server returned them (cost_access); nothing is hidden client-side.
export default function HarvestResultDetail({ params, unit, onClose, onViewRecords, refreshKey = 0 }) {
  const mobile = useIsMobile();
  const [data, setData] = useState(null), [error, setError] = useState(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    getHarvestResultDetail(params).then(response => { if (!cancelled) setData(response); }).catch(reason => { if (!cancelled) setError(reason); });
    return () => { cancelled = true; };
  }, [params, refreshKey, revision]);

  const body = error ? <ErrorState error={error} onRetry={() => setRevision(value => value + 1)} />
    : !data ? <LoadingState label="Cargando detalle…" rows={4} /> : <Content data={data} unit={unit} onViewRecords={onViewRecords} />;
  const title = data ? resultTitle(data) : 'Detalle del resultado';
  const header = <div className="gs-harvest-detail-header">
    {mobile && <Button type="link" onClick={onClose}>Volver a resultados</Button>}
    <div><h2>{title}</h2>{data && <p className="gs-ui-helper">{data.crop.name} · {data.campaign.name}</p>}</div>
    {!mobile && <Button type="text" aria-label="Cerrar detalle" onClick={onClose}>✕</Button>}
  </div>;
  return <aside className={mobile ? 'gs-harvest-result-detail gs-harvest-result-detail--full' : 'gs-harvest-result-detail'} aria-label="Detalle del resultado" role={mobile ? 'dialog' : undefined} aria-modal={mobile ? 'true' : undefined}>
    {header}{body}
  </aside>;
}

function Content({ data, unit, onViewRecords }) {
  const costs = data.costs, status = costStatus(costs), harvest = harvestStatus(data.harvest_status);
  return <div className="gs-harvest-detail-body">
    <section aria-label="Resumen"><dl>
      <Row label="Superficie">{formatArea(data.surface_ha)}</Row>
      {harvest && <Row label="Cosecha"><StatusBadge tone={harvest.tone}>{harvest.label}</StatusBadge></Row>}
      {data.cost_access && status && <Row label="Estado económico"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></Row>}
    </dl></section>

    {data.cost_access && costs && <section aria-label="Gastos conocidos"><h3>Gastos conocidos</h3>
      <dl>
        <Row label="Productos">{usdOrPending(costs.products_usd)}</Row>
        <Row label="Labor">{usdOrPending(costs.labor_usd)}</Row>
        <Row label="Total conocido"><strong>{hasKnownCost(costs) ? formatUsd(costs.known_total_usd) : 'Pendiente'}</strong></Row>
        <Row label="Líneas pendientes">{formatNumber(costs.pending_lines, 0)}</Row>
      </dl>
      <p className="gs-harvest-warning" role="note">{costDisclaimer}</p>
    </section>}

    <section aria-label="Producción"><h3>Producción</h3><dl>
      <Row label="Producción acumulada">{formatProduction(data.production_kg)}</Row>
      <Row label="Superficie cosechada">{formatArea(data.harvested_area_ha)}</Row>
      <Row label="Rendimiento">{formatYield(data.yield_kg_ha, unit)}</Row>
      <Row label="Registros de cosecha">{formatNumber(data.records_count, 0)}</Row>
    </dl>{data.production_basis?.prorated_records > 0 && <p className="gs-ui-helper">{proratedNote}</p>}</section>

    {data.cost_access && costs && <section aria-label="Relación costo / producción"><h3>Relación costo / producción</h3><dl>
      <Row label="Gasto conocido / ha">{formatCostPerHa(costs)}</Row>
      <Row label="Gasto conocido / tn">{formatCostPerTn(costs)}</Row>
    </dl>{costs.is_provisional && <p className="gs-ui-helper">{provisionalNote}</p>}</section>}

    {data.cost_access && data.cost_detail && <section aria-label="Desglose por Planning"><h3>Desglose por Planning</h3>
      {!data.cost_detail.plannings.length ? <p className="gs-ui-helper">No hay ejecuciones de Planning con costo para este resultado.</p>
        : <ul className="gs-harvest-planning-list">{data.cost_detail.plannings.map(item => <li key={`${item.planning_id}-${item.sub_lot?.id || 'lot'}`}>
          <div className="gs-harvest-planning-head"><strong>{item.activity}</strong><span>{formatCalendarDate(item.effective_date)}</span></div>
          {item.planning_enabled === false && <div className="gs-ui-helper">Esta Planning está deshabilitada actualmente; su costo sigue formando parte del resultado.</div>}
          <div className="gs-ui-helper">{item.sub_lot ? `Subdivisión ${item.sub_lot.name} · ` : ''}Conocido: {usdOrPending(item.known_usd)}{item.pending_lines ? ` · ${item.pending_lines} pendiente${item.pending_lines === 1 ? '' : 's'}` : ''}</div>
          <ul>{item.lines.map((line, index) => <li key={index}>{line.name}{line.quantity ? ` · ${formatNumber(line.quantity)} ${line.unit}` : ''}: {line.pending ? 'Pendiente' : formatUsd(line.amount_usd)}</li>)}</ul>
        </li>)}</ul>}
    </section>}

    <Button type="primary" disabled={!data.records_count} onClick={() => onViewRecords(recordsFilterFor(data))}>Ver los {formatNumber(data.records_count, 0)} registros de cosecha</Button>
  </div>;
}

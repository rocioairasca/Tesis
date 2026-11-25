import React, { useEffect, useRef, useState } from 'react';
import { Button, Input } from 'antd';
import { LoadingState, ErrorState, StatusBadge, ConfirmDialog, FocusModal } from '../../components/ui';
import { CloseOutlined } from '../../components/AppIcons';
import useIsMobile from '../../hooks/useIsMobile';
import { declareCompleteness, getHarvestResultDetail, newIdempotencyKey } from '../../services/harvestService';
import { formatCalendarDate } from '../../utils/calendarDate';
import { formatNumber } from '../../utils/numberFormat';
import { blockerText, categoryLabel, completeWarning, costDisclaimer, distributionLabel, formatArea, formatCostPerHa, formatCostPerTn, formatProductionUnit, formatUsd, formatYield, harvestStatus,
  hasKnownCost, pendingEntryNote, provisionalNote, proratedNote, recordsFilterFor, resultKeyParams, resultTitle, revisedBy } from './harvestResults.mjs';

const stripFloor = text => typeof text === 'string' ? text.replace(/^≥\s*/, '') : text;
const Row = ({ label, children, className }) => <div className={`gs-harvest-detail-row${className ? ' ' + className : ''}`}><dt>{label}</dt><dd>{children}</dd></div>;
const usdOrPending = value => value == null ? 'Falta definir' : formatUsd(value);

// Detail of one "Resultados por lote" row. Desktop: docked, non-modal panel. Mobile: full screen with a back button.
// Economic sections exist only when the server returned them (cost_access); nothing is hidden client-side.
export default function HarvestResultDetail({ params, unit, onClose, onViewRecords, refreshKey = 0, onRegisterExpense, onChanged }) {
  const mobile = useIsMobile();
  const [data, setData] = useState(null), [error, setError] = useState(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    getHarvestResultDetail(params).then(response => { if (!cancelled) setData(response); }).catch(reason => { if (!cancelled) setError(reason); });
    return () => { cancelled = true; };
  }, [params, refreshKey, revision]);

  const body = error ? <ErrorState error={error} onRetry={() => setRevision(value => value + 1)} />
    : !data ? <LoadingState label="Cargando detalle…" rows={4} /> : <Content data={data} unit={unit} onViewRecords={onViewRecords} onRegisterExpense={onRegisterExpense} onChanged={() => { setRevision(value => value + 1); onChanged?.(); }} />;
  const title = data ? resultTitle(data) : 'Detalle del resultado';
  const harvestBadge = data?.harvest_status ? harvestStatus(data.harvest_status) : null;
  const header = <div className="gs-harvest-detail-header">
    {mobile && <Button type="link" onClick={onClose}>Volver a resultados</Button>}
    <div>
      <h2>{title}</h2>
      {data && <p className="gs-ui-helper">
        {data.crop.name} · {data.campaign.name}
        {harvestBadge && <> · <StatusBadge tone={harvestBadge.tone}>{harvestBadge.label}</StatusBadge></>}
      </p>}
    </div>
    {!mobile && <Button type="text" icon={<CloseOutlined />} aria-label="Cerrar detalle" onClick={onClose} />}
  </div>;
  return <aside className={mobile ? 'gs-harvest-result-detail gs-harvest-result-detail--full' : 'gs-harvest-result-detail'} aria-label="Detalle del resultado" role={mobile ? 'dialog' : undefined} aria-modal={mobile ? 'true' : undefined}>
    {header}{body}
  </aside>;
}

function Content({ data, unit, onViewRecords, onRegisterExpense, onChanged }) {
  const costs = data.costs;
  return <div className="gs-harvest-detail-body">

    {/* 1. PRODUCCIÓN */}
    <section className="gs-harvest-detail-section" aria-label="Producción">
      <h3>Producción</h3>
      <dl>
        <Row label="Superficie">{formatArea(data.surface_ha)}</Row>
        <Row label="Producción acumulada">{formatProductionUnit(data.production_kg, unit)}</Row>
        <Row label="Superficie cosechada">{formatArea(data.harvested_area_ha)}</Row>
        <Row label="Rendimiento">{formatYield(data.yield_kg_ha, unit)}</Row>
        <Row label="Registros">{data.records_count > 0
          ? <Button type="link" size="small" className="gs-harvest-records-link" onClick={() => onViewRecords(recordsFilterFor(data))}>{formatNumber(data.records_count, 0)} registros</Button>
          : <span>0</span>}</Row>
      </dl>
      {data.production_basis?.prorated_records > 0 && <p className="gs-ui-helper">{proratedNote}</p>}
    </section>

    {/* 2. COSTOS DE PLANIFICACIÓN */}
    {data.cost_access && data.cost_detail && <section className="gs-harvest-detail-section" aria-label="Costos de planificación">
      <h3>Costos de planificación</h3>
      {!data.cost_detail.plannings.length
        ? <><p className="gs-ui-helper">Todavía no hay costos provenientes de planificaciones.</p><p className="gs-ui-helper">Los costos aparecerán cuando completes actividades con información económica.</p></>

        : <ul className="gs-harvest-planning-list">{data.cost_detail.plannings.map(item => <li key={`${item.planning_id}-${item.sub_lot?.id || 'lot'}`}>
            <div className="gs-harvest-planning-head"><strong>{item.activity}</strong><span>{formatCalendarDate(item.effective_date)}</span></div>
            {item.planning_enabled === false && <div className="gs-ui-helper">Deshabilitada · el costo se conserva.</div>}
            <div className="gs-ui-helper">{item.sub_lot ? `${item.sub_lot.name} · ` : ''}Conocido: {usdOrPending(item.known_usd)}{item.pending_lines ? ` · ${item.pending_lines} pendiente${item.pending_lines === 1 ? '' : 's'}` : ''}</div>
            <ul>{item.lines.map((line, index) => <li key={index}>{line.name}{line.quantity ? ` · ${formatNumber(line.quantity)} ${line.unit}` : ''}: {line.pending ? 'Pendiente' : formatUsd(line.amount_usd)}</li>)}</ul>
          </li>)}</ul>}
    </section>}

    {/* 3. GASTOS ADICIONALES */}
    {data.cost_access && data.cost_detail?.other_expenses && <OtherExpenses groups={data.cost_detail.other_expenses} />}

    {/* 4. COSTOS Y RENTABILIDAD */}
    {data.cost_access && costs && <section className="gs-harvest-detail-section" aria-label="Costos y rentabilidad">
      <h3>Costos y rentabilidad</h3>
      <dl>
        <Row label="Productos">{usdOrPending(costs.products_usd)}</Row>
        <Row label="Mano de obra">{usdOrPending(costs.labor_usd)}</Row>
        <Row label="Otros gastos">{usdOrPending(costs.other_usd)}</Row>
        <Row label="Total registrado" className="gs-harvest-total-row"><strong>{hasKnownCost(costs) ? formatUsd(costs.known_total_usd) : 'Falta definir'}</strong></Row>
      </dl>
      {(costs.pending_lines > 0 || costs.pending_entries > 0) && <p className="gs-harvest-pending-note" role="note">
        {[costs.pending_lines > 0 && `${costs.pending_lines} concepto${costs.pending_lines === 1 ? '' : 's'} sin valorizar`,
          costs.pending_entries > 0 && `${costs.pending_entries} gasto${costs.pending_entries === 1 ? '' : 's'} sin cotización`].filter(Boolean).join(' · ')}
      </p>}
      {(costs.per_ha_usd != null || costs.per_tn_usd != null) && <dl className="gs-harvest-cost-rates">
        {costs.per_ha_usd != null && <Row label="Gasto / ha">
          <div className="gs-harvest-cost-two-line">{stripFloor(formatCostPerHa(costs))}{costs.is_minimum && <small className="gs-harvest-floor-note">Mínimo registrado</small>}</div>
        </Row>}
        {costs.per_tn_usd != null && <Row label="Gasto / tn">
          <div className="gs-harvest-cost-two-line">{stripFloor(formatCostPerTn(costs))}{costs.is_minimum && <small className="gs-harvest-floor-note">Mínimo registrado</small>}</div>
        </Row>}
      </dl>}
      {costs.is_provisional && <p className="gs-ui-helper">{provisionalNote}</p>}
      {costs.status !== 'complete' && <p className="gs-harvest-note" role="note">{costDisclaimer}</p>}
    </section>}

    {/* 5. ESTADO DE COMPLETITUD */}
    {data.cost_access && data.completeness && <Completeness data={data} onRegisterExpense={onRegisterExpense} onChanged={onChanged} />}
  </div>;
}


function OtherExpenses({ groups }) {
  return <section className="gs-harvest-detail-section" aria-label="Gastos adicionales">
    <h3>Gastos adicionales</h3>
    {!groups.length ? <p className="gs-ui-helper">No hay gastos adicionales registrados para este resultado.</p>
      : <ul className="gs-harvest-planning-list">{groups.map(group => <li key={group.category}>
        <div className="gs-harvest-planning-head"><strong>{categoryLabel(group.category)}</strong><span>{usdOrPending(group.known_usd)}</span></div>
        <ul>{group.entries.map(item => <li key={`${item.entry_id}-${item.sub_lot?.id || 'lot'}`}>
          {item.description} · {formatCalendarDate(item.expense_date)} · {item.pending ? 'Pendiente' : formatUsd(item.amount_usd)}
          <div className="gs-ui-helper">{distributionLabel(item.method)}{item.reference ? ` · ${item.reference}` : ''}{item.sub_lot ? ` · Subdivisión ${item.sub_lot.name}` : ''}</div>
          {item.pending && <div className="gs-ui-helper">{pendingEntryNote}</div>}
        </li>)}</ul>
      </li>)}</ul>}
  </section>;
}

// Explicit completeness: nothing is "Completo" without a human declaration that is still valid (no newer evidence).
function Completeness({ data, onRegisterExpense, onChanged }) {
  const c = data.completeness, costs = data.costs, edit = data.economic_edit;
  const [confirm, setConfirm] = useState(false), [reopen, setReopen] = useState(false), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const keys = resultKeyParams(data);
  const complete = c.status === 'complete', reviewed = c.parts.filter(part => part.valid);
  const changed = c.parts.some(part => part.evidence_changed || part.auto_invalidated);
  const intent = useRef(newIdempotencyKey());     // same key while an attempt is retried; renewed after it succeeds
  const send = async payload => declareCompleteness({ ...payload, ...keys, ...(c.include_children ? { include_children: true } : {}) }, intent.current);
  const expenses = (data.cost_detail?.other_expenses || []).reduce((n, group) => n + group.entries.length, 0) + (data.cost_detail?.plannings?.length || 0);
  const run = async payload => {
    setBusy(true); setError(null);
    try { await send(payload); setConfirm(false); setReopen(false); setReason(''); intent.current = newIdempotencyKey(); onChanged(); }
    catch (reasonError) { setError(reasonError?.response?.data?.message || reasonError?.response?.data?.error || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };
  const statusTitle = complete
    ? 'Costos completos'
    : changed ? 'Los costos cambiaron — revisalos'
    : c.can_declare ? 'Los costos están listos para finalizar'
    : 'Falta completar costos';
  return <section className="gs-harvest-detail-section" aria-label="Estado de los gastos">
    <p className="gs-harvest-completeness-title">{statusTitle}</p>
    {complete && reviewed.length > 0 && <p className="gs-ui-helper">{revisedBy(reviewed[0])}</p>}
    {complete && !c.can_reopen && <p className="gs-ui-helper">Todos los costos registrados fueron revisados.</p>}
    {!complete && changed && <p className="gs-harvest-warning" role="note">Hubo cambios en los gastos desde la última revisión.</p>}
    {edit && !complete && blockerText(c.blockers).map(text => <p className="gs-ui-helper" key={text} role="note">{text}</p>)}
    {edit && <div className="gs-harvest-cost-actions">
      <Button onClick={() => onRegisterExpense?.({ campaign_id: keys.campaign_id, crop_id: keys.crop_id, lot_id: keys.lot_id, sub_lot_id: keys.sub_lot_id })}>Registrar gasto</Button>
      {!complete && <Button type="primary" disabled={!c.can_declare} onClick={() => setConfirm(true)}>Finalizar carga de costos</Button>}
      {c.can_reopen && <Button onClick={() => setReopen(true)}>Volver a revisar</Button>}
    </div>}
    <FocusModal open={confirm} title="Finalizar carga de costos" onCancel={() => setConfirm(false)} busy={busy}
      footer={<><Button onClick={() => setConfirm(false)} disabled={busy}>Cancelar</Button><Button type="primary" loading={busy} onClick={() => run({ action: 'complete' })}>Finalizar carga de costos</Button></>}>
      <p>Gasto conocido: <strong>{hasKnownCost(costs) ? formatUsd(costs.known_total_usd) : 'Falta definir'}</strong></p>
      <p>Gastos considerados: {formatNumber(expenses, 0)} · Falta definir: {formatNumber((costs?.pending_lines || 0) + (costs?.pending_entries || 0), 0)}</p>
      <p className="gs-harvest-warning" role="note">{completeWarning}</p>
      {error && <p className="gs-harvest-warning" role="alert">{error}</p>}
    </FocusModal>
    <FocusModal open={reopen} title="Volver a revisar costos" onCancel={() => setReopen(false)} busy={busy}
      footer={<><Button onClick={() => setReopen(false)} disabled={busy}>Cancelar</Button><Button type="primary" loading={busy} disabled={!reason.trim()} onClick={() => run({ action: 'reopen', reason })}>Volver a revisar</Button></>}>
      <p>Los costos vuelven a revisión hasta que se cierren nuevamente. Indicá el motivo.</p>
      <Input.TextArea aria-label="Motivo" rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
      {error && <p className="gs-harvest-warning" role="alert">{error}</p>}
    </FocusModal>
  </section>;
}

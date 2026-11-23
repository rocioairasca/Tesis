import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Radio, Select } from 'antd';
import api from '../../services/apiClient';
import { createCostEntry, newIdempotencyKey } from '../../services/harvestService';
import { COST_CATEGORIES, buildCostPayload, campaignScopeNotice, overlapWarning, pendingEntryNote, percentsSumToHundred } from './harvestResults.mjs';

const unitsOfLot = lot => (Array.isArray(lot?.active_layout?.sub_lots) ? lot.active_layout.sub_lots : []);
export const destinationOptions = (lots = []) => lots.flatMap(lot => [
  { value: `lot:${lot.id}`, label: lot.name, lot_id: lot.id, sub_lot_id: null },
  ...unitsOfLot(lot).map(sub => ({ value: `sub:${lot.id}:${sub.id}`, label: `${lot.name} · ${sub.name}`, lot_id: lot.id, sub_lot_id: sub.id })),
]);
const Field = ({ label, children, help }) => <label className="gs-harvest-cost-field"><span>{label}</span>{children}{help && <span className="gs-ui-helper">{help}</span>}</label>;

// "Registrar gasto": additional cost outside Planning. Company/actor never travel in the body (the server derives them).
// `preset` preselects campaign/crop/destination from a result detail; everything stays editable except the tenant (not in the form).
export default function HarvestCostForm({ lots = [], crops = [], preset = null, onSuccess, onCancel }) {
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState(() => ({
    campaign_id: preset?.campaign_id || undefined, crop_id: preset?.crop_id || undefined, category: undefined, description: '', expense_date: '', amount: '', currency: 'USD',
    payment_date: '', fx_rate: '', fx_source: '', supplier_name: '', reference: '', notes: '', scope: 'lots', method: 'area_proportional',
    targets: preset?.lot_id ? [{ key: preset.sub_lot_id ? `sub:${preset.lot_id}:${preset.sub_lot_id}` : `lot:${preset.lot_id}`, lot_id: preset.lot_id, sub_lot_id: preset.sub_lot_id || null, percent: '100' }] : [],
  }));
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const key = useRef(newIdempotencyKey());          // one key per intent: a retry after a network failure cannot duplicate the cost
  const set = (name, value) => setForm(previous => ({ ...previous, [name]: value }));

  useEffect(() => {
    let cancelled = false;
    api.get('/campaigns', { params: { includeClosed: true } }).then(({ data }) => { if (!cancelled) setCampaigns(Array.isArray(data) ? data : data?.items || data?.data || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const options = useMemo(() => destinationOptions(lots), [lots]);
  const pickTargets = values => set('targets', values.map(value => {
    const option = options.find(item => item.value === value), previous = form.targets.find(item => item.key === value);
    return { key: value, lot_id: option.lot_id, sub_lot_id: option.sub_lot_id, percent: previous?.percent ?? '' };
  }));
  const setPercent = (targetKey, percent) => set('targets', form.targets.map(item => item.key === targetKey ? { ...item, percent } : item));

  const ars = form.currency === 'ARS', fxReady = !!(form.payment_date && String(form.fx_rate).trim() && form.fx_source.trim());
  const manual = form.scope === 'lots' && form.method === 'manual_percent';
  const problems = [];
  if (!form.campaign_id) problems.push('Elegí la campaña.');
  if (!form.crop_id) problems.push('Elegí el cultivo.');
  if (!form.category) problems.push('Elegí la categoría.');
  if (!form.description.trim()) problems.push('Escribí una descripción.');
  if (!form.expense_date) problems.push('Indicá la fecha del gasto.');
  if (!/^\d{1,14}([.,]\d{1,6})?$/.test(String(form.amount).trim())) problems.push('Ingresá un importe válido (hasta 6 decimales).');
  if (form.scope === 'lots' && !form.targets.length) problems.push('Elegí al menos un lote o sublote.');
  if (manual && !percentsSumToHundred(form.targets.map(item => item.percent))) problems.push('Los porcentajes deben sumar exactamente 100.');

  const submit = async () => {
    if (busy || problems.length) return;
    setBusy(true); setError(null);
    try { await createCostEntry(buildCostPayload(form), key.current); onSuccess?.(); }
    catch (reason) { setError(reason?.response?.data?.message || reason?.response?.data?.error || reason?.message || 'No se pudo registrar el gasto.'); }
    finally { setBusy(false); }
  };

  return <form className="gs-harvest-cost-form" onSubmit={event => { event.preventDefault(); submit(); }} aria-label="Registrar gasto">
    <Alert type="info" showIcon message={overlapWarning} />
    <Field label="Campaña"><Select aria-label="Campaña" value={form.campaign_id} onChange={value => set('campaign_id', value)} placeholder="Elegí la campaña"
      options={campaigns.map(item => ({ value: item.id, label: item.name }))} /></Field>
    <Field label="Cultivo"><Select aria-label="Cultivo" value={form.crop_id} onChange={value => set('crop_id', value)} placeholder="Elegí el cultivo"
      options={crops.map(item => ({ value: item.id, label: item.name }))} /></Field>
    <Field label="Categoría"><Select aria-label="Categoría" value={form.category} onChange={value => set('category', value)} placeholder="Elegí la categoría" options={COST_CATEGORIES} /></Field>
    <Field label="Descripción"><Input aria-label="Descripción" maxLength={500} value={form.description} onChange={event => set('description', event.target.value)} /></Field>
    <Field label="Fecha del gasto"><Input aria-label="Fecha del gasto" type="date" value={form.expense_date} onChange={event => set('expense_date', event.target.value)} /></Field>
    <div className="gs-harvest-cost-row">
      <Field label="Importe"><Input aria-label="Importe" inputMode="decimal" value={form.amount} onChange={event => set('amount', event.target.value)} /></Field>
      <Field label="Moneda"><Select aria-label="Moneda" value={form.currency} onChange={value => set('currency', value)} options={[{ value: 'USD', label: 'USD' }, { value: 'ARS', label: 'ARS' }]} /></Field>
    </div>
    {ars && <fieldset className="gs-harvest-cost-fx"><legend>Cotización (dólar mayorista del día de pago)</legend>
      <Field label="Fecha de pago"><Input aria-label="Fecha de pago" type="date" value={form.payment_date} onChange={event => set('payment_date', event.target.value)} /></Field>
      <Field label="Cotización"><Input aria-label="Cotización" inputMode="decimal" value={form.fx_rate} onChange={event => set('fx_rate', event.target.value)} /></Field>
      <Field label="Fuente de la cotización"><Input aria-label="Fuente de la cotización" maxLength={500} value={form.fx_source} onChange={event => set('fx_source', event.target.value)} /></Field>
      {!fxReady && <p className="gs-harvest-warning" role="note">{pendingEntryNote}</p>}
    </fieldset>}

    <Field label="Destino">
      <Radio.Group aria-label="Destino" value={form.scope} onChange={event => set('scope', event.target.value)}
        options={[{ value: 'lots', label: 'Lotes o sublotes' }, { value: 'campaign', label: 'Toda la campaña' }]} />
    </Field>
    {form.scope === 'campaign'
      ? <p className="gs-ui-helper" role="note">{campaignScopeNotice}</p>
      : <>
        <Field label="Lotes o sublotes"><Select aria-label="Lotes o sublotes" mode="multiple" value={form.targets.map(item => item.key)} onChange={pickTargets} options={options} placeholder="Elegí los destinos" optionFilterProp="label" /></Field>
        <Field label="Distribución"><Radio.Group aria-label="Distribución" value={form.method} onChange={event => set('method', event.target.value)}
          options={[{ value: 'area_proportional', label: 'Por superficie' }, { value: 'manual_percent', label: 'Porcentaje manual' }]} /></Field>
        {manual && form.targets.map(target => <Field key={target.key} label={`% para ${options.find(item => item.value === target.key)?.label || ''}`}>
          <Input aria-label={`Porcentaje ${options.find(item => item.value === target.key)?.label || ''}`} inputMode="decimal" value={target.percent} onChange={event => setPercent(target.key, event.target.value)} /></Field>)}
      </>}

    <Field label="Proveedor o referencia (opcional)"><Input aria-label="Proveedor" maxLength={500} value={form.supplier_name} onChange={event => set('supplier_name', event.target.value)} /></Field>
    <Field label="Comprobante (opcional)"><Input aria-label="Comprobante" maxLength={500} value={form.reference} onChange={event => set('reference', event.target.value)} /></Field>
    <Field label="Notas (opcional)"><Input.TextArea aria-label="Notas" maxLength={2000} rows={2} value={form.notes} onChange={event => set('notes', event.target.value)} /></Field>

    {error && <Alert type="error" showIcon message={String(error)} />}
    {!!problems.length && <ul className="gs-ui-helper" aria-label="Datos pendientes">{problems.map(item => <li key={item}>{item}</li>)}</ul>}
    <div className="gs-harvest-cost-actions">
      <Button onClick={onCancel} disabled={busy}>Cancelar</Button>
      <Button type="primary" htmlType="submit" loading={busy} disabled={!!problems.length}>Registrar gasto</Button>
    </div>
  </form>;
}

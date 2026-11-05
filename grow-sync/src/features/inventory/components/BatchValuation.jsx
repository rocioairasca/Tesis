import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { getBatchValuation, getBatchValuationHistory, createBatchValuation } from '../../../services/stockService';
import { unitLabel } from '../../../utils/inventoryUnits';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';
import { receivedLabel } from '../inventoryModel.mjs';
import './batchValuation.css';

export function valuationPrice(row, unit) {
  if (row?.unit_cost_original == null) return 'Costo pendiente';
  const [whole, fraction = ''] = String(row.unit_cost_original).split('.');
  const formatted = whole + ',' + fraction.replace(/0+$/, '').padEnd(2, '0');
  return row.currency + ' ' + formatted + ' / ' + unitLabel(unit);
}

function ValuationDetails({ row, unit }) {
  return <>
    <Space wrap><Tag color={row.status === 'confirmed' ? 'green' : 'gold'}>{row.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}</Tag>
      <Typography.Text type="secondary">Revisión {row.revision}</Typography.Text></Space>
    <p className="inventory-valuation-price"><strong>{valuationPrice(row, unit)}</strong></p>
    <Descriptions size="small" column={1} items={[
      ['Factura', row.invoice_reference], ['Fecha factura', row.invoice_date ? receivedLabel(row.invoice_date) : null],
      ['Proveedor', row.supplier_name], ['Motivo / observación', row.reason],
    ].map(([label, value]) => ({ key: label, label, children: value || 'No registrado' }))} />
    {row.status === 'pending' && row.unit_cost_original != null &&
      <Typography.Text type="secondary">Importe informado, pendiente de confirmación.</Typography.Text>}
  </>;
}

export default function BatchValuation({ productId, batch, canEdit }) {
  const [current, setCurrent] = useState(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(null), [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(undefined), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false), [history, setHistory] = useState([]), [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState(null);
  const [form] = Form.useForm();
  const currency = Form.useWatch('currency', form), status = Form.useWatch('status', form);
  const retry = useRef(null), busy = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    getBatchValuation(productId, batch.id).then(data => { if (active) setCurrent(data.current); })
      .catch(e => { if (active) setError(getUserFriendlyError(e, 'No se pudo cargar la valorización.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, batch.id, attempt]);
  useEffect(() => {
    if (!historyOpen) return undefined;
    let active = true;
    setHistoryLoading(true); setHistoryError(null);
    getBatchValuationHistory(productId, batch.id, {page:historyPage,pageSize:10})
      .then(data => { if (active) setHistory(data.data); })
      .catch(e => { if (active) setHistoryError(getUserFriendlyError(e, 'No se pudo cargar el historial.')); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [productId, batch.id, historyOpen, historyPage, attempt]);
  const openForm = () => {
    setEditing(current); setSaveError(null); retry.current = null;
    form.setFieldsValue({ status:current?.status || 'pending', currency:current?.currency || 'USD',
      unit_cost_original:current?.unit_cost_original ?? null, invoice_date:current?.invoice_date || '',
      invoice_reference:current?.invoice_reference || '', supplier_name:current?.supplier_name || '', reason:'' });
  };
  const save = async values => {
    if (busy.current || !canEdit) return;
    busy.current = true; setSaving(true); setSaveError(null);
    const body = {status:values.status,currency:values.currency,unit_cost_original:values.unit_cost_original ?? null,
      invoice_date:values.invoice_date || null,invoice_reference:values.invoice_reference || null,
      supplier_name:values.supplier_name || null,reason:values.reason || null,
      supersedes_id:editing?.id || null,provenance:editing?.provenance || 'manual',
      invoice_total_original:values.currency === editing?.currency ? editing?.invoice_total_original ?? null : null,
      payment_date:editing?.payment_date ?? null};
    const fingerprint = JSON.stringify(body);
    if (retry.current?.fingerprint !== fingerprint) retry.current = {fingerprint,key:crypto.randomUUID()};
    try {
      await createBatchValuation(productId, batch.id, body, retry.current.key);
      setEditing(undefined); setHistoryPage(1); setAttempt(n => n + 1);
    } catch(e) {
      setSaveError(getUserFriendlyError(e, 'No se pudo guardar la valorización.'));
      if (e.response?.status === 409) setAttempt(n => n + 1);
    } finally { busy.current = false; setSaving(false); }
  };
  return <section className="inventory-valuation" aria-label="Valorización">
    <Typography.Title level={5}>Valorización</Typography.Title>
    {loading ? <Spin /> : error ? <Alert type="error" message={error}
      action={<Button onClick={() => setAttempt(n => n + 1)}>Reintentar</Button>} /> : <>
      {current ? <ValuationDetails row={current} unit={batch.unit} /> : <>
        <Tag color="gold">Pendiente</Tag><p>Costo pendiente. Todavía no se registró una valorización.</p>
      </>}
      <div className="inventory-valuation-actions">
        {canEdit && <Button onClick={openForm}>{current?.status === 'confirmed' ? 'Corregir valorización' : 'Valorizar'}</Button>}
        {current && <Button type="link" onClick={() => {setHistoryPage(1);setHistoryOpen(true);}}>Ver historial</Button>}
      </div>
    </>}
    <Modal open={editing !== undefined} title={editing?.status === 'confirmed' ? 'Corregir valorización' : 'Valorizar partida'}
      footer={null} onCancel={() => !saving && setEditing(undefined)} closable={!saving} maskClosable={!saving} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save} disabled={saving}>
        <p>Precio por unidad base: <strong>{unitLabel(batch.unit)}</strong>. Cantidad original: {batch.initial_quantity} {unitLabel(batch.unit)}.</p>
        {saveError && <Alert type="error" message={saveError} />}
        <Form.Item name="currency" label="Moneda" rules={[{required:true}]}>
          <Select options={[{value:'USD',label:'USD'},{value:'ARS',label:'ARS'}]}
            onChange={value => {if(value === 'ARS') form.setFieldValue('status','pending');}} />
        </Form.Item>
        <Form.Item name="status" label="Estado" rules={[{required:true}]}>
          <Select options={[{value:'pending',label:'Pendiente'},{value:'confirmed',label:'Confirmada',disabled:currency === 'ARS'}]} />
        </Form.Item>
        {currency === 'ARS' && <Alert type="info" message="Las valorizaciones en ARS permanecen pendientes en esta etapa." />}
        <Form.Item name="unit_cost_original" label={'Costo unitario (' + (currency || 'USD') + ' / ' + unitLabel(batch.unit) + ')'}
          rules={[{required:status === 'confirmed',message:'Ingresá el costo unitario.'}]}>
          <InputNumber stringMode min="0" precision={6} className="inventory-valuation-input" />
        </Form.Item>
        <Form.Item name="invoice_date" label="Fecha factura"><Input type="date" /></Form.Item>
        <Form.Item name="invoice_reference" label="Referencia de factura"><Input maxLength={500} /></Form.Item>
        <Form.Item name="supplier_name" label="Proveedor"><Input maxLength={500} /></Form.Item>
        <Form.Item name="reason" label={editing ? 'Motivo de la revisión' : 'Observación'}
          rules={[{required:!!editing,whitespace:true,message:'Indicá el motivo de la nueva revisión.'}]}>
          <Input.TextArea maxLength={2000} rows={2} />
        </Form.Item>
        <div className="inventory-valuation-actions">
          <Button onClick={() => setEditing(undefined)} disabled={saving}>Cancelar</Button>
          <Button type="primary" htmlType="submit" loading={saving} aria-label="Guardar valorización" aria-busy={saving}>Guardar valorización</Button>
        </div>
      </Form>
    </Modal>
    <Modal open={historyOpen} title="Historial de valorización" footer={null} onCancel={() => setHistoryOpen(false)}>
      <Spin spinning={historyLoading}>
        {historyError ? <Alert type="error" message={historyError} action={<Button onClick={()=>setAttempt(n=>n+1)}>Reintentar</Button>} /> :
          history.length ? <Space direction="vertical" className="inventory-valuation-input">{history.map(row =>
            <Card size="small" key={row.id}><ValuationDetails row={row} unit={batch.unit} />
              <Typography.Text type="secondary">{new Date(row.created_at).toLocaleString('es-AR')}</Typography.Text></Card>
          )}</Space> : !historyLoading && <Empty description="Sin revisiones" />}
        <div className="inventory-valuation-actions">
          <Button disabled={historyPage === 1 || historyLoading} onClick={() => setHistoryPage(n=>n-1)}>Anterior</Button>
          <span>Página {historyPage}</span>
          <Button disabled={history.length < 10 || historyLoading} onClick={() => setHistoryPage(n=>n+1)}>Siguiente</Button>
        </div>
      </Spin>
    </Modal>
  </section>;
}

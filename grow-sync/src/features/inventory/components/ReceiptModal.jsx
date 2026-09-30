import {unitLabel,normalizeUnit} from '../../../utils/inventoryUnits';
import QuantityUnitFields from '../../../components/QuantityUnitFields';
import {normalizeQuantity,receiptQuantityPayload} from '../../../utils/inventoryConversion';
import React, { useRef, useState } from 'react';
import { Alert, Button, Collapse, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Select, Space, notification } from 'antd';
import dayjs from 'dayjs';
import esES from 'antd/locale/es_ES';
import api from '../../../services/apiClient';
import { registerStockReceipt } from '../../../services/stockService';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';
import { canReceipt, expirationLabel, receiptExpirationPayload, quantityLabel, receiptPreview, stockQuantity, validateReceipt } from '../inventoryModel.mjs';

export function ReceiptExpirationField({ name = 'expiration_period', components } = {}) {
  return <Form.Item name={name} label="Vencimiento">
    <DatePicker picker="month" format="MM/YYYY" components={components} placeholder="MM/AAAA" locale={(esES.default ?? esES).DatePicker} allowClear
      minDate={dayjs('2000-01-01')} maxDate={dayjs('2100-12-31')} style={{ width: '100%' }} />
  </Form.Item>;
}

export default function ReceiptModal({ products, product, enabled, canEdit, canCreate, onCreate, onClose, onSaved }) {
  const [form] = Form.useForm();
  const productId = Form.useWatch('product_id', form);
  const currency = Form.useWatch('currency', form);
  const selected = products.find(p => p.id === productId);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const retry = useRef(null);
  const busy = useRef(false);
  const prepare = values => {
    try {
      if (!selected) throw new Error('Seleccioná un producto.');
      if (enabled) receiptExpirationPayload(values.expiration_period);
      const normalized=normalizeQuantity({quantity:values.quantity,inputUnit:values.unit,productUnit:selected.unit});
      const baseValues={...values,quantity:normalized.normalized_quantity};
      validateReceipt(baseValues, enabled);
      setPreview({ values, normalizedQuantity:normalized.normalized_quantity, product: selected, ...receiptPreview(baseValues, stockQuantity(selected, enabled)) });
    } catch (e) { notification.error({ message: e.message }); }
  };
  const confirm = async () => {
    if (busy.current || !preview || !canEdit || (enabled && !canReceipt(enabled, canEdit))) return;
    busy.current = true; setSaving(true);
    try {
      const { values: v, product: p } = preview;
      if (enabled) {
        const payload = { ...receiptQuantityPayload(v,p), origin: 'purchase', received_date: v.received_date,
          ...receiptExpirationPayload(v.expiration_period), supplier: v.supplier || null, reference: v.reference || null, notes: v.notes || null,
          currency: v.currency || 'ARS',
          exchange_rate: v.currency === 'USD' ? v.exchange_rate : null, total_original: preview.total_original, total_ars: preview.total_ars };
        const fingerprint = JSON.stringify([p.id, payload]);
        if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
        await registerStockReceipt(p.id, payload, retry.current.key);
      } else {
        await api.patch(`/products/${p.id}/add-stock`, { quantity: v.quantity });
      }
      notification.success({ message: 'Ingreso registrado' });
      onSaved(); onClose();
    } catch (e) { notification.error({ message: getUserFriendlyError(e, 'No se pudo registrar el ingreso.') }); }
    finally { busy.current = false; setSaving(false); }
  };
  return <Modal open title="Registrar ingreso" width={600} footer={null} onCancel={() => !saving && onClose()} maskClosable={!saving} closable={!saving}>
    {preview ? <>
      <Alert type="info" showIcon message={`Se agregarán ${quantityLabel(preview.normalizedQuantity, preview.product.unit)} de ${preview.product.name}`} />
      <Descriptions column={1} style={{ marginTop: 16 }} items={[
        { key: 'current', label: 'Stock actual', children: quantityLabel(stockQuantity(preview.product, enabled), preview.product.unit) },
        { key: 'after', label: 'Stock después del ingreso', children: quantityLabel(preview.after, preview.product.unit) },
        ...(enabled ? [{ key: 'expiration', label: 'Vencimiento', children: expirationLabel(receiptExpirationPayload(preview.values.expiration_period)) },
          { key: 'supplier', label: 'Proveedor', children: preview.values.supplier || 'No registrado' },
          ...(preview.total_original != null ? [{ key: 'total', label: 'Total original', children: `${preview.total_original} ${preview.values.currency || 'ARS'}` }, { key: 'ars', label: 'Total ARS', children: preview.total_ars }] : [])] : []),
      ]} />
      <Space wrap><Button disabled={saving} onClick={() => setPreview(null)}>Volver</Button><Button type="primary" loading={saving} disabled={!canEdit} onClick={confirm}>Confirmar ingreso</Button></Space>
    </> : <Form form={form} layout="vertical" onFinish={prepare} initialValues={{ product_id: product?.id, unit:normalizeUnit(product?.unit), currency: 'ARS' }}>
      <Form.Item name="product_id" label="Producto" rules={[{ required: true, message: 'Seleccioná un producto.' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Buscar producto..." options={products.map(p => ({ value: p.id, label: p.name }))}
          onChange={id=>form.setFieldsValue({unit:normalizeUnit(products.find(p=>p.id===id)?.unit)})} />
      </Form.Item>
      {canCreate && <Button type="link" style={{ paddingLeft: 0 }} onClick={onCreate}>Crear nuevo producto</Button>}
      <QuantityUnitFields quantityName="quantity" unitName="unit" baseUnit={selected?.unit} allowConversion={enabled} previewPrefix="Se registrarán" />
      {enabled && <>
        <Form.Item name="received_date" label="Fecha de ingreso" rules={[{ required: true, message: 'Ingresá la fecha de ingreso.' }]}><Input type="date" /></Form.Item>
        <ReceiptExpirationField />
        <Collapse items={[{ key: 'purchase', label: 'Datos de compra', forceRender: true, children: <>
          <Form.Item name="supplier" label="Proveedor"><Input maxLength={500} /></Form.Item>
          <Form.Item name="unit_price" label={selected ? `Precio por ${unitLabel(selected.unit)}` : 'Precio por unidad base'}><InputNumber stringMode min="0" precision={6} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="currency" label="Moneda"><Select options={['ARS', 'USD'].map(value => ({ value, label: value }))} /></Form.Item>
          {currency === 'USD' && <Form.Item name="exchange_rate" label="Tipo de cambio (ARS por USD)" rules={[{ required: true, message: 'Ingresá el tipo de cambio.' }]}><InputNumber stringMode min="0.000001" precision={6} style={{ width: '100%' }} /></Form.Item>}
          <Form.Item name="reference" label="N° factura / comprobante"><Input maxLength={500} /></Form.Item>
          <Form.Item name="notes" label="Observaciones"><Input.TextArea maxLength={2000} /></Form.Item>
        </> }]} />
      </>}
      <Button type="primary" htmlType="submit" disabled={!canEdit} block style={{ marginTop: 20 }}>Revisar ingreso</Button>
    </Form>}
  </Modal>;
}

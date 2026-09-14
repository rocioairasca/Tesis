import {unitLabel} from '../../../utils/inventoryUnits';
import React, { useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Form, Input, InputNumber, Modal, Select, Space, notification } from 'antd';
import api from '../../../services/apiClient';
import { registerStockReceipt } from '../../../services/stockService';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';
import { canReceipt, expirationLabel, quantityLabel, receiptPreview, stockQuantity, validateReceipt } from '../inventoryModel.mjs';

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
      validateReceipt(values, enabled);
      if (!selected) throw new Error('Seleccioná un producto.');
      setPreview({ values, product: selected, ...receiptPreview(values, stockQuantity(selected, enabled)) });
    } catch (e) { notification.error({ message: e.message }); }
  };
  const confirm = async () => {
    if (busy.current || !preview || !canEdit || (enabled && !canReceipt(enabled, canEdit))) return;
    busy.current = true; setSaving(true);
    try {
      const { values: v, product: p } = preview;
      if (enabled) {
        const payload = { quantity: v.quantity, unit: p.unit, origin: 'purchase', received_date: v.received_date,
          expiration_date: v.expiration_date || null, supplier: v.supplier || null, reference: v.reference || null, notes: v.notes || null,
          unit_price: v.unit_price == null || v.unit_price === '' ? null : v.unit_price, currency: v.currency || 'ARS',
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
      <Alert type="info" showIcon message={`Se agregarán ${quantityLabel(preview.values.quantity, preview.product.unit)} de ${preview.product.name}`} />
      <Descriptions column={1} style={{ marginTop: 16 }} items={[
        { key: 'current', label: 'Stock actual', children: quantityLabel(stockQuantity(preview.product, enabled), preview.product.unit) },
        { key: 'after', label: 'Stock después del ingreso', children: quantityLabel(preview.after, preview.product.unit) },
        ...(enabled ? [{ key: 'expiration', label: 'Vencimiento', children: expirationLabel(preview.values.expiration_date) },
          { key: 'supplier', label: 'Proveedor', children: preview.values.supplier || 'No registrado' },
          ...(preview.total_original != null ? [{ key: 'total', label: 'Total original', children: `${preview.total_original} ${preview.values.currency || 'ARS'}` }, { key: 'ars', label: 'Total ARS', children: preview.total_ars }] : [])] : []),
      ]} />
      <Space wrap><Button disabled={saving} onClick={() => setPreview(null)}>Volver</Button><Button type="primary" loading={saving} disabled={!canEdit} onClick={confirm}>Confirmar ingreso</Button></Space>
    </> : <Form form={form} layout="vertical" onFinish={prepare} initialValues={{ product_id: product?.id, currency: 'ARS' }}>
      <Form.Item name="product_id" label="Producto" rules={[{ required: true, message: 'Seleccioná un producto.' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Buscar producto..." options={products.map(p => ({ value: p.id, label: p.name }))} />
      </Form.Item>
      {canCreate && <Button type="link" style={{ paddingLeft: 0 }} onClick={onCreate}>Crear nuevo producto</Button>}
      <Form.Item name="quantity" label="Cantidad" rules={[{ required: true, message: 'Ingresá la cantidad.' }]}><InputNumber addonAfter={selected ? unitLabel(selected.unit) : undefined} decimalSeparator="," stringMode min="0.000001" precision={6} style={{ width: '100%' }} /></Form.Item>
      {enabled && <>
        <Form.Item name="received_date" label="Fecha de ingreso" rules={[{ required: true, message: 'Ingresá la fecha de ingreso.' }]}><Input type="date" /></Form.Item>
        <Form.Item name="expiration_date" label="Fecha de vencimiento"><Input type="date" /></Form.Item>
        <Collapse items={[{ key: 'purchase', label: 'Datos de compra', forceRender: true, children: <>
          <Form.Item name="supplier" label="Proveedor"><Input maxLength={500} /></Form.Item>
          <Form.Item name="unit_price" label="Precio unitario"><InputNumber stringMode min="0" precision={6} style={{ width: '100%' }} /></Form.Item>
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

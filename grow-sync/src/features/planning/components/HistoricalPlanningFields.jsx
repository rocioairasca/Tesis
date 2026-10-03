import React from 'react';
import { Alert, DatePicker, Form, Input, InputNumber, Select } from 'antd';
import { getPlanningLotName } from '../planningDisplay';

const positiveQuantity = [{ required: true, message: 'Ingresá una cantidad positiva.' }, {
  validator: (_, value) => value != null && Number.isFinite(Number(value)) && Number(value) > 0
    ? Promise.resolve() : Promise.reject(new Error('Ingresá una cantidad positiva.')),
}];

export default function HistoricalPlanningFields({ editing, responsibleOptions }) {
  return <>
    <Alert type="info" showIcon message="Corrección de antecedente"
      description="Esta actividad es histórica. Los cambios no modifican el inventario."
      style={{ marginBottom: 16 }} />
    <Form.Item name="title" label="Título"><Input /></Form.Item>
    <Form.Item name="description" label="Descripción"><Input.TextArea rows={3} /></Form.Item>
    <Form.Item name="responsible_user" label="Responsable" rules={[{ required: true, message: 'Seleccioná un responsable.' }]}>
      <Select options={responsibleOptions} />
    </Form.Item>
    <Form.Item name="date_range" label="Período" rules={[{ required: true, message: 'Seleccioná el período.' }]}>
      <DatePicker.RangePicker format="DD/MM/YYYY" allowClear={false} style={{ width: '100%' }} />
    </Form.Item>
    <Form.Item name="effective_date" label="Fecha real de realización"
      extra="Las fechas y superficies con ciclos vinculados requieren una corrección histórica integral.">
      <DatePicker format="DD/MM/YYYY" allowClear={false} style={{ width: '100%' }} />
    </Form.Item>
    {(editing.lots || []).map((lot, index) => <Form.Item key={`${lot.lot_id || lot.id}:${lot.sub_lot_id || ''}`}
      name={['historical_lots', index, 'area_ha']} label={`${getPlanningLotName(lot)} · Superficie histórica (ha)`}
      rules={[{ validator: (_, value) => value == null || (Number.isFinite(Number(value)) && Number(value) > 0)
        ? Promise.resolve() : Promise.reject(new Error('Ingresá una superficie positiva.')) }]}>
      <InputNumber stringMode min="0.000001" style={{ width: '100%' }} />
    </Form.Item>)}
    {(editing.products || []).map((product, index) => <div key={product.planning_product_id || product.id}
      style={{ borderTop: '1px solid #eee', paddingTop: 12, marginBottom: 16 }}>
      <Form.Item label="Producto"><Input aria-label="Producto" readOnly value={product.name} /></Form.Item>
      <Form.Item label="Unidad"><Input aria-label="Unidad" readOnly value={product.unit} /></Form.Item>
      {!product.usage_id && <Alert type="info" message="Este producto no tiene un uso histórico vinculado; sus cantidades son de solo lectura." />}
      <Form.Item name={['products', index, 'amount']} label="Cantidad planificada" rules={product.usage_id ? positiveQuantity : []}>
        <InputNumber stringMode disabled={!product.usage_id} min="0.000001" style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name={['products', index, 'actual_amount']} label="Cantidad real utilizada" rules={product.usage_id ? positiveQuantity : []}>
        <InputNumber stringMode disabled={!product.usage_id} min="0.000001" style={{ width: '100%' }} />
      </Form.Item>
    </div>)}
  </>;
}

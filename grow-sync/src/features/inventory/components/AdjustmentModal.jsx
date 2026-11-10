import {normalizeUnit} from '../../../utils/inventoryUnits';
import QuantityUnitFields from '../../../components/QuantityUnitFields';
import {normalizeQuantity,quantityInput} from '../../../utils/inventoryConversion';
import React, { useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, notification, DatePicker } from 'antd';
import { adjustmentPreview, adjustmentReasons, canAdjust, quantityLabel, stockQuantity } from '../inventoryModel.mjs';
import { registerStockAdjustment } from '../../../services/stockService';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';
import dayjs from 'dayjs';

export default function AdjustmentModal({product,enabled,canEdit,onClose,onSaved}){
  const [form]=Form.useForm(), [preview,setPreview]=useState(null), [saving,setSaving]=useState(false);
  const direction=Form.useWatch('direction',form), reason=Form.useWatch('reason',form);
  const busy=useRef(false),retry=useRef(null);
  const allowed=canAdjust(enabled,canEdit)&&product.enabled!==false;
  const prepare=values=>{
    try{
      const normalized=normalizeQuantity({quantity:values.quantity,inputUnit:values.unit,productUnit:product.unit});
      setPreview({...adjustmentPreview({...values,quantity:normalized.normalized_quantity},stockQuantity(product,enabled)),values,normalizedQuantity:normalized.normalized_quantity});
    }
    catch(e){notification.error({message:e.message});}
  };

  const confirm=async()=>{
    if(!allowed||busy.current||!preview)return;
    busy.current=true;setSaving(true);
    try{

      const payload = {
        direction: preview.values.direction,
        ...quantityInput(
          preview.values.quantity,
          preview.values.unit,
          product.unit
        ),
        reason: preview.reason,
        notes: preview.values.notes?.trim() || null,

        ...(preview.values.direction === 'in'
          ? {
              effective_date:
                preview.values.effective_date?.format('YYYY-MM-DD'),
            }
          : {}),
      };

      const fingerprint=JSON.stringify([product.id,payload]);
      if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,key:crypto.randomUUID()};
      const result=await registerStockAdjustment(product.id,payload,retry.current.key);
      onSaved(result.product);onClose();notification.success({message:'Stock ajustado correctamente.'});
    }catch(e){notification.error({message:getUserFriendlyError(e,'No se pudo ajustar el stock.')});}
    finally{busy.current=false;setSaving(false);}
  };
  return <Modal open title={`Ajustar stock · ${product.name}`} onCancel={()=>!saving&&onClose()} closable={!saving} maskClosable={!saving} footer={null}>
    {!allowed&&<Alert type="info" message="Los ajustes no están disponibles para este producto."/>}
    {preview?<>
    <Descriptions
      column={1}
      items={[
        [
          'Stock actual',
          quantityLabel(stockQuantity(product, enabled), product.unit),
        ],
        [
          'Ajuste',
          `${preview.values.direction === 'in' ? '+' : '−'}${quantityLabel(
            preview.normalizedQuantity,
            product.unit
          )}`,
        ],
        [
          'Stock resultante',
          quantityLabel(preview.after, product.unit),
        ],

        ...(preview.values.direction === 'in'
          ? [[
              'Disponible desde',
              preview.values.effective_date?.format('DD/MM/YYYY') || '—',
            ]]
          : []),

        ['Motivo', preview.reason],
        [
          'Observación',
          preview.values.notes || 'Sin observación',
        ],
      ].map(([label, children]) => ({
        key: label,
        label,
        children,
      }))}
    />
      <Space><Button disabled={saving} onClick={()=>setPreview(null)}>Volver</Button><Button type="primary" loading={saving} disabled={!allowed} onClick={confirm}>Confirmar ajuste</Button></Space>
    </>:<Form form={form} layout="vertical" onFinish={prepare} initialValues={{direction:'in',unit:normalizeUnit(product.unit), effective_date: dayjs()}}>
      <Form.Item name="direction" label="Tipo de ajuste">
        <Select
          onChange={(nextDirection) => {
            form.setFieldsValue({
              reason: undefined,
              reason_detail: undefined,
            });

            if (
              nextDirection === 'in' &&
              !form.getFieldValue('effective_date')
            ) {
              form.setFieldValue('effective_date', dayjs());
            }
          }}
          options={[
            { value: 'in', label: 'Sumar stock' },
            { value: 'out', label: 'Restar stock' },
          ]}
        />
      </Form.Item>
      
      <QuantityUnitFields
        quantityName="quantity"
        unitName="unit"
        baseUnit={product.unit}
        previewPrefix="Se registrarán"
        available={
          direction === 'out'
            ? stockQuantity(product, enabled)
            : undefined
        }
      />

      {direction === 'in' && (
        <Form.Item
          name="effective_date"
          label="Fecha efectiva del saldo"
          rules={[
            {
              required: true,
              message: 'Indicá desde qué fecha este stock estaba disponible.',
            },
          ]}
          extra="Indica desde qué fecha este stock estaba físicamente disponible. La fecha de registro en GrowSync se conserva por separado."
        >
          <DatePicker
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            disabledDate={(current) =>
              current && current.isAfter(dayjs(), 'day')
            }
          />
        </Form.Item>
      )}

      <Form.Item name="reason" label="Motivo" rules={[{required:true,message:'Seleccioná un motivo.'}]}><Select options={adjustmentReasons(direction).map(value=>({value,label:value}))}/></Form.Item>
      {reason==='Otro'&&<Form.Item name="reason_detail" label="Detalle del motivo" rules={[{required:true,whitespace:true,message:'Detallá el motivo.'}]}><Input maxLength={500}/></Form.Item>}
      <Form.Item name="notes" label="Observación"><Input.TextArea maxLength={2000}/></Form.Item>
      <Button type="primary" htmlType="submit" disabled={!allowed}>Revisar ajuste</Button>
    </Form>}
  </Modal>;
}

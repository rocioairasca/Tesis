import {unitLabel} from '../../../utils/inventoryUnits';
import React, { useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, InputNumber, Modal, Select, Space, notification } from 'antd';
import { adjustmentPreview, adjustmentReasons, canAdjust, quantityLabel, stockQuantity } from '../inventoryModel.mjs';
import { registerStockAdjustment } from '../../../services/stockService';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';

export default function AdjustmentModal({product,enabled,canEdit,onClose,onSaved}){
  const [form]=Form.useForm(), [preview,setPreview]=useState(null), [saving,setSaving]=useState(false);
  const direction=Form.useWatch('direction',form), reason=Form.useWatch('reason',form);
  const busy=useRef(false),retry=useRef(null);
  const allowed=canAdjust(enabled,canEdit)&&product.enabled!==false;
  const prepare=values=>{
    try{setPreview({...adjustmentPreview(values,stockQuantity(product,enabled)),values});}
    catch(e){notification.error({message:e.message});}
  };
  const confirm=async()=>{
    if(!allowed||busy.current||!preview)return;
    busy.current=true;setSaving(true);
    try{
      const payload={direction:preview.values.direction,quantity:preview.values.quantity,reason:preview.reason,notes:preview.values.notes?.trim()||null};
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
      <Descriptions column={1} items={[
        ['Stock actual',quantityLabel(stockQuantity(product,enabled),product.unit)],
        ['Ajuste',`${preview.values.direction==='in'?'+':'−'}${quantityLabel(preview.values.quantity,product.unit)}`],
        ['Stock resultante',quantityLabel(preview.after,product.unit)],['Motivo',preview.reason],['Observación',preview.values.notes||'Sin observación'],
      ].map(([label,children])=>({key:label,label,children}))}/>
      <Space><Button disabled={saving} onClick={()=>setPreview(null)}>Volver</Button><Button type="primary" loading={saving} disabled={!allowed} onClick={confirm}>Confirmar ajuste</Button></Space>
    </>:<Form form={form} layout="vertical" onFinish={prepare} initialValues={{direction:'in'}}>
      <Form.Item name="direction" label="Tipo de ajuste"><Select onChange={()=>form.setFieldsValue({reason:undefined,reason_detail:undefined})} options={[{value:'in',label:'Sumar stock'},{value:'out',label:'Restar stock'}]}/></Form.Item>
      <Form.Item name="quantity" label="Cantidad" rules={[{required:true,message:'Ingresá la cantidad.'}]}><InputNumber stringMode min="0.000001" precision={6} style={{width:'100%'}}/></Form.Item>
      <Form.Item label="Unidad"><Input readOnly value={unitLabel(product.unit)}/></Form.Item>
      <Form.Item name="reason" label="Motivo" rules={[{required:true,message:'Seleccioná un motivo.'}]}><Select options={adjustmentReasons(direction).map(value=>({value,label:value}))}/></Form.Item>
      {reason==='Otro'&&<Form.Item name="reason_detail" label="Detalle del motivo" rules={[{required:true,whitespace:true,message:'Detallá el motivo.'}]}><Input maxLength={500}/></Form.Item>}
      <Form.Item name="notes" label="Observación"><Input.TextArea maxLength={2000}/></Form.Item>
      <Button type="primary" htmlType="submit" disabled={!allowed}>Revisar ajuste</Button>
    </Form>}
  </Modal>;
}

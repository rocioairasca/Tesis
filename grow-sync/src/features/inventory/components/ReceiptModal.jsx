import {inventoryReceiptPayload} from '../inventoryReceiptModel.mjs';
import './ReceiptModal.css';
import {normalizeUnit} from '../../../utils/inventoryUnits';
import QuantityUnitFields from '../../../components/QuantityUnitFields';
import {normalizeQuantity,receiptQuantityPayload} from '../../../utils/inventoryConversion';
import React, { useRef, useState } from 'react';
import { Alert, Button, Collapse, DatePicker, Descriptions, Form, Input, Modal, Select, Space, notification } from 'antd';
import dayjs from 'dayjs';
import esES from 'antd/locale/es_ES';
import api from '../../../services/apiClient';
import { registerStockReceipt, registerInventoryReceipt } from '../../../services/stockService';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';
import { canReceipt, receivedLabel, expirationLabel, receiptExpirationPayload, quantityLabel, receiptPreview, stockQuantity, validateReceipt } from '../inventoryModel.mjs';

export function ReceiptExpirationField({ name = 'expiration_period', components } = {}) {
  return <Form.Item name={name} label="Vencimiento">
    <DatePicker picker="month" format="MM/YYYY" components={components} placeholder="MM/AAAA" locale={(esES.default ?? esES).DatePicker} allowClear
      minDate={dayjs('2000-01-01')} maxDate={dayjs('2100-12-31')} style={{ width: '100%' }} />
  </Form.Item>;
}

function SingleReceiptModal({ products, product, enabled, canEdit, canCreate, onCreate, onClose, onSaved }) {
  const [form] = Form.useForm();
  const productId = Form.useWatch('product_id', form);
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
          ...receiptExpirationPayload(v.expiration_period), supplier: v.supplier || null, reference: v.reference || null, notes: v.notes || null };
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
    </> : <Form form={form} layout="vertical" onFinish={prepare} initialValues={{ product_id: product?.id, unit:normalizeUnit(product?.unit) }}>
      <Form.Item name="product_id" label="Producto" rules={[{ required: true, message: 'Seleccioná un producto.' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Buscar producto..." options={products.map(p => ({ value: p.id, label: p.name }))}
          onChange={id=>form.setFieldsValue({unit:normalizeUnit(products.find(p=>p.id===id)?.unit)})} />
      </Form.Item>
      {canCreate && <Button type="link" style={{ paddingLeft: 0 }} onClick={onCreate}>Crear nuevo producto</Button>}
      <QuantityUnitFields quantityName="quantity" unitName="unit" baseUnit={selected?.unit} allowConversion={enabled} previewPrefix="Se registrarán" />
      {enabled && <>
        <Form.Item name="received_date" label="Fecha de ingreso" rules={[{ required: true, message: 'Ingresá la fecha de ingreso.' }]}><Input type="date" /></Form.Item>
        <ReceiptExpirationField />
        <Collapse items={[{ key: 'purchase', label: 'Datos del ingreso', forceRender: true, children: <>
          <Form.Item name="supplier" label="Proveedor"><Input maxLength={500} /></Form.Item>
          <Form.Item name="reference" label="N° factura / comprobante"><Input maxLength={500} /></Form.Item>
          <Form.Item name="notes" label="Observaciones"><Input.TextArea maxLength={2000} /></Form.Item>
        </> }]} />
      </>}
      {enabled && <Alert type="info" message="El costo se carga después del ingreso, desde Ver partida → Valorizar. El stock puede utilizarse mientras esté pendiente." />}
      <Button type="primary" htmlType="submit" disabled={!canEdit} block style={{ marginTop: 20 }}>Revisar ingreso</Button>
    </Form>}
  </Modal>;
}

// Keep the legacy non-batch branch intact. Inventory V1 uses one receipt for all lines.
export default function ReceiptModal(props) {
  return props.enabled ? <MultiReceiptModal {...props} /> : <SingleReceiptModal {...props} />;
}
function MultiReceiptModal({products,product,canEdit,canCreate,onCreate,onClose,onSaved}) {
  const [form]=Form.useForm();
  const items=Form.useWatch('items',form)||[];
  const [preview,setPreview]=useState(null),[saving,setSaving]=useState(false);
  const retry=useRef(null),busy=useRef(false);
  const prepare=values=>{
    try {setPreview(inventoryReceiptPayload(values,products));}
    catch(e){notification.error({message:e.message});}
  };
  const confirm=async()=>{
    if(busy.current||!canEdit||!preview)return;
    busy.current=true;setSaving(true);
    try {
      const fingerprint=JSON.stringify(preview);
      if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,key:crypto.randomUUID()};
      await registerInventoryReceipt(preview,retry.current.key);
      notification.success({message:'Ingreso registrado'});
      onSaved();onClose();
    } catch(e){notification.error({message:getUserFriendlyError(e,'No se pudo registrar el ingreso.')});}
    finally{busy.current=false;setSaving(false);}
  };
  return <Modal open title="Registrar ingreso" width={800} footer={null} onCancel={()=>!saving&&onClose()} maskClosable={!saving} closable={!saving}>
    {preview ? <>
      <Descriptions column={1} items={[
        {key:'date',label:'Fecha de ingreso',children:receivedLabel(preview.received_date)},
        {key:'supplier',label:'Proveedor',children:preview.supplier||'No registrado'},
        {key:'document',label:'Comprobante',children:[preview.document_type,preview.reference].filter(Boolean).join(' · ')||'No registrado'},
        {key:'notes',label:'Notas',children:preview.notes||'Sin notas'},
      ]}/>
      {preview.items.map(item=><div key={item.product_id} className="inventory-receipt-line">
        <strong>{products.find(p=>p.id===item.product_id)?.name}</strong>
        <div>{quantityLabel(item.quantity,item.unit)} · {expirationLabel(item)}</div>
        <div>Valorización pendiente</div>
      </div>)}
      <Space wrap><Button disabled={saving} onClick={()=>setPreview(null)}>Volver</Button>
        <Button type="primary" loading={saving} disabled={!canEdit} onClick={confirm}>Confirmar ingreso</Button></Space>
    </> : <Form form={form} layout="vertical" onFinish={prepare} initialValues={{items:[{product_id:product?.id,unit:normalizeUnit(product?.unit)}]}}>
      <div className="inventory-receipt-common">
        <Form.Item name="received_date" label="Fecha de ingreso" rules={[{required:true,message:'Ingresá la fecha de ingreso.'}]}><Input type="date" /></Form.Item>
        <Form.Item name="supplier" label="Proveedor"><Input maxLength={500}/></Form.Item>
        <Form.Item name="document_type" label="Tipo de comprobante"><Select allowClear options={['Remito','Factura','Otro'].map(value=>({value,label:value}))}/></Form.Item>
        <Form.Item name="reference" label="Número de comprobante"><Input maxLength={500}/></Form.Item>
      </div>
      <Form.Item name="notes" label="Notas"><Input.TextArea maxLength={2000} autoSize={{minRows:2,maxRows:4}}/></Form.Item>
      <h3>Productos</h3>
      <Form.List name="items">{(fields,{add,remove})=><>
        {fields.map(field=>{
          const selected=products.find(p=>p.id===items[field.name]?.product_id);
          return <div className="inventory-receipt-line" key={field.key} role="group" aria-label={`Producto ${field.name+1}`}>
            <div className="inventory-receipt-line-heading"><strong>Producto {field.name+1}</strong>
              <Button type="text" disabled={fields.length===1} onClick={()=>remove(field.name)} aria-label={`Eliminar producto ${field.name+1}`}>Eliminar</Button></div>
            <Form.Item name={[field.name,'product_id']} label="Producto" rules={[{required:true,message:'Seleccioná un producto.'}]}>
              <Select showSearch optionFilterProp="label" placeholder="Buscar producto..." options={products.filter(p=>p.enabled!==false).map(p=>({value:p.id,label:p.name,disabled:items.some((i,index)=>index!==field.name&&i?.product_id===p.id)}))}
                onChange={id=>form.setFieldValue(['items',field.name,'unit'],normalizeUnit(products.find(p=>p.id===id)?.unit))}/>
            </Form.Item>
            <div className="inventory-receipt-item-fields">
              <QuantityUnitFields quantityName={[field.name,'quantity']} unitName={[field.name,'unit']} watchPrefix={['items']} baseUnit={selected?.unit} allowConversion={false}/>
              <ReceiptExpirationField name={[field.name,'expiration_period']}/>
            </div>
          </div>;
        })}
        <Button onClick={()=>add({})} disabled={fields.length>=100}>Agregar producto</Button>
      </>}</Form.List>
      {canCreate&&<Button type="link" onClick={onCreate}>Crear nuevo producto</Button>}
      <Alert className="inventory-receipt-cost" type="info" message="El costo se carga después del ingreso, desde Ver partida → Valorizar. El stock puede utilizarse mientras esté pendiente."/>
      <Button className="inventory-receipt-submit" type="primary" htmlType="submit" disabled={!canEdit} block>Revisar ingreso</Button>
    </Form>}
  </Modal>;
}

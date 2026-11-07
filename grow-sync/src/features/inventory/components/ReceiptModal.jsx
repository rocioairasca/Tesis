import {inventoryReceiptPayload} from '../inventoryReceiptModel.mjs';
import './ReceiptModal.css';
import {formatNumber} from '../../../utils/numberFormat';
import {normalizeUnit,unitLabel} from '../../../utils/inventoryUnits';
import QuantityUnitFields from '../../../components/QuantityUnitFields';
import {normalizeQuantity,receiptQuantityPayload} from '../../../utils/inventoryConversion';
import React, { useRef, useState } from 'react';
import { Alert, Button, Collapse, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Select, Space, notification } from 'antd';
import dayjs from 'dayjs';
import esES from 'antd/locale/es_ES';
import api from '../../../services/apiClient';
import { registerStockReceipt, registerInventoryReceipt } from '../../../services/stockService';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';
import { canReceipt, expirationLabel, receiptExpirationPayload, quantityLabel, receiptPreview, stockQuantity, validateReceipt } from '../inventoryModel.mjs';

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
  const [form]=Form.useForm(),[entryForm]=Form.useForm();
  const [items,setItems]=useState([]),[editingId,setEditingId]=useState(null),[saving,setSaving]=useState(false);
  const selectedId=Form.useWatch('product_id',entryForm);
  const selected=products.find(p=>p.id===selectedId);
  const retry=useRef(null),busy=useRef(false),adding=useRef(false),productInput=useRef(null),editor=useRef(null);
  const productOpen=useRef(false),expirationOpen=useRef(false);
  const clearEntry=()=>{
    entryForm.resetFields();
    entryForm.setFieldsValue({product_id:undefined,quantity:undefined,expiration_period:null});
    setEditingId(null);
    requestAnimationFrame(()=>productInput.current?.focus());
  };
  const addItem=async()=>{
    if(adding.current||saving||!canEdit)return;
    adding.current=true;
    try {
      const values=await entryForm.validateFields();
      receiptExpirationPayload(values.expiration_period);
      if(editingId===null&&items.length>=100)throw new Error('Agregá hasta 100 productos.');
      if(items.some(i=>i.product_id===values.product_id&&i.product_id!==editingId))throw new Error('No se puede repetir un producto en el mismo ingreso.');
      setItems(previous=>editingId===null?[...previous,values]:previous.map(i=>i.product_id===editingId?values:i));
      clearEntry();
    } catch(e){if(!e.errorFields)notification.error({message:e.message});}
    finally{adding.current=false;}
  };
  const editItem=item=>{
    entryForm.resetFields();entryForm.setFieldsValue(item);setEditingId(item.product_id);
    editor.current?.scrollIntoView({block:'nearest'});productInput.current?.focus();
  };
  const removeItem=item=>{
    setItems(previous=>previous.filter(i=>i.product_id!==item.product_id));
    if(editingId===item.product_id)clearEntry();
  };
  const register=async values=>{
    if(busy.current||!canEdit)return;
    const draft=entryForm.getFieldsValue();
    if(editingId!==null||draft.product_id||draft.quantity!=null&&draft.quantity!==''||draft.expiration_period){
      notification.error({message:editingId!==null?'Guardá o cancelá la edición antes de registrar el ingreso.':'Agregá el producto a la lista antes de registrar el ingreso.'});
      return;
    }
    busy.current=true;setSaving(true);
    try {
      const payload=inventoryReceiptPayload({...values,items},products);
      const fingerprint=JSON.stringify(payload);
      if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,key:crypto.randomUUID()};
      await registerInventoryReceipt(payload,retry.current.key);
      notification.success({message:'Ingreso registrado'});
      onSaved();onClose();
    } catch(e){notification.error({message:getUserFriendlyError(e,'No se pudo registrar el ingreso.')});}
    finally{busy.current=false;setSaving(false);}
  };
  return <Modal open title="Registrar ingreso" width={800} footer={null} onCancel={()=>!saving&&onClose()} maskClosable={!saving} closable={!saving}>
    <Form form={form} layout="vertical" onFinish={register} disabled={saving}>
      <div className="inventory-receipt-common">
        <Form.Item name="received_date" label="Fecha de ingreso" rules={[{required:true,message:'Ingresá la fecha de ingreso.'}]}><Input type="date" /></Form.Item>
        <Form.Item name="supplier" label="Proveedor"><Input maxLength={500}/></Form.Item>
        <Form.Item name="document_type" label="Tipo de comprobante"><Select allowClear options={['Remito','Factura','Otro'].map(value=>({value,label:value}))}/></Form.Item>
        <Form.Item name="reference" label="Número de comprobante"><Input maxLength={500}/></Form.Item>
      </div>
      <Form.Item name="notes" label="Notas"><Input.TextArea maxLength={2000} autoSize={{minRows:2,maxRows:4}}/></Form.Item>
      <div className="inventory-receipt-heading"><h3>Productos</h3>
        {canCreate&&<Button type="link" onClick={onCreate}>Crear nuevo producto</Button>}
      </div>
      <Form form={entryForm} component={false} layout="vertical" disabled={saving} initialValues={{product_id:product?.id}}>
        <div ref={editor} className="inventory-receipt-entry" onKeyDown={event=>{
          if(event.key!=='Enter'||event.nativeEvent.isComposing)return;
          event.preventDefault();
          if(!productOpen.current&&!expirationOpen.current)addItem();
        }}>
          <div className="inventory-receipt-entry-fields">
            <Form.Item name="product_id" label="Producto" className="inventory-receipt-product" rules={[
              {required:true,message:'Seleccioná un producto.'},
              {validator:(_,id)=>items.some(i=>i.product_id===id&&i.product_id!==editingId)?Promise.reject(new Error('Este producto ya está en la lista.')):Promise.resolve()},
            ]}>
              <Select ref={productInput} showSearch allowClear optionFilterProp="label" placeholder="Buscar producto..." onOpenChange={open=>{productOpen.current=open;}}
                options={products.filter(p=>p.enabled!==false).map(p=>({value:p.id,label:p.name,disabled:items.some(i=>i.product_id===p.id&&i.product_id!==editingId)}))}/>
            </Form.Item>
            <Form.Item name="quantity" label="Cantidad" rules={[{required:true,message:'Ingresá la cantidad.'},{validator:(_,quantity)=>{
              try {normalizeQuantity({quantity,inputUnit:normalizeUnit(selected?.unit),productUnit:selected?.unit});return Promise.resolve();}
              catch(e){return Promise.reject(new Error(e.message));}
            }}]}>
              <InputNumber stringMode changeOnBlur={false} decimalSeparator=","/>
            </Form.Item>
            <Form.Item label="Unidad"><Input aria-label="Unidad" readOnly value={normalizeUnit(selected?.unit)||''}/></Form.Item>
            <Form.Item name="expiration_period" label="Vencimiento" className="inventory-receipt-expiration">
              <DatePicker picker="month" format="MM/YYYY" placeholder="MM/AAAA" locale={(esES.default??esES).DatePicker} allowClear
                minDate={dayjs('2000-01-01')} maxDate={dayjs('2100-12-31')} onOpenChange={open=>{expirationOpen.current=open;}}/>
            </Form.Item>
          </div>
          <div className="inventory-receipt-entry-actions">
            {editingId!==null&&<Button type="link" onClick={clearEntry}>Cancelar edición</Button>}
            <Button type="primary" className="inventory-receipt-confirm" disabled={!canEdit||editingId===null&&items.length>=100} onClick={addItem}>{editingId===null?'Agregar':'Guardar cambios'}</Button>
          </div>
        </div>
      </Form>
      <div className="inventory-receipt-list" role="table" aria-label="Productos del ingreso">
        <div className="inventory-receipt-list-header" role="row">
          {['Producto','Cantidad','Unidad','Vencimiento','Acciones'].map(label=><div role="columnheader" key={label}>{label}</div>)}
        </div>
        {items.map(item=>{
          const p=products.find(p=>p.id===item.product_id),unit=normalizeUnit(p?.unit);
          const expiry=expirationLabel(receiptExpirationPayload(item.expiration_period));
          return <div className="inventory-receipt-list-row" role="row" key={item.product_id} data-product-id={item.product_id}>
            <div role="cell" className="inventory-receipt-list-name" title={p?.name}>{p?.name}</div>
            <div role="cell" className="inventory-receipt-desktop">{formatNumber(item.quantity,6)}</div>
            <div role="cell" className="inventory-receipt-desktop">{unitLabel(unit)}</div>
            <div role="cell" className="inventory-receipt-desktop">{expiry}</div>
            <div role="cell" className="inventory-receipt-mobile">{quantityLabel(item.quantity,unit)} · {expiry}</div>
            <div role="cell" className="inventory-receipt-row-actions">
              <Button type="link" onClick={()=>editItem(item)}>Editar</Button>
              <Button type="link" danger onClick={()=>removeItem(item)}>Eliminar</Button>
            </div>
          </div>;
        })}
        {!items.length&&<div className="inventory-receipt-empty">No hay productos en la lista.</div>}
      </div>
      <Alert className="inventory-receipt-cost" type="info" message="El costo se carga después del ingreso, desde Ver partida → Valorizar. El stock puede utilizarse mientras esté pendiente."/>
      <div className="inventory-receipt-footer">
        <Button disabled={saving} onClick={onClose}>Cancelar</Button>
        <Button className="inventory-receipt-confirm" type="primary" htmlType="submit" disabled={!canEdit} loading={saving}>Registrar ingreso</Button>
      </div>
    </Form>
  </Modal>;
}

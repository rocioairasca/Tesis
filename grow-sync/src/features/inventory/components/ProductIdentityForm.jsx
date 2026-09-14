import {unitOptions,unitLabel} from '../../../utils/inventoryUnits';
import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Select } from 'antd';
import { categories, normalizeProductName } from '../inventoryModel.mjs';
import { findSimilarProducts } from '../../../services/productSimilarity';
import SimilarProducts from './SimilarProducts';

export default function ProductIdentityForm({ form, onFinish, saving, editing, enabled, canEdit, canViewDisabled, onUse, onReceipt }) {
  const selectedUnit=Form.useWatch('unit',form);
  const unitLocked=!!editing && editing.unit_locked !== false;
  const name=Form.useWatch('name',form),normalized=normalizeProductName(name);
  const [search,setSearch]=useState({name:null,matches:[],error:false}),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(editing||!normalized)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      findSimilarProducts(normalized,canViewDisabled,controller.signal).then(matches=>{
        if(!controller.signal.aborted)setSearch({name:normalized,matches,error:false});
      }).catch(()=>{if(!controller.signal.aborted)setSearch({name:normalized,matches:[],error:true});});
    },400);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[normalized,editing,canViewDisabled,attempt]);
  const checked=editing||search.name===normalized&&!search.error;
  const matches=search.name===normalized?search.matches:[];
  const exact=!editing&&matches.some(p=>p.enabled!==false&&normalizeProductName(p.name)===normalized);
  return <Form form={form} layout="vertical" onFinish={values=>{if(checked&&!saving)onFinish(values);}}>
    <Form.Item name="name" label="Nombre comercial" rules={[{ required: true, whitespace: true, message: 'Ingresá el nombre comercial.' }]}><Input /></Form.Item>
    <Form.Item name="category" label="Categoría" rules={[{ required: true, message: 'Seleccioná la categoría.' }]}><Select options={categories} /></Form.Item>
    <Form.Item name="unit" label="Unidad base" extra={unitLocked ? (editing.unit_history_verified === false ? 'No se pudo verificar si la unidad puede modificarse. Volvé a cargar el inventario.' : 'La unidad base no puede modificarse porque este producto ya posee historial de stock.') : undefined} rules={[{ required: true, message: 'Seleccioná la unidad.' }]}><Select disabled={unitLocked} options={unitOptions} /></Form.Item>
    <Form.Item name="active_ingredient" label="Principio activo / composición"><Input maxLength={500} /></Form.Item>
    <Form.Item name="formulation" label="Concentración / formulación"><Input maxLength={500} /></Form.Item>
    <Form.Item name="manufacturer" label="Marca / fabricante"><Input maxLength={500} /></Form.Item>
    <Form.Item name="minimum_stock" label="Stock mínimo" extra={selectedUnit ? `Si no lo indicás, se conserva el umbral heredado de 5 ${unitLabel(selectedUnit)}. Configuralo según este producto.` : undefined}><InputNumber addonAfter={selectedUnit ? unitLabel(selectedUnit) : undefined} min={0} precision={6} style={{ width: '100%' }} /></Form.Item>
    <Form.Item name="notes" label="Observaciones"><Input.TextArea maxLength={2000} rows={3} /></Form.Item>
    {!editing&&<SimilarProducts matches={matches} name={name} canEdit={canEdit} onUse={onUse} onReceipt={onReceipt}/>}
    {!editing&&search.name===normalized&&search.error&&<Alert type="warning" message="No se pudieron buscar productos parecidos." action={<Button onClick={()=>{setSearch({name:null,matches:[],error:false});setAttempt(a=>a+1);}}>Reintentar</Button>}/>}
    <Button type={exact?'default':'primary'} htmlType="submit" disabled={!checked} loading={saving} block>{editing ? 'Guardar cambios' : exact?'Crear de todos modos':normalized&&!checked?'Buscando productos parecidos…':'Crear producto'}</Button>
  </Form>;
}

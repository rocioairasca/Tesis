import {unitLabel} from '../../../utils/inventoryUnits';
import React from 'react';
import { Alert, Button, Card, Space, Tag } from 'antd';
import { categoryLabel, normalizeProductName } from '../inventoryModel.mjs';

export default function SimilarProducts({matches,name,canEdit,onUse,onReceipt}){
  const exact=matches.some(p=>p.enabled!==false&&normalizeProductName(p.name)===normalizeProductName(name));
  if(!matches.length)return null;
  return <Alert type="warning" showIcon message={exact?'Ya existe un producto con este nombre.':'Encontramos productos parecidos'} style={{marginBottom:16}} description={<>
    <p>Revisá la unidad, formulación y fabricante antes de crear otro producto.</p>
    <Space direction="vertical" style={{width:'100%'}}>{matches.map(p=><Card size="small" key={p.id}>
      <strong>{p.name}</strong> <Tag>{p.enabled===false?'Deshabilitado':'Habilitado'}</Tag>
      <p>{categoryLabel(p.category)} · {unitLabel(p.unit)}{p.formulation?` · ${p.formulation}`:''}{p.manufacturer?` · ${p.manufacturer}`:''}</p>
      <Space wrap><Button onClick={()=>onUse(p)}>{p.enabled===false?'Ver producto':exact?'Ver producto existente':'Usar este producto'}</Button>
        {canEdit&&p.enabled!==false&&<Button onClick={()=>onReceipt(p)}>Registrar ingreso</Button>}</Space>
    </Card>)}</Space>
  </>}/>;
}

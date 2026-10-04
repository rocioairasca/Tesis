import React from 'react';
import {Form,InputNumber} from 'antd';
import {partialAreaAllowed} from '../effectiveArea.mjs';
export default function EffectiveAreaFields({selections,activity,completed=false}) {
  const editable=partialAreaAllowed(activity) && !completed;
  return <div style={{minWidth:0}}>
    {selections.map(item=><div key={item.key} style={{marginBottom:12}}>
      <div style={{overflowWrap:'anywhere'}}>{item.name}</div>
      <div style={{fontSize:12,color:'#595959'}}>Superficie: {Number(item.area_ha).toLocaleString('es-AR',{maximumFractionDigits:4})} ha</div>
      <Form.Item name={['effective_areas',item.key]} label="Superficie a trabajar" initialValue={item.effective_area_ha ?? item.area_ha}
        rules={[{required:true,message:'Indicá la superficie a trabajar.'},{validator:(_,v)=>Number(v)>0 && Number(v)<=Number(item.area_ha) ? Promise.resolve() : Promise.reject(new Error('Indicá una superficie mayor que cero, sin superar la superficie seleccionada.'))}]}>
        <InputNumber disabled={!editable} min={0.0001} max={Number(item.area_ha)} precision={4} decimalSeparator="," parser={v=>v?.replace(',', '.')} suffix="ha" style={{width:'100%'}} />
      </Form.Item>
    </div>)}
    {editable && selections.length>0 && <p style={{fontSize:12,color:'#595959'}}>Podés indicar una superficie menor sin crear una división.</p>}
    {activity==='siembra' && !completed && selections.length>0 && <p style={{fontSize:12,color:'#595959'}}>La siembra utiliza toda la superficie seleccionada. Podés seleccionar un sublote existente.</p>}
  </div>;
}

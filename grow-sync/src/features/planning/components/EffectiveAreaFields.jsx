import React from 'react';
import {Form,InputNumber,Select} from 'antd';
import {partialAreaAllowed} from '../effectiveArea.mjs';
const number=v=>Number(v||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:4});
export default function EffectiveAreaFields({selections,activity,completed=false}) {
 const form=Form.useFormInstance(),modes=Form.useWatch('selection_modes',form)||{},areas=Form.useWatch('effective_areas',form)||{};
 return <div className="planning-selection-areas">
  {selections.map(item=>{
   const sub=Boolean(item.sub_lot_id),initial=item.selection_mode||(sub?'sub_lot':Number(item.effective_area_ha)<Number(item.area_ha)?'manual_portion':'full_lot');
   const mode=modes[item.key]||initial,partial=mode==='manual_portion'||sub;
   const area=areas[item.key]??item.effective_area_ha??item.area_ha;
   return <div key={item.key} className="planning-selection-area">
    <strong>{item.name}</strong>
    <Form.Item name={['selection_modes',item.key]} label="Tipo de selección" initialValue={initial}>
     <Select disabled={completed||sub} options={sub?[{value:'sub_lot',label:'Sublote existente'}]:[
      {value:'full_lot',label:'Lote completo'},{value:'manual_portion',label:'Porción del lote',disabled:!partialAreaAllowed(activity)}]}
      onChange={mode=>{if(mode==='full_lot')form.setFieldValue(['effective_areas',item.key],item.area_ha);}}/>
    </Form.Item>
    <Form.Item name={['effective_areas',item.key]} label="Superficie a trabajar" initialValue={item.effective_area_ha??item.area_ha}
     rules={[{required:true,message:'Indicá la superficie a trabajar.'},{validator:(_,v)=>/^\d+(?:[.,]\d{1,4})?$/.test(String(v))&&Number(v)>0&&Number(v)<=Number(item.area_ha)?Promise.resolve():Promise.reject(Error('Indicá una superficie mayor que cero, sin superar la superficie seleccionada.'))}]}>
     <InputNumber disabled={completed||!partial||!partialAreaAllowed(activity)} decimalSeparator="," parser={v=>v?.replace(',','.')} suffix="ha"/>
    </Form.Item>
    <div className="planning-selection-summary">Superficie {sub?'del sublote':'del lote'}: {number(item.area_ha)} ha<br/>
     Superficie seleccionada: {number(area)} ha ({(Number(area)/Number(item.area_ha)*100||0).toLocaleString('es-AR',{maximumFractionDigits:1})}%)</div>
   </div>;
  })}
  {!partialAreaAllowed(activity)&&selections.length>0&&<p>Esta actividad utiliza toda la superficie seleccionada. Podés seleccionar un sublote existente.</p>}
 </div>;
}

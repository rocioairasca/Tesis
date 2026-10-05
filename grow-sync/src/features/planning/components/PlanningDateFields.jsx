import React from 'react';
import {DatePicker,Form,Segmented} from 'antd';
import {changeDuration,validatedDateRange} from '../planningFormFlow.mjs';
export function PlanningDateInput({value=[],onChange,mode='day',disabled=false}) {
 const [start,end]=value || [];
 if(mode==='day')return <DatePicker aria-label="Fecha" value={start} disabled={disabled} format="DD/MM/YYYY" style={{width:'100%'}} onChange={date=>onChange?.([date,date])} />;
 return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,minWidth:0}}>
   <label>Desde<DatePicker aria-label="Desde" value={start} disabled={disabled} format="DD/MM/YYYY" style={{width:'100%'}} onChange={date=>onChange?.([date,end])} /></label>
   <label>Hasta<DatePicker aria-label="Hasta" value={end} disabled={disabled} format="DD/MM/YYYY" style={{width:'100%'}} onChange={date=>onChange?.([start,date])} /></label>
 </div>;
}
export default function PlanningDateFields({form,disabled=false,onRangeChange}) {
 const mode=Form.useWatch('duration_mode',form) || 'day';
 return <>
  <Form.Item name="duration_mode" label="Duración" initialValue="day">
   <Segmented disabled={disabled} block options={[{value:'day',label:'Un día'},{value:'period',label:'Período'}]}
     onChange={next=>{const range=changeDuration(form.getFieldValue('date_range'),next);form.setFieldValue('date_range',range);onRangeChange?.(range);form.validateFields(['date_range']).catch(()=>{});}} />
  </Form.Item>
  <Form.Item name="date_range" label={mode==='day'?'Fecha':null} rules={disabled?[]:[{validator:(_,value)=>{try{validatedDateRange(value,mode);return Promise.resolve();}catch(e){return Promise.reject(e);}}}]}>
   <PlanningDateInput mode={mode} disabled={disabled} onChange={onRangeChange} />
  </Form.Item>
 </>;
}

import React from 'react';
import {Button,DatePicker,Form,Input,Select} from 'antd';
import {emptySample,RESULT_STATUSES} from './soilAnalysisModel.mjs';
export default function SoilAnalysisForm({form,lots,editing,file,onFileChange,onFinish,lotId,subLotId,busy=false}){
 const watchedSamples=Form.useWatch('samples',form)||[];
 return <Form disabled={busy} form={form} layout="vertical" onFinish={onFinish}>
  <h3>Datos del informe</h3>
  {editing?<p>PDF original: {editing.original_filename}. El archivo no se reemplaza al editar.</p>:<label className="soil-file-field">PDF original (máximo 10 MB)<input type="file" accept="application/pdf,.pdf" aria-label="PDF original" onChange={e=>onFileChange(e.target.files?.[0]??null)} />{file&&<small>{file.name}</small>}</label>}
  <div className="soil-form-grid"><Form.Item name="report_number" label="Número de informe"><Input maxLength={200} /></Form.Item>
  <Form.Item name="laboratory" label="Laboratorio"><Input maxLength={200} /></Form.Item>
  <Form.Item name="received_date" label="Fecha de recepción"><DatePicker format="DD/MM/YYYY" /></Form.Item></div>
  <Form.Item name="notes" label="Notas del informe"><Input.TextArea /></Form.Item>
  <Form.List name="samples" rules={[{validator:(_,value)=>value?.length?Promise.resolve():Promise.reject(new Error('Agregá al menos una muestra.'))}]}>
   {(samples,{add,remove},meta)=><>
    {samples.map(sample=>{
     const selectedLot=watchedSamples[sample.name]?.lot_id??form.getFieldValue(['samples',sample.name,'lot_id']),options=lots.find(l=>l.id===selectedLot)?.sub_lots||[];
     return <section className="soil-sample-form" key={sample.key} aria-label={'Muestra '+(sample.name+1)}>
      <h3>Muestra {sample.name+1}</h3>
      <div className="soil-form-grid">
       <Form.Item name={[sample.name,'lot_id']} label="Lote" rules={[{required:true,message:'Seleccioná el lote.'}]}><Select aria-label={'Lote de muestra '+(sample.name+1)} options={lots.map(l=>({value:l.id,label:l.name}))} onChange={()=>form.setFieldValue(['samples',sample.name,'sub_lot_id'],null)} /></Form.Item>
       <Form.Item name={[sample.name,'sub_lot_id']} label="División (opcional)"><Select aria-label={'División de muestra '+(sample.name+1)} allowClear placeholder="Lote completo" options={options.map(s=>({value:s.id,label:s.name+(s.enabled===false?' (anterior)':'')}))} /></Form.Item>
       <Form.Item name={[sample.name,'sample_date']} label="Fecha de muestreo" rules={[{required:true,message:'Ingresá la fecha de muestreo.'}]}><DatePicker format="DD/MM/YYYY" /></Form.Item>
       <Form.Item name={[sample.name,'depth_from_cm']} label="Profundidad desde (cm)"><Input inputMode="decimal" /></Form.Item>
       <Form.Item name={[sample.name,'depth_to_cm']} label="Profundidad hasta (cm)"><Input inputMode="decimal" /></Form.Item>
       <Form.Item name={[sample.name,'sample_name']} label="Nombre de muestra"><Input /></Form.Item>
       <Form.Item name={[sample.name,'position_description']} label="Posición de la muestra"><Input /></Form.Item>
       <Form.Item name={[sample.name,'sampled_by']} label="Muestreado / enviado por"><Input /></Form.Item>
      </div>
      <Form.Item name={[sample.name,'notes']} label="Notas de la muestra"><Input.TextArea /></Form.Item>
      <h4>Resultados</h4>
      <Form.List name={[sample.name,'results']} rules={[{validator:(_,v)=>v?.length?Promise.resolve():Promise.reject(new Error('Agregá al menos un resultado.'))}]}>
       {(results,operations,resultMeta)=><>
        {results.map(result=><div className="soil-result-form" key={result.key}>
         <Form.Item name={[result.name,'parameter_name']} label="Parámetro" rules={[{required:true,message:'Ingresá el parámetro.'}]}><Input maxLength={200} /></Form.Item>
         <Form.Item name={[result.name,'method']} label="Método"><Input /></Form.Item>
         <Form.Item name={[result.name,'unit']} label="Unidad"><Input /></Form.Item>
         <Form.Item name={[result.name,'raw_value']} label="Resultado original" rules={[{required:true,whitespace:true,message:'Ingresá el resultado tal como figura en el informe.'}]}><Input /></Form.Item>
         <Form.Item name={[result.name,'result_status']} label="Estado del resultado"><Select options={RESULT_STATUSES} onChange={value=>{if(value==='not_requested')form.setFieldValue(['samples',sample.name,'results',result.name,'numeric_value'],null);}} /></Form.Item>
         <Form.Item name={[result.name,'numeric_value']} label="Valor numérico (opcional)" extra="Completalo solo si está indicado como número en el informe."><Input inputMode="decimal" disabled={busy||watchedSamples[sample.name]?.results?.[result.name]?.result_status==='not_requested'} /></Form.Item>
         <Button danger onClick={()=>operations.remove(result.name)}>Quitar parámetro</Button>
        </div>)}
        <Form.ErrorList errors={resultMeta.errors} /><Button onClick={()=>operations.add({result_status:'measured'})} disabled={results.length>=100}>Agregar parámetro</Button>
       </>}
      </Form.List>
      <Button danger onClick={()=>remove(sample.name)}>Quitar muestra</Button>
     </section>;
    })}
    <Form.ErrorList errors={meta.errors} /><Button onClick={()=>add(emptySample(lotId,subLotId))} disabled={samples.length>=20}>Agregar muestra</Button>
   </>}
  </Form.List>
 </Form>;
}

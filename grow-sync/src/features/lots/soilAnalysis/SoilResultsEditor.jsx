import React from 'react';
import {Button,Form,Input,Select} from 'antd';
import {DeleteOutlined,PlusOutlined} from '../../../components/AppIcons';
import useIsMobile from '../../../hooks/useIsMobile';
import {RESULT_STATUSES} from './soilAnalysisModel.mjs';

export default function SoilResultsEditor({sample,form,values=[],busy}){
 const mobile=useIsMobile();
 const cells=result=>[
  <Form.Item key="parameter" name={[result.name,'parameter_name']} label="Parámetro" rules={[{required:true,message:'Ingresá el parámetro.'}]}><Input maxLength={200}/></Form.Item>,
  <Form.Item key="method" name={[result.name,'method']} label="Método"><Input/></Form.Item>,
  <Form.Item key="unit" name={[result.name,'unit']} label="Unidad"><Input/></Form.Item>,
  <Form.Item key="raw" name={[result.name,'raw_value']} label="Resultado original" rules={[{required:true,whitespace:true,message:'Ingresá el resultado tal como figura en el informe.'}]}><Input/></Form.Item>,
  <Form.Item key="status" name={[result.name,'result_status']} label="Estado del resultado"><Select options={RESULT_STATUSES} onChange={value=>{if(value==='not_requested')form.setFieldValue(['samples',sample.name,'results',result.name,'numeric_value'],null);}}/></Form.Item>,
  <Form.Item key="numeric" name={[result.name,'numeric_value']} label="Valor numérico (opcional)"><Input inputMode="decimal" disabled={busy||values[result.name]?.result_status==='not_requested'}/></Form.Item>,
 ];
 return <Form.List name={[sample.name,'results']} rules={[{validator:(_,v)=>v?.length?Promise.resolve():Promise.reject(new Error('Agregá al menos un resultado.'))}]}>
  {(results,operations,meta)=>{
   const remove=result=><Button type="text" danger size="small" icon={<DeleteOutlined/>} aria-label={'Eliminar resultado '+(result.name+1)+' de muestra '+(sample.name+1)} onClick={()=>operations.remove(result.name)}/>;
   return <>
    {mobile?results.map(result=><details className="soil-result-card" key={result.key} open={results.length===1?true:undefined}>
     <summary>{values[result.name]?.parameter_name||'Resultado '+(result.name+1)}{values[result.name]?.raw_value?' · '+values[result.name].raw_value:''}</summary>
     <div className="soil-result-card-fields">{cells(result)}{remove(result)}</div>
    </details>):<table className="soil-results-editor" aria-label={'Resultados de muestra '+(sample.name+1)}>
     <colgroup>{[18,20,8,15,16,15,8].map((width,i)=><col key={i} style={{width:width+'%'}}/>)}</colgroup>
     <thead><tr>{['Parámetro','Método','Unidad','Resultado original','Estado','Valor numérico','Eliminar'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
     <tbody>{results.map(result=><tr key={result.key}>{cells(result).map((cell,i)=><td key={i}>{cell}</td>)}<td>{remove(result)}</td></tr>)}</tbody>
    </table>}
    <Form.ErrorList errors={meta.errors}/><Button icon={<PlusOutlined/>} onClick={()=>operations.add({result_status:'measured'})} disabled={results.length>=100}>Agregar resultado</Button>
   </>;
  }}
 </Form.List>;
}

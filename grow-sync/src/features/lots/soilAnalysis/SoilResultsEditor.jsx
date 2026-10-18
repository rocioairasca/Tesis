import React,{useState} from 'react';
import {Button,Form,Input} from 'antd';
import {DeleteOutlined,PlusOutlined} from '../../../components/AppIcons';
import useIsMobile from '../../../hooks/useIsMobile';
import {resultText,editedResult} from './soilAnalysisModel.mjs';

// Keep in-progress decimals ("7," / "7.") editable; format only outside the control.
function ResultInput({value={},onChange,...props}){
 const [focused,setFocused]=useState(false),[draft,setDraft]=useState('');
 const display=resultText(value);
 return <Input {...props} value={focused?draft:display} onFocus={()=>{
  setDraft(value.numeric_value!=null?display.replace(/\./g,''):display);setFocused(true);
 }} onBlur={()=>setFocused(false)} onChange={event=>{
  const text=event.target.value;setDraft(text);onChange({...value,...editedResult(text)});
 }}/>;
}
export default function SoilResultsEditor({sample,values=[],busy}){
 const mobile=useIsMobile();
 const cells=result=>[
  <Form.Item key="parameter" name={[result.name,'parameter_name']} label="Parámetro" rules={[{required:true,message:'Ingresá el parámetro.'}]}><Input maxLength={200}/></Form.Item>,
  <Form.Item key="method" name={[result.name,'method']} label="Método"><Input/></Form.Item>,
  <Form.Item key="unit" name={[result.name,'unit']} label="Unidad"><Input/></Form.Item>,
  <Form.Item key="result" name={[result.name]} label="Resultado" rules={[{validator:(_,value)=>value?.raw_value?.trim()?Promise.resolve():Promise.reject(new Error('Ingresá el resultado.'))}]}><ResultInput disabled={busy}/></Form.Item>,
 ];
 return <Form.List name={[sample.name,'results']} rules={[{validator:(_,v)=>v?.length?Promise.resolve():Promise.reject(new Error('Agregá al menos un resultado.'))}]}>
  {(results,operations,meta)=>{
   const remove=result=><Button type="text" danger size="small" icon={<DeleteOutlined/>} aria-label={'Eliminar resultado '+(result.name+1)+' de muestra '+(sample.name+1)} onClick={()=>operations.remove(result.name)}/>;
   return <>
    {mobile?results.map(result=><details className="soil-result-card" key={result.key} open={results.length===1?true:undefined}>
     <summary>{values[result.name]?.parameter_name||'Resultado '+(result.name+1)}{resultText(values[result.name])?' · '+resultText(values[result.name]):''}</summary>
     <div className="soil-result-card-fields">{cells(result)}{remove(result)}</div>
    </details>):<table className="soil-results-editor" aria-label={'Resultados de muestra '+(sample.name+1)}>
     <colgroup>{[26,28,12,26,8].map((width,i)=><col key={i} style={{width:width+'%'}}/>)}</colgroup>
     <thead><tr>{['Parámetro','Método','Unidad','Resultado','Acción'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
     <tbody>{results.map(result=><tr key={result.key}>{cells(result).map((cell,i)=><td key={i}>{cell}</td>)}<td>{remove(result)}</td></tr>)}</tbody>
    </table>}
    <Form.ErrorList errors={meta.errors}/><Button icon={<PlusOutlined/>} onClick={()=>operations.add({result_status:'measured'})} disabled={results.length>=100}>Agregar resultado</Button>
   </>;
  }}
 </Form.List>;
}

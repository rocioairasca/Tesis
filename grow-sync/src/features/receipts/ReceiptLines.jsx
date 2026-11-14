import React,{useEffect,useRef,useState} from 'react';
import {Alert,AutoComplete,Button,Form,Input,InputNumber,Select} from 'antd';
import api from '../../services/apiClient';
import {formatNumber} from '../../utils/numberFormat';
import {unitOptions,normalizeUnit} from '../../utils/inventoryUnits';
import {formatCalendarDate} from '../../utils/calendarDate';
export default function ReceiptLines({lines,onChange,editable,disabled,onPendingChange}){
 const [form]=Form.useForm(),[products,setProducts]=useState([]),[search,setSearch]=useState(''),[editing,setEditing]=useState(null),[error,setError]=useState(null);
 const productInput=useRef(null),busy=useRef(false);
 useEffect(()=>{
  if(!editable)return;let active=true;
  const timer=setTimeout(()=>{api.get('/receipts/products',{params:{search}}).then(({data})=>{if(active)setProducts(data);}).catch(()=>{if(active)setProducts([]);});},200);
  return()=>{active=false;clearTimeout(timer);};
 },[search,editable]);
 const clear=()=>{form.resetFields();setSearch('');setEditing(null);setError(null);onPendingChange(false);requestAnimationFrame(()=>productInput.current?.focus());};
 const add=async()=>{
  if(busy.current||disabled)return;busy.current=true;
  try{
   const values=await form.validateFields();
   if(editing===null&&lines.length>=200){setError('El remito admite hasta 200 líneas.');return;}
   onChange(editing===null?[...lines,values]:lines.map((line,i)=>i===editing?values:line));clear();
  }catch(e){if(!e.errorFields)setError('Revisá la línea.');}finally{busy.current=false;}
 };
 return <section className="receipts-lines" aria-label="Productos del remito"><h3>Productos</h3>
  {editable&&<Form form={form} component={false} layout="vertical" disabled={disabled} onValuesChange={(_,values)=>onPendingChange(editing!==null||Object.values(values).some(v=>v!=null&&v!==''))}>
   <div className="receipts-entry">
    <div className="receipts-entry-fields">
     <Form.Item name="raw_description" label="Producto / descripción" className="receipts-description" rules={[{required:true,whitespace:true,message:'Ingresá la descripción.'}]}>
      <AutoComplete aria-label="Producto / descripción" ref={productInput} maxLength={500} options={products.map(p=>({value:p.name,label:p.name,product:p}))} onSearch={value=>{setSearch(value);form.setFieldValue('matched_product_id',null);}}
       onSelect={(_value,option)=>form.setFieldsValue({matched_product_id:option.product.id,unit:normalizeUnit(option.product.unit)})} placeholder="Buscar o escribir descripción"/>
     </Form.Item>
     <Form.Item name="matched_product_id" hidden><Input/></Form.Item>
     <Form.Item name="quantity" label="Cantidad" rules={[{validator:(_,v)=>v==null||v===''||/^\d{1,14}(\.\d{1,6})?$/.test(String(v))&&Number(v)>0?Promise.resolve():Promise.reject(new Error('Cantidad mayor a cero, hasta 6 decimales.'))}]}><InputNumber aria-label="Cantidad" stringMode decimalSeparator=","/></Form.Item>
     <Form.Item name="unit" label="Unidad"><Select allowClear options={unitOptions} onChange={()=>form.setFieldValue('matched_product_id',null)}/></Form.Item>
     <Form.Item name="presentation" label="Presentación"><Input maxLength={200}/></Form.Item>
     <Form.Item name="supplier_batch" label="Lote proveedor"><Input maxLength={200}/></Form.Item>
     <Form.Item name="expiration_date" label="Vencimiento"><Input type="date"/></Form.Item>
    </div>
    <div className="receipts-entry-actions">{editing!==null&&<Button type="link" onClick={clear}>Cancelar edición</Button>}<Button type="primary" onClick={add}>{editing===null?'Agregar':'Guardar línea'}</Button></div>
   </div>
  </Form>}
  {error&&<Alert type="error" message={error}/>}
  <div className="receipts-lines-list" role="table" aria-label="Líneas del remito">
   <div role="row" className="receipts-lines-head">{['Producto / descripción','Cantidad','Unidad','Presentación / lote','Vencimiento','Acciones'].map(x=><div role="columnheader" key={x}>{x}</div>)}</div>
   {lines.map((line,index)=><div role="row" className="receipts-line" key={index}>
    <div role="cell" className="receipts-line-name">{line.raw_description}{line.matched_product_id&&<small>Producto asociado</small>}</div>
    <div role="cell">{formatNumber(line.quantity,6)}</div><div role="cell">{line.unit||'—'}</div>
    <div role="cell">{[line.presentation,line.supplier_batch].filter(Boolean).join(' · ')||'—'}</div>
    <div role="cell">{formatCalendarDate(line.expiration_date,'Sin vencimiento')}</div>
    <div role="cell" className="receipts-line-actions">{editable&&<><Button type="link" disabled={disabled} onClick={()=>{form.setFieldsValue(line);setEditing(index);setSearch('');onPendingChange(true);productInput.current?.focus();}}>Editar</Button><Button type="link" danger disabled={disabled} onClick={()=>{onChange(lines.filter((_,i)=>i!==index));clear();}}>Eliminar</Button></>}</div>
   </div>)}
   {!lines.length&&<p>No hay productos cargados.</p>}
  </div>
 </section>;
}

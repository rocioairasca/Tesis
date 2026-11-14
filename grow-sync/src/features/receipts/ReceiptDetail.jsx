import React,{useRef,useState} from 'react';
import {Alert,Button,Descriptions,Drawer,Form,Input,Modal,Space,Tag} from 'antd';
import api from '../../services/apiClient';
import {hasPermission} from '../../utils/permissions';
import {getUserFriendlyError} from '../../utils/userFriendlyErrors';
import {formatNumber} from '../../utils/numberFormat';
import ReceiptLines from './ReceiptLines';
import {metadataPayload,linesPayload,statusLabels,statusColors} from './receiptPresentation';
export default function ReceiptDetail({initial,user,onClose,onSaved}){
 const [receipt,setReceipt]=useState(initial),[lines,setLines]=useState(initial?.lines||[]),[file,setFile]=useState(null),[saving,setSaving]=useState(false),[error,setError]=useState(null),[rejecting,setRejecting]=useState(false),[reason,setReason]=useState('');
 const [entryPending,setEntryPending]=useState(false);
 const [form]=Form.useForm(),busy=useRef(false),drawer=useRef(null),receiptId=useRef(initial?.id);
 const capture=hasPermission(user,'receipts.capture'),review=hasPermission(user,'receipts.review');
 const own=!receipt||receipt.created_by===user.id;
 const status=receipt?.status||'draft';
 const editable=status==='draft'&&(review||capture&&own)||status==='pending_validation'&&review;
 const canSubmit=capture&&own&&status==='draft';
 const save=async submit=>{
  if(busy.current)return;
  if(entryPending){setError('Agregá o cancelá la línea en edición antes de guardar.');return;}
  let values;try{values=await form.validateFields();}catch{return;}
  if(submit&&!lines.length){setError('Agregá al menos una línea antes de enviar.');return;}
  busy.current=true;setSaving(true);setError(null);
  try{
   const metadata=metadataPayload(values);
   const {data:document}=receiptId.current?await api.patch('/receipts/'+receiptId.current,metadata):await api.post('/receipts',metadata);
   receiptId.current=document.id;setReceipt(document);
   let {data:result}=await api.put('/receipts/'+document.id+'/lines',linesPayload(lines));
   if(file){const body=new FormData();body.append('file',file);({data:result}=await api.put('/receipts/'+document.id+'/document',body,{headers:{'Content-Type':'multipart/form-data'}}));setFile(null);}
   if(submit)({data:result}=await api.post('/receipts/'+document.id+'/submit',{}));
   setReceipt(result);setLines(result.lines);onSaved();
  }catch(e){setError(getUserFriendlyError(e,'No se pudo guardar el remito.'));}
  finally{busy.current=false;setSaving(false);}
 };
 const reject=async()=>{
  if(busy.current||!reason.trim())return;busy.current=true;setSaving(true);setError(null);
  try{const {data}=await api.post('/receipts/'+receiptId.current+'/reject',{reason});setReceipt(data);setLines(data.lines);setRejecting(false);onSaved();}
  catch(e){setError(getUserFriendlyError(e,'No se pudo rechazar el remito.'));}finally{busy.current=false;setSaving(false);}
 };
 const openDocument=async()=>{
  try{const {data}=await api.get('/receipts/'+receiptId.current+'/document-url');window.open(data.url,'_blank','noopener,noreferrer');}
  catch(e){setError(getUserFriendlyError(e,'No se pudo abrir el documento.'));}
 };
 return <Drawer open title={initial?'Detalle del remito':'Cargar remito'} width={1100} className="receipts-drawer" onClose={()=>!saving&&onClose()} maskClosable={!saving} closable={!saving}>
  <div ref={drawer}>
   <Space wrap><Tag color={statusColors[status]}>{statusLabels[status]}</Tag>{receipt?.created_by_name&&<span>Cargado por {receipt.created_by_name}</span>}</Space>
   {error&&<Alert className="receipts-message" type="error" showIcon message={error}/>}
   {receipt?.warnings?.map(w=><Alert className="receipts-message" key={w.code} type="warning" showIcon message={w.message}/>)}
   {receipt?.rejection_reason&&<Alert className="receipts-message" type="warning" message="Motivo del rechazo" description={receipt.rejection_reason}/>}
   <Form form={form} layout="vertical" initialValues={initial||{}} disabled={!editable||saving}>
    <div className="receipts-metadata">
     <Form.Item name="supplier_name" label="Proveedor"><Input maxLength={500}/></Form.Item>
     <Form.Item name="supplier_tax_id" label="CUIT si figura"><Input maxLength={40}/></Form.Item>
     <Form.Item name="document_number" label="Número de remito"><Input maxLength={150}/></Form.Item>
     <Form.Item name="document_date" label="Fecha del documento"><Input type="date"/></Form.Item>
     <Form.Item name="document_type" label="Tipo de documento"><Input maxLength={80}/></Form.Item>
    </div>
    <Form.Item name="notes" label="Notas"><Input.TextArea maxLength={2000} autoSize={{minRows:2,maxRows:4}}/></Form.Item>
   </Form>
   <section className="receipts-document" aria-label="Documento original">
    {receipt?.source_filename&&<Button onClick={openDocument}>Abrir documento: {receipt.source_filename}</Button>}
    {capture&&own&&status==='draft'&&<><label>Foto o PDF (opcional, hasta 10 MB)<input aria-label="Foto o PDF" type="file" accept="application/pdf,image/jpeg,image/png" disabled={saving} onChange={e=>{
     const selected=e.target.files?.[0];if(selected&&selected.size>10*1024*1024){setError('El documento no puede superar 10 MB.');e.target.value='';return;}setFile(selected||null);
    }}/></label>{file&&<Button type="link" disabled={saving} onClick={()=>{setFile(null);const input=drawer.current?.querySelector('input[type=file]');if(input)input.value='';}}>Quitar archivo</Button>}</>}
   </section>
   <ReceiptLines lines={lines} onChange={setLines} onPendingChange={setEntryPending} editable={editable} disabled={saving}/>
   {review&&hasPermission(user,'receipts.view_economics')&&receipt?.economics&&<Descriptions className="receipts-message" title="Datos económicos documentales" column={1}
    items={Object.entries({currency:'Moneda',subtotal:'Subtotal',discounts:'Descuentos',taxes:'Impuestos',total:'Total'}).map(([key,label])=>({key,label,children:key==='currency'?receipt.economics[key]||'—':formatNumber(receipt.economics[key])}))}/>}
   <div className="receipts-footer">
    <Button disabled={saving} onClick={onClose}>Cerrar</Button>
    {review&&status==='pending_validation'&&<Button danger disabled={saving} onClick={()=>setRejecting(true)}>Rechazar</Button>}
    {editable&&<Button disabled={saving} onClick={()=>save(false)}>{status==='draft'?'Guardar borrador':'Guardar correcciones'}</Button>}
    {canSubmit&&<Button type="primary" aria-label="Enviar a revisión" aria-busy={saving} disabled={saving} loading={saving} onClick={()=>save(true)}>Enviar a revisión</Button>}
   </div>
  </div>
  <Modal open={rejecting} title="Rechazar remito" okText="Rechazar" cancelText="Cancelar" onCancel={()=>!saving&&setRejecting(false)} onOk={reject} confirmLoading={saving} okButtonProps={{danger:true,disabled:!reason.trim()}}>
   <label>Motivo del rechazo<Input.TextArea aria-label="Motivo del rechazo" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
  </Modal>
 </Drawer>;
}

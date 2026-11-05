import React,{useEffect,useState} from 'react';
import {Alert,Button,Form,Input,Modal,Spin,Tag,Typography} from 'antd';
import api from '../../../services/apiClient';
import {hasPermission} from '../../../utils/permissions';
import {getUserFriendlyError} from '../../../utils/userFriendlyErrors';
import money from '../../../../../shared/costEstimate.cjs';
import {economicReadPermissions,economicEditPermissions,laborPayload} from '../planningEconomics.mjs';
import {LaborFields} from './ExecutionEconomicFields';
import './planningEconomics.css';
const statusLabel={complete:'Completo',partial:'Parcial',pending:'Pendiente'};
const qty=value=>String(value??'—').replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1').replace('.',',');
function Evidence({data}){
 const [expanded,setExpanded]=useState(false);
 const labor=data.lines.find(l=>l.kind==='labor');
 return <>
  <Tag color={data.snapshot.economic_status==='complete'?'green':'gold'}>Estado económico: {statusLabel[data.snapshot.economic_status]}</Tag>
  <p>Revisión {data.snapshot.revision} · Fecha efectiva: {String(data.snapshot.effective_date).slice(0,10)}</p>
  <div className="planning-economics-row"><span>Productos{data.pending_product_lines?' conocidos':''}</span><strong>{money.formatUsd(data.known_products_cost_usd)}</strong></div>
  <div className="planning-economics-row"><span>Labor</span><strong>{data.snapshot.labor_status==='not_applicable'?'No corresponde':labor?.amount_usd==null?'Pendiente':money.formatUsd(labor.amount_usd)}</strong></div>
  {data.snapshot.economic_status!=='complete'&&<Alert type="warning" showIcon message="Costo económico parcial"
    description={<>{data.pending_product_lines>0&&<div>{data.pending_product_lines} partida(s) con costo pendiente.</div>}{data.snapshot.labor_status==='pending'&&<div>Labor pendiente.</div>}</>}/>}
  <div className="planning-economics-row"><strong>{data.total_cost_usd==null?'Costo conocido':'Costo real total'}</strong><strong data-testid="actual-cost-total">{money.formatUsd(data.known_total_usd)}</strong></div>
  {data.cost_per_ha_usd!=null&&<div className="planning-economics-row"><span>Costo real / ha</span><strong data-testid="actual-cost-per-ha">{money.formatUsd(data.cost_per_ha_usd)}</strong></div>}
  <Button type="link" onClick={()=>setExpanded(v=>!v)}>{expanded?'Ocultar detalle económico':'Ver detalle económico'}</Button>
  {expanded&&<div className="planning-economics-evidence">
   {data.lines.filter(l=>l.kind==='product').map(l=><div key={l.id} className="planning-economics-line">
    <strong>{l.product_name_snapshot}</strong> · {qty(l.quantity)} {l.unit_snapshot}
    <div>Partida {l.batch_id} · {l.cost_status==='pending'?'Costo pendiente':money.formatUsd(l.amount_usd)}</div>
   </div>)}
   {labor&&<p>Labor: {labor.currency||'Moneda pendiente'} {qty(labor.rate_original)} / ha × {qty(labor.area_ha)} ha
     {labor.currency==='ARS'&&<> · Pago: {String(labor.payment_date||'Pendiente').slice(0,10)} · FX: {qty(labor.fx_rate)} ARS/USD · {labor.fx_source||'Fuente pendiente'}</>}</p>}
   <Typography.Title level={5}>Imputación</Typography.Title>
   {data.targets.map(t=><p key={t.id}>{t.lot_name_snapshot}{t.sub_lot_name_snapshot?' / '+t.sub_lot_name_snapshot:''} · {t.crop_name_snapshot} · {qty(t.applied_area_ha)} ha</p>)}
   <Typography.Paragraph type="secondary">Prorrateado por superficie. No representa consumo medido por lote.</Typography.Paragraph>
   <Typography.Paragraph type="secondary">{data.comparison_unavailable_reason}</Typography.Paragraph>
  </div>}
 </>;
}
function Actual({planningId,user}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null),[revision,setRevision]=useState(0);
 const [historyPage,setHistoryPage]=useState(0),[hasMoreHistory,setHasMoreHistory]=useState(false);
 const [history,setHistory]=useState(null),[historyError,setHistoryError]=useState(null),[historyLoading,setHistoryLoading]=useState(false);
 const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(null),[key,setKey]=useState(null),[form]=Form.useForm();
 const editable=economicEditPermissions.every(p=>hasPermission(user,p));
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError(null);setData(null);setHistory(null);
  api.get('/planning/'+planningId+'/economics',{signal:controller.signal}).then(r=>{
   if(!controller.signal.aborted){if(!Object.prototype.hasOwnProperty.call(r.data||{},'current'))throw Error('Respuesta económica inválida.');setData(r.data.current);}
  }).catch(e=>{if(!controller.signal.aborted)setError(getUserFriendlyError(e,'No se pudo cargar el costo real.'));})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[planningId,revision]);
 const loadHistory=async(page=1)=>{
  setHistoryLoading(true);setHistoryError(null);
  try{const r=await api.get('/planning/'+planningId+'/economics/history',{params:{page}});
   setHistory(previous=>page===1?r.data.data:[...(previous||[]),...r.data.data]);setHistoryPage(page);setHasMoreHistory(r.data.data.length===25);}
  catch(e){setHistoryError(getUserFriendlyError(e,'No se pudo cargar el historial.'));}
  finally{setHistoryLoading(false);}
 };
 const save=async values=>{
  setSaving(true);setSaveError(null);
  try {
   const labor=laborPayload(values.economicLabor);
   const r=await api.post('/planning/'+planningId+'/economics/revisions',{supersedes_id:data.snapshot.id,reason:values.reason,...(labor?{labor}:{})},{headers:{'Idempotency-Key':key}});
   setData(r.data.current);setHistory(null);setEditing(false);form.resetFields();
  }catch(e){setSaveError(getUserFriendlyError(e,'No se pudo registrar la revisión.'));}
  finally{setSaving(false);}
 };
 return <section className="planning-economics" aria-label="Costo real" aria-busy={loading}>
  <Typography.Title level={5}>Costo real</Typography.Title>
  {loading?<Spin/>:error?<Alert type="error" message={error} action={<Button onClick={()=>setRevision(v=>v+1)}>Reintentar costo real</Button>}/>:!data?
   <Typography.Paragraph type="secondary">Sin evidencia económica histórica registrada. No se reconstruye con precios actuales.</Typography.Paragraph>:<>
    <Evidence data={data}/>
    <div className="planning-economics-actions">
     <Button onClick={()=>loadHistory()} loading={historyLoading}>Ver historial económico</Button>
     {editable&&<Button onClick={()=>{form.resetFields();setKey(crypto.randomUUID());setSaveError(null);setEditing(true);}}>Revisar costo económico</Button>}
    </div>
    {historyError&&<Alert type="error" message={historyError}/>}
    {history&&<div aria-label="Historial económico">{history.map(h=><details key={h.snapshot.id}>
      <summary>Revisión {h.snapshot.revision} · {statusLabel[h.snapshot.economic_status]} · {h.snapshot.reason||'Ejecución original'}</summary>
      <p>Actor: {h.snapshot.created_by} · {String(h.snapshot.created_at)}</p><Evidence data={h}/>
     </details>)}{hasMoreHistory&&<Button loading={historyLoading} onClick={()=>loadHistory(historyPage+1)}>Cargar revisiones anteriores</Button>}</div>}
   </>}
  <Modal title="Revisar costo económico" open={editing} onCancel={()=>{if(!saving)setEditing(false);}} onOk={()=>form.submit()} okText="Guardar revisión" cancelText="Cancelar" confirmLoading={saving} destroyOnHidden>
   <Alert type="info" message="Se crea una nueva revisión. Los productos confirmados conservan su costo; sólo se actualizan partidas pendientes con nueva evidencia."/>
   <Form form={form} layout="vertical" onFinish={save}>
    <LaborFields form={form} allowKeep/>
    <Form.Item name="reason" label="Motivo de la revisión" rules={[{required:true,whitespace:true,message:'Indicá el motivo.'}]}><Input.TextArea maxLength={2000}/></Form.Item>
   </Form>
   {saveError&&<Alert type="error" message={saveError}/>}
  </Modal>
 </section>;
}
export default function PlanningActualCost({planning,user}){
 return planning?.status==='completado'&&economicReadPermissions.every(p=>hasPermission(user,p))
  ?<Actual key={planning.id} planningId={planning.id} user={user}/>:null;
}

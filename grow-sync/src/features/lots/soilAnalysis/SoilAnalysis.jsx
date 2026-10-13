import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Alert,Button,DatePicker,Descriptions,Form,Select,Space,Table,Tooltip} from 'antd';
import {useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {PageHeader,DataTable,EntityLink,ErrorState,LoadingState,ConfirmDialog,FormDrawer,FocusModal} from '../../../components/ui';
import {PERMISSIONS} from '../../../constants/permissions';
import {hasPermission} from '../../../utils/permissions';
import {getUserFriendlyError} from '../../../utils/userFriendlyErrors';
import {formatCalendarDate,parseCalendarDate} from '../../../utils/calendarDate';
import useIsMobile from '../../../hooks/useIsMobile';
import api from '../../../services/apiClient';
import SoilAnalysisForm from './SoilAnalysisForm';
import SoilPdfPreview from './SoilPdfPreview';
import {emptySample,historyRows,reportPayload,validatePdf,depthText,highlights,resultText} from './soilAnalysisModel.mjs';
import './soilAnalysis.css';
export default function SoilAnalysis(){
 const {lotId}=useParams(),[params]=useSearchParams(),navigate=useNavigate(),mobile=useIsMobile();
 const user=JSON.parse(localStorage.getItem('user')||'null'),can=key=>hasPermission(user,PERMISSIONS['SOIL_ANALYSIS_'+key]);
 const canView=can('VIEW'),canCreate=can('CREATE'),canDisabled=can('VIEW_DISABLED');
 const [context,setContext]=useState(null),[contextError,setContextError]=useState(null),[contextRetry,setContextRetry]=useState(0);
 const [sub,setSub]=useState(params.get('subLotId')||undefined),[enabled,setEnabled]=useState('true'),[range,setRange]=useState(null);
 const [reports,setReports]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(null),[refresh,setRefresh]=useState(0);
 const [viewing,setViewing]=useState(null),[detailError,setDetailError]=useState(null),[detailLoading,setDetailLoading]=useState(false),[showPdf,setShowPdf]=useState(false);
 const [editor,setEditor]=useState(null),[file,setFile]=useState(null),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(null),[confirmation,setConfirmation]=useState(null);
 const [form]=Form.useForm();
 const detailController=useRef(null);
 useEffect(()=>()=>detailController.current?.abort(),[]);
 useEffect(()=>{
  if(!canView)return;const controller=new AbortController();setContext(null);setContextError(null);
  api.get('/soil-analysis/lot-context/'+lotId,{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setContext(data);}).catch(e=>{if(!controller.signal.aborted)setContextError(e);});
  return ()=>controller.abort();
 },[lotId,canView,contextRetry]);
 const from=range?.[0]?.format('YYYY-MM-DD'),to=range?.[1]?.format('YYYY-MM-DD');
 useEffect(()=>{
  if(!canView||!context)return;const controller=new AbortController();setLoading(true);setError(null);
  api.get('/soil-analysis',{params:{lot_id:lotId,sub_lot_id:sub&&sub!=='full'?sub:undefined,enabled:canDisabled?enabled:'true',from,to},signal:controller.signal})
   .then(({data})=>{if(!controller.signal.aborted)setReports(data);}).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[lotId,context,sub,enabled,canDisabled,canView,from,to,refresh]);
 const openDetail=useCallback(async reportId=>{
  detailController.current?.abort();const controller=new AbortController();detailController.current=controller;
  setDetailLoading(true);setDetailError(null);setViewing({id:reportId});setShowPdf(false);
  try{const {data}=await api.get('/soil-analysis/'+reportId,{signal:controller.signal});if(!controller.signal.aborted)setViewing(data);}catch(e){if(!controller.signal.aborted)setDetailError(e);}finally{if(!controller.signal.aborted)setDetailLoading(false);}
 },[]);
 const openEditor=async report=>{
  setSaveError(null);setFile(null);form.resetFields();
  if(report){try{const {data}=await api.get('/soil-analysis/'+report.id);form.setFieldsValue({...data,received_date:parseCalendarDate(data.received_date),samples:data.samples.map(s=>({...s,sample_date:parseCalendarDate(s.sample_date)}))});setEditor({report:data});setViewing(null);}catch(e){setError(e);}}
  else{form.setFieldsValue({samples:[emptySample(lotId,sub&&sub!=='full'?sub:null)]});setEditor({report:null});}
 };
 const save=async values=>{
  setSaving(true);setSaveError(null);
  try{const body=reportPayload(values);
   if(editor.report)await api.put('/soil-analysis/'+editor.report.id,body);
   else{validatePdf(file);const data=new FormData();data.append('file',file);data.append('metadata',JSON.stringify(body));await api.post('/soil-analysis',data,{headers:{'Content-Type':'multipart/form-data'}});}
   setEditor(null);setFile(null);setRefresh(r=>r+1);
  }catch(e){setSaveError(getUserFriendlyError(e,e.message));}finally{setSaving(false);}
 };
 const rows=historyRows(reports,lotId,sub).filter(s=>(!from||s.sample_date>=from)&&(!to||s.sample_date<=to));
 const actions=row=>[
  {key:'view',label:'Ver análisis',onClick:()=>openDetail(row.report.id)},
  {key:'edit',label:'Editar',hidden:!can('EDIT'),onClick:()=>openEditor(row.report)},
  {key:'disable',label:'Deshabilitar',hidden:!row.report.enabled||!can('DISABLE'),danger:true,onClick:()=>setConfirmation({report:row.report,enabled:false})},
  {key:'enable',label:'Restaurar',hidden:row.report.enabled||!can('ENABLE'),onClick:()=>setConfirmation({report:row.report,enabled:true})},
 ];
 const columns=[{title:'Muestreo',key:'date',width:120,render:(_,row)=><EntityLink onClick={()=>openDetail(row.report.id)}>{formatCalendarDate(row.sample_date)}</EntityLink>},
  {title:'Muestra',key:'sample',ellipsis:false,render:(_,row)=><>{row.sample_name||'Muestra'}<small className="soil-secondary">{row.sub_lot_name||'Lote completo'} · {depthText(row)}</small></>},
  {title:'Informe',key:'report',render:(_,row)=>row.report.report_number||'Sin número'},
  {title:'Laboratorio',key:'laboratory',render:(_,row)=>row.report.laboratory||'No consignado'},
  {title:'Resultados destacados',key:'highlights',ellipsis:false,render:(_,row)=><div className="soil-highlights">{highlights(row).map(h=><span key={h.name}>{h.name}: {h.text}</span>)}</div>},
 ];
 const resultsColumns=[{title:'Parámetro',dataIndex:'parameter_name'},{title:'Método',dataIndex:'method',render:v=>v||'—'},{title:'Unidad',dataIndex:'unit',render:v=>v||'—'},
  {title:'Resultado',key:'result',render:(_,r)=>r.result_status==='not_requested'?<Tooltip title={r.raw_value}><span>No requerido</span></Tooltip>:r.raw_value}];
 if(!canView)return <ErrorState message="No tenés permiso para ver análisis de suelo." />;
 const invalidSub=Boolean(sub&&sub!=='full'&&context&&!context.lots.find(l=>l.id===lotId)?.sub_lots.some(s=>s.id===sub));
 return <main className="gs-soil-analysis">
  <PageHeader title="Análisis de suelo" description={context?.lot.name||'Lote'} primaryAction={canCreate&&context&&!invalidSub?{label:'Nuevo análisis',onClick:()=>openEditor(null)}:undefined} secondaryActions={[{key:'back',label:'Volver a Lotes',onClick:()=>navigate('/lotes')}]} />
  {contextError?<ErrorState error={contextError} onRetry={()=>setContextRetry(r=>r+1)} />:!context?<LoadingState label="Cargando lote…" />:invalidSub?<Alert type="error" message="La división seleccionada no corresponde al lote." />:<>
   <div className="soil-filters">
    <Select aria-label="Filtrar muestras" placeholder="Todas las muestras" allowClear value={sub} onChange={setSub} options={[{value:'full',label:'Lote completo'},...(context.lots.find(l=>l.id===lotId)?.sub_lots||[]).map(s=>({value:s.id,label:s.name}))]} />
    <DatePicker.RangePicker aria-label="Período de muestreo" format="DD/MM/YYYY" value={range} onChange={setRange} />
    {canDisabled&&<Select aria-label="Estado de los análisis" value={enabled} onChange={setEnabled} options={[{value:'true',label:'Activos'},{value:'false',label:'Deshabilitados'},{value:'all',label:'Todos'}]} />}
   </div>
   <DataTable title="Historial de análisis" columns={columns} dataSource={rows} rowKey="key" loading={loading} error={error} onRetry={()=>setRefresh(r=>r+1)} actions={actions} rowLabel={s=>'muestra '+formatCalendarDate(s.sample_date)}
    empty={{title:'Todavía no hay análisis de suelo para este lote.',action:canCreate?{label:'Cargar análisis',onClick:()=>openEditor(null)}:undefined}}
    renderMobile={s=><div className="soil-history-card"><p>{s.sample_name||s.sub_lot_name||'Lote completo'} · {depthText(s)}</p><p>Informe {s.report.report_number||'sin número'} · {s.report.laboratory||'Laboratorio no consignado'}</p><div className="soil-highlights">{highlights(s).map(h=><span key={h.name}>{h.name}: {h.text}</span>)}</div><Button onClick={()=>openDetail(s.report.id)}>Ver análisis</Button></div>} />
  </>}
  <FormDrawer open={Boolean(editor)} title={editor?.report?'Editar análisis':'Nuevo análisis'} wide busy={saving} onClose={()=>{setEditor(null);setFile(null);}} rootClassName="soil-form-drawer"
   footer={<Space wrap><Button disabled={saving} onClick={()=>setEditor(null)}>Cancelar</Button><Button type="primary" loading={saving} onClick={()=>form.submit()}>Guardar análisis</Button></Space>}>
   {saveError&&<Alert type="error" showIcon message={saveError} />}
   {editor&&context&&<SoilAnalysisForm form={form} lots={context.lots} editing={editor.report} file={file} onFileChange={setFile} onFinish={save} lotId={lotId} subLotId={sub&&sub!=='full'?sub:null} busy={saving} />}
  </FormDrawer>
  <FocusModal open={Boolean(viewing)} title="Detalle de análisis de suelo" width={1100} rootClassName="soil-detail-modal" onCancel={()=>{detailController.current?.abort();setViewing(null);setShowPdf(false);}}>
   {detailLoading?<LoadingState label="Cargando análisis…" />:detailError?<ErrorState error={detailError} onRetry={()=>openDetail(viewing.id)} />:viewing?.samples&&<div className="soil-detail-grid">
    <section>
     <Descriptions size="small" column={1} bordered><Descriptions.Item label="Informe">{viewing.report_number||'Sin número'}</Descriptions.Item><Descriptions.Item label="Laboratorio">{viewing.laboratory||'No consignado'}</Descriptions.Item><Descriptions.Item label="Recepción">{formatCalendarDate(viewing.received_date)}</Descriptions.Item></Descriptions>
     {viewing.notes&&<p>{viewing.notes}</p>}
     {viewing.samples.map(s=><section key={s.id} className="soil-sample-detail">
      <h3>{s.sample_name||'Muestra'} · {formatCalendarDate(s.sample_date)}</h3><p>{s.lot_name} · {s.sub_lot_name||'Lote completo'} · {depthText(s)}</p>
      {s.position_description&&<p>Posición: {s.position_description}</p>}{s.sampled_by&&<p>Muestreado / enviado por: {s.sampled_by}</p>}{s.notes&&<p>{s.notes}</p>}
      <div className="soil-results-table"><Table size="small" pagination={false} rowKey="id" columns={resultsColumns} dataSource={s.results} scroll={{x:500}} /></div>
     </section>)}
     {can('EDIT')&&<Button onClick={()=>openEditor(viewing)}>Editar análisis</Button>}
    </section>
    <section>{mobile&&!showPdf?<Button onClick={()=>setShowPdf(true)}>Ver PDF</Button>:<SoilPdfPreview reportId={viewing.id} />}</section>
   </div>}
  </FocusModal>
  {confirmation&&<ConfirmDialog open title={confirmation.enabled?'Restaurar análisis':'Deshabilitar análisis'} description="El informe conserva sus muestras, resultados y PDF original." confirmLabel={confirmation.enabled?'Restaurar':'Deshabilitar'} destructive={!confirmation.enabled} onCancel={()=>setConfirmation(null)} onSuccess={()=>setConfirmation(null)}
   onConfirm={async()=>{if(confirmation.enabled)await api.post('/soil-analysis/'+confirmation.report.id+'/enable');else await api.delete('/soil-analysis/'+confirmation.report.id);setViewing(null);setRefresh(r=>r+1);}} />}
 </main>;
}

import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Navigate} from 'react-router-dom';
import {Alert,Button,Input,Select,Table,Tabs,Tag} from 'antd';
import {hasPermission} from '../../utils/permissions';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../services/apiClient';
import {getUserFriendlyError} from '../../utils/userFriendlyErrors';
import {formatCalendarDate} from '../../utils/calendarDate';
import ReceiptDetail from './ReceiptDetail';
import {statusLabels,statusColors} from './receiptPresentation';
import './receipts.css';
export default function Receipts(){
 const user=useMemo(()=>JSON.parse(localStorage.getItem('user')||'null'),[]);
 const capture=hasPermission(user,'receipts.capture'),review=hasPermission(user,'receipts.review');
 const [mode,setMode]=useState(review?'review':'mine'),[filters,setFilters]=useState({status:review?'pending_validation':undefined}),[page,setPage]=useState(1),[rows,setRows]=useState([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState(null),[detail,setDetail]=useState(null),[opening,setOpening]=useState(false);
 const mobile=useIsMobile(),version=useRef(0);
 const load=useCallback(async()=>{
  if(!capture&&!review)return;const current=++version.current;setLoading(true);setError(null);
  try{const {data}=await api.get('/receipts/'+mode,{params:{...filters,page,pageSize:25}});if(current===version.current){setRows(data.data);setTotal(data.total_count);}}
  catch(e){if(current===version.current)setError(getUserFriendlyError(e,'No se pudieron cargar los remitos.'));}
  finally{if(current===version.current)setLoading(false);}
 },[capture,review,mode,filters,page]);
 useEffect(()=>{load();return()=>{version.current++;};},[load]);
 const open=async row=>{
  setOpening(true);setError(null);try{const {data}=await api.get('/receipts/'+row.id);setDetail({data});}catch(e){setError(getUserFriendlyError(e,'No se pudo abrir el remito.'));}finally{setOpening(false);}
 };
 // This route is inside the authenticated PrivatePage; neither menu visibility nor local role is authority.
 if(!capture&&!review)return <Navigate to="/dashboard" replace/>;
 const action=row=><Button type="link" disabled={opening} onClick={()=>open(row)}>{row.status==='rejected'?'Ver motivo':mode==='mine'&&row.status==='draft'?'Editar':'Ver'}</Button>;
 const columns=[{title:'Fecha',dataIndex:'document_date',render:v=>formatCalendarDate(v,'Sin fecha'),width:115},{title:'Proveedor',dataIndex:'supplier_name',render:v=>v||'Sin proveedor'},
  {title:'Remito',dataIndex:'document_number',render:v=>v||'Sin número'}, {title:'Líneas',dataIndex:'line_count',width:75},
  ...(mode==='review'?[{title:'Cargado por',dataIndex:'created_by_name'}]:[]),{title:'Estado',dataIndex:'status',render:v=><Tag color={statusColors[v]}>{statusLabels[v]}</Tag>}, {title:'Acciones',key:'actions',render:(_,row)=>action(row),width:95}];
 return <main className="receipts-page">
  <header><h1>Remitos</h1>{capture&&<Button type="primary" onClick={()=>setDetail({data:null})}>Cargar remito</Button>}</header>
  {capture&&review?<Tabs activeKey={mode} onChange={value=>{setMode(value);setPage(1);setFilters({status:value==='review'?'pending_validation':undefined});}} items={[{key:'mine',label:'Mis remitos'},{key:'review',label:'Pendientes de revisión'}]}/>:<h2>{review?'Pendientes de revisión':'Mis remitos'}</h2>}
  {error&&<Alert type="error" message={error} action={<Button onClick={load}>Reintentar</Button>}/>}
  <div className="receipts-filters">
   <Select aria-label="Filtrar por estado" allowClear placeholder="Todos los estados" value={filters.status} options={Object.entries(statusLabels).map(([value,label])=>({value,label}))} onChange={status=>{setPage(1);setFilters(f=>({...f,status}));}}/>
   <Input aria-label="Filtrar por fecha" type="date" value={filters.document_date||''} onChange={e=>{setPage(1);setFilters(f=>({...f,document_date:e.target.value||undefined}));}}/>
   <Input.Search aria-label="Filtrar por proveedor" placeholder="Proveedor" allowClear onSearch={supplier_name=>{setPage(1);setFilters(f=>({...f,supplier_name:supplier_name||undefined}));}}/>
  </div>
  {mobile?<><div className="receipts-mobile-list" aria-busy={loading}>{!rows.length&&!loading&&<p>No hay remitos.</p>}{rows.map(row=><article key={row.id}><h3>{row.supplier_name||'Sin proveedor'}</h3><p>{formatCalendarDate(row.document_date,'Sin fecha')} · {row.document_number||'Sin número'} · {row.line_count} líneas</p>{mode==='review'&&<p>Cargado por {row.created_by_name}</p>}<Tag color={statusColors[row.status]}>{statusLabels[row.status]}</Tag>{action(row)}</article>)}</div><div className="receipts-pagination"><Button disabled={page===1||loading} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span>Página {page}</span><Button disabled={page*25>=total||loading} onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div></>:
   <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={{current:page,pageSize:25,total,showSizeChanger:false,position:['bottomCenter'],onChange:setPage}}/>}
  {detail&&<ReceiptDetail key={detail.data?.id||'new'} initial={detail.data} user={user} onClose={()=>setDetail(null)} onSaved={load}/>}
 </main>;
}

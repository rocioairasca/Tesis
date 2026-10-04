import React, {useEffect,useRef,useState} from 'react';
import {Alert,Checkbox,Descriptions,Modal,Spin,Table} from 'antd';
import api from '../../../services/apiClient';
import {adoptionApi} from '../historicalAdoption.mjs';
import {historicalAdoptionMessage,historicalAdoptionError} from '../historicalAdoptionCopy';
import {formatCalendarDate} from '../../../utils/calendarDate';
import {formatActivity} from '../planningDisplay';
const service=adoptionApi(api);

export default function AdoptExistingModal({planning,onClose,onAdopted}) {
  const [preview,setPreview]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [confirmed,setConfirmed]=useState(false),[error,setError]=useState(null);
  // Keep the same key after transport errors: a committed request may have lost its response.
  const key=useRef(crypto.randomUUID());
  useEffect(()=>{
    let active=true;
    service.prepare([planning.id]).then(data=>{if(active)setPreview(data);})
      .catch(e=>{if(active)setError(historicalAdoptionError(e,'No pudimos revisar esta planificación. Intentá nuevamente.'));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[planning.id]);
  const confirm=async()=>{
    if(!confirmed || !preview?.can_confirm || busy)return;
    setBusy(true);setError(null);
    try {await service.confirm([planning.id],key.current);await onAdopted();onClose();}
    catch(e){
      const conflict=e.response?.data;
      if(conflict?.items){setPreview(conflict);setConfirmed(false);}
      setError(historicalAdoptionError(e,'No se pudo marcar la planificación como histórica. Revisá el detalle e intentá nuevamente.'));
    }finally{setBusy(false);}
  };
  const item=preview?.items?.[0],graph=item?.graph;
  const lots=new Map((graph?.lots||[]).map(x=>[x.id,x.name]));
  const sublots=new Map((graph?.sub_lots||[]).map(x=>[x.id,x.name||x.code]));
  const products=new Map((graph?.products||[]).map(x=>[x.id,x.name]));
  return <Modal open title="Marcar como registro histórico" onCancel={()=>!busy&&onClose()}
    onOk={confirm} okText="Marcar como histórica" cancelText="Cancelar" confirmLoading={busy}
    okButtonProps={{disabled:loading||busy||!confirmed||!preview?.can_confirm}} cancelButtonProps={{disabled:busy}}
    closable={!busy} maskClosable={!busy} width={760}>
    <Alert type="info" showIcon message="Esta planificación se conservará tal como está y quedará identificada como un registro histórico. Las existencias del inventario no se modificarán." />
    {loading&&<Spin />}
    {error&&<Alert type="error" showIcon message={error} />}
    {item&&<>
      <Descriptions column={1} size="small" style={{marginTop:16}}>
        <Descriptions.Item label="Planificación">{planning.title||formatActivity(planning.activity_type)}</Descriptions.Item>
        <Descriptions.Item label="Fecha de realización">{formatCalendarDate(item.effective_date,'Sin fecha válida')}</Descriptions.Item>
        <Descriptions.Item label="Control de inventario desde">{formatCalendarDate(preview.inventory_control_start_date,'Sin configurar')}</Descriptions.Item>
      </Descriptions>
      {(item.blockers||[]).map((reason,i)=><Alert key={i} type="warning" showIcon message={historicalAdoptionMessage(reason)} />)}
      {graph&&<>
        <h4>Lotes y superficies</h4>
        <Table size="small" pagination={false} rowKey={r=>`${r.lot_id}:${r.sub_lot_id||''}`} dataSource={graph.planning_lots}
          columns={[{title:'Lote',render:(_,r)=>lots.get(r.lot_id)||'Lote sin nombre'},{title:'Sublote',dataIndex:'sub_lot_id',render:v=>v?(sublots.get(v)||'Sublote sin nombre'):'Lote completo'},
            {title:'Superficie (ha)',dataIndex:'area_ha',render:v=>v??'Sin dato'}]} />
        <h4>Productos registrados</h4>
        <Table size="small" pagination={false} rowKey="id" dataSource={graph.planning_products}
          columns={[{title:'Producto',render:(_,r)=>products.get(r.product_id)||'Producto sin nombre'},{title:'Cantidad planificada',dataIndex:'amount'},
            {title:'Unidad',dataIndex:'unit'},{title:'Cantidad utilizada',render:(_,r)=>graph.planning_product_completions.find(c=>c.planning_product_id===r.id)?.actual_amount??'Sin cantidad registrada'}]} />
        <p>Los datos actuales de esta planificación se mantendrán sin cambios. Este cambio no se puede deshacer.</p>
      </>}
    </>}
    <Checkbox checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy||!preview?.can_confirm}>
      Confirmo que esta planificación corresponde a una actividad realizada antes de comenzar el control de inventario y que no debe modificar las existencias.
    </Checkbox>
  </Modal>;
}
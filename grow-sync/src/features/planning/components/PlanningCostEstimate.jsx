import React, {useEffect,useState} from 'react';
import {Alert,Button,Input,Spin,Tag,Typography} from 'antd';
import api from '../../../services/apiClient';
import {hasPermission} from '../../../utils/permissions';
import {unitLabel} from '../../../utils/inventoryUnits';
import {getUserFriendlyError} from '../../../utils/userFriendlyErrors';
import money from '../../../../../shared/costEstimate.cjs';
import './planningCostEstimate.css';

export function canEstimatePlanning(planning,user) {
  return !!planning && planning.enabled!==false && ['planificado','pendiente','en_progreso'].includes(planning.status)
    && planning.inventory_impact_mode!=='HISTORICAL_NO_STOCK'
    && hasPermission(user,'planning.view') && hasPermission(user,'inventory.view');
}
const quantity=value=>value==null?'—':String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1').replace('.',',');
const positive=value=>value!=null && money.input(value)>0n;
function Estimate({planningId}) {
  const [data,setData]=useState(null),[error,setError]=useState(null),[loading,setLoading]=useState(true);
  const [revision,setRevision]=useState(0),[rate,setRate]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError(null);setData(null);
    api.get('/planning/'+planningId+'/cost-estimate',{signal:controller.signal}).then(({data:result})=>{
      if(controller.signal.aborted)return;
      if(!Array.isArray(result?.products) || !['complete','partial','unavailable'].includes(result.status))
        throw new Error('Respuesta de estimación no válida.');
      setData(result);
    }).catch(e=>{if(!controller.signal.aborted)setError(getUserFriendlyError(e,'No se pudo calcular la estimación.'));})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[planningId,revision]);
  let totals=null,rateError=null;
  if(data) {
    try {totals=money.simulateLabor(data,rate);}
    catch(e) {rateError=e.message;}
  }
  return <section className="planning-cost-estimate" aria-label="Costo estimado" aria-busy={loading}>
    <div className="planning-cost-estimate-heading">
      <Typography.Title level={5}>Costo estimado</Typography.Title>
      <Tag>Simulación</Tag>
      <Button size="small" type="link" disabled={loading} onClick={()=>setRevision(n=>n+1)}>Actualizar estimación</Button>
    </div>
    <Typography.Paragraph type="secondary">Estimación actual. No reserva stock ni registra un costo real; las partidas y los precios pueden cambiar.</Typography.Paragraph>
    {loading?<Spin/>:error?<Alert type="error" message={error} action={<Button onClick={()=>setRevision(n=>n+1)}>Reintentar</Button>}/>:data&&<>
      <Tag color={data.status==='complete'?'green':'gold'}>{data.status==='complete'?'Estimación completa de insumos':data.status==='partial'?'Estimación parcial':'Estimación no disponible'}</Tag>
      <Typography.Paragraph type="secondary">Stock al {data.as_of_date} · Superficie: {quantity(data.area_ha)} ha</Typography.Paragraph>
      <ul className="planning-cost-estimate-products">
        {data.products.map(p=><li key={p.planning_product_id}>
          <div className="planning-cost-estimate-row"><strong>{p.name}</strong><span>{quantity(p.required_quantity)} {unitLabel(p.unit)}</span></div>
          <div>{p.status==='complete'?money.formatUsd(p.known_cost_usd):positive(p.known_quantity)?'Conocido: '+money.formatUsd(p.known_cost_usd):'Costo pendiente'}</div>
          {positive(p.pending_cost_quantity)&&<div className="planning-cost-estimate-warning">{quantity(p.pending_cost_quantity)} {unitLabel(p.unit)} con costo pendiente</div>}
          {positive(p.uncovered_quantity)&&<div className="planning-cost-estimate-warning">{quantity(p.uncovered_quantity)} {unitLabel(p.unit)} sin stock disponible actualmente</div>}
          {p.issue&&<div className="planning-cost-estimate-warning">{p.issue}</div>}
        </li>)}
      </ul>
      {!data.products.length&&<p>Sin insumos previstos.</p>}
      {data.status!=='complete'&&<Alert type="warning" showIcon message="La estimación no incluye todos los costos."
        description={<>{data.pending_items} producto(s) con costo pendiente · {data.stock_shortfalls} producto(s) con faltante de stock
          {data.invalid_items>0&&<> · {data.invalid_items} producto(s) con datos incompletos</>}</>}/>}
      {data.area_warning&&<Alert type="warning" message={data.area_warning}/>}
      <div className="planning-cost-estimate-row"><span>{data.status==='complete'?'Insumos estimados':'Subtotal conocido de insumos'}</span><strong>{money.formatUsd(data.known_products_cost_usd)}</strong></div>
      <label htmlFor={'labor-rate-'+planningId}>Tarifa estimada de labor · USD / ha</label>
      <Input id={'labor-rate-'+planningId} value={rate} onChange={e=>setRate(e.target.value)}
        inputMode="decimal" placeholder="Sin incluir labor" disabled={!positive(data.area_ha)} status={rateError?'error':undefined}/>
      <Typography.Paragraph type="secondary">Simulación local: la tarifa no se guarda y se pierde al cerrar el detalle.</Typography.Paragraph>
      {rateError&&<Alert type="error" message={rateError}/>}
      {totals&&<>
        <div className="planning-cost-estimate-row"><span>Labor estimada</span><span>{totals.labor_usd==null?'No incluida':money.formatUsd(totals.labor_usd)}</span></div>
        <div className="planning-cost-estimate-total">
          <div className="planning-cost-estimate-row"><strong>{totals.total_usd==null?'Subtotal conocido':totals.labor_usd==null?'Total estimado (sin labor)':'Total estimado'}</strong>
            <strong data-testid="estimate-total">{money.formatUsd(totals.known_total_usd)}</strong></div>
          {totals.per_ha_display&&<div className="planning-cost-estimate-row"><span>Estimado / ha{totals.labor_usd==null?' (sin labor)':''}</span><span data-testid="estimate-per-ha">{totals.per_ha_display}</span></div>}
        </div>
      </>}
    </>}
  </section>;
}
export default function PlanningCostEstimate({planning,user}) {
  return canEstimatePlanning(planning,user)?<Estimate key={planning.id} planningId={planning.id}/>:null;
}

import React from 'react';
import {Alert,Form,Input,Select,DatePicker,Typography} from 'antd';
import {hasPermission} from '../../../utils/permissions';
import {economicEditPermissions,requiresBeneficiary} from '../planningEconomics.mjs';
import './planningEconomics.css';
export function LaborFields({form,prefix='economicLabor',allowKeep=false}) {
 const status=Form.useWatch([prefix,'status'],form)|| (allowKeep?'unchanged':'pending');
 const currency=Form.useWatch([prefix,'currency'],form);
 const confirmed=status==='confirmed';
 return <div className="planning-economics-form">
  <Form.Item name={[prefix,'status']} label="Estado de la labor" initialValue={allowKeep?'unchanged':'pending'}>
   <Select options={[...(allowKeep?[{value:'unchanged',label:'Conservar labor actual'}]:[]),
     {value:'pending',label:'Pendiente'},{value:'confirmed',label:'Confirmada'},{value:'not_applicable',label:'No corresponde'}]}/>
  </Form.Item>
  {!['unchanged','not_applicable'].includes(status)&&<>
   <Form.Item name={[prefix,'currency']} label="Moneda de la labor" rules={[{required:confirmed,message:'Seleccioná la moneda.'}]}>
    <Select allowClear options={[{value:'USD',label:'USD'},{value:'ARS',label:'ARS'}]}/>
   </Form.Item>
   <Form.Item name={[prefix,'rate_original']} label="Tarifa real por ha" rules={[{required:confirmed,message:'Ingresá la tarifa.'},{pattern:/^\d{1,14}([.,]\d{1,6})?$/,message:'Ingresá un importe no negativo, hasta seis decimales.'}]}>
    <Input inputMode="decimal" placeholder="Pendiente"/>
   </Form.Item>
   <Form.Item name={[prefix,'payment_date']} label="Fecha de pago" rules={[{required:confirmed&&currency==='ARS',message:'ARS requiere fecha de pago.'}]}>
    <DatePicker format="DD/MM/YYYY"/>
   </Form.Item>
   {currency==='ARS'&&<>
    <Typography.Paragraph type="secondary">Divisa mayorista de la fecha de pago. Carga manual en ARS por USD.</Typography.Paragraph>
    <Form.Item name={[prefix,'fx_rate']} label="Cotización · ARS por USD" rules={[{required:confirmed,message:'Ingresá la cotización.'},{pattern:/^\d{1,14}([.,]\d{1,6})?$/,message:'Cotización inválida.'},
      {validator:(_,v)=>v==null||v===''||/[1-9]/.test(v)?Promise.resolve():Promise.reject(Error('La cotización debe ser mayor a cero.'))}]}>
     <Input inputMode="decimal"/>
    </Form.Item>
    <Form.Item name={[prefix,'fx_date']} label="Fecha de cotización" dependencies={[[prefix,'payment_date']]} rules={[{required:confirmed,message:'Indicá la fecha de cotización.'},
      ({getFieldValue})=>({validator:(_,v)=>!confirmed||!v||!getFieldValue([prefix,'payment_date'])||v.format('YYYY-MM-DD')===getFieldValue([prefix,'payment_date']).format('YYYY-MM-DD')
        ?Promise.resolve():Promise.reject(Error('La cotización debe corresponder a la fecha de pago.'))})]}>
     <DatePicker format="DD/MM/YYYY"/>
    </Form.Item>
    <Form.Item name={[prefix,'fx_source']} label="Fuente de la cotización" rules={[{required:confirmed,whitespace:true,message:'Indicá la fuente.'}]}>
     <Input maxLength={500}/>
    </Form.Item>
   </>}
  </>}
 </div>;
}
export default function ExecutionEconomicFields({planning,crops,user,form}){
 const editable=economicEditPermissions.every(p=>hasPermission(user,p));
 return <section className="planning-economics-form" aria-label="Resumen económico de ejecución">
  <Typography.Title level={5}>Resumen económico</Typography.Title>
  <Typography.Paragraph type="secondary">Los costos de productos se conservarán según las partidas realmente consumidas. Los precios faltantes y la labor pendiente permiten completar el trabajo.</Typography.Paragraph>
  {requiresBeneficiary(planning)&&<Alert type="info" message="Seleccioná el cultivo que recibe el beneficio de este trabajo. Puede diferir del cultivo o rastrojo del lote."/>}
  {(planning.lots||[]).map((lot,index)=><Form.Item key={(lot.lot_id||lot.id)+':'+(lot.sub_lot_id||'')}
    name={['economicTargets',index]} label={'Cultivo beneficiario · '+(lot.lot_name||lot.name||'Lote')+(lot.sub_lot_name?' / '+lot.sub_lot_name:'')}
    initialValue={requiresBeneficiary(planning)?undefined:planning.crop_id}
    rules={[{required:true,message:'Seleccioná el cultivo beneficiario.'}]}>
    <Select showSearch optionFilterProp="label" options={(crops||[]).map(c=>({value:c.id||c._id,label:c.name}))}/>
   </Form.Item>)}
  <Typography.Paragraph type="secondary">Campaña: {planning.campaign_name||planning.campaign?.name||'la indicada en la planificación'}.</Typography.Paragraph>
  {(planning.lots||[]).length>1&&<Alert type="info" message="Prorrateado por superficie. No representa consumo medido por lote."/>}
  {editable?<LaborFields form={form}/>:<Typography.Paragraph type="secondary">La labor quedará pendiente de revisión económica.</Typography.Paragraph>}
 </section>;
}

import React from 'react';
import {Alert,Form,Input,Select,DatePicker,Typography} from 'antd';
import {hasPermission} from '../../../utils/permissions';
import {economicEditPermissions} from '../planningEconomics.mjs';
import './planningEconomics.css';
export function LaborFields({form,prefix='economicLabor',allowKeep=false,compactPending=false}) {
 const status=Form.useWatch([prefix,'status'],form)|| (allowKeep?'unchanged':'pending');
 const currency=Form.useWatch([prefix,'currency'],form);
 const confirmed=status==='confirmed';
 return <div className="planning-economics-form">
  <Form.Item name={[prefix,'status']} label="Estado de la labor" initialValue={allowKeep?'unchanged':'pending'}>
   <Select options={[...(allowKeep?[{value:'unchanged',label:'Conservar labor actual'}]:[]),
     {value:'pending',label:'Pendiente'},{value:'confirmed',label:'Confirmada'},{value:'not_applicable',label:'No corresponde'}]}/>
  </Form.Item>
  {compactPending&&status==='pending'&&<Typography.Paragraph type="secondary">Podés completar el costo de la labor después.</Typography.Paragraph>}
  {!['unchanged','not_applicable'].includes(status)&&(!compactPending||status!=='pending')&&<>
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


export default function ExecutionEconomicFields({
  planning,
  crops,
  user,
  form,
  showTargets = true,
  showLabor = true,
  compact = false,
}) {
  const editable = economicEditPermissions.every((permission) =>
    hasPermission(user, permission)
  );

  const lots = planning.lots || [];

  // El cultivo general de Planning es la fuente por defecto.
  // Los campos por lote aparecen solamente cuando existen varios destinos
  // y sirven como excepción cuando alguno beneficia a otro cultivo.
  const showPerLotTargets = showTargets && lots.length > 1;

  if (!showPerLotTargets && !showLabor) {
    return null;
  }

  return (
    <section
      className="planning-economics-form"
      aria-label="Resumen económico de ejecución"
    >
      {!compact && (
        <Typography.Title level={5}>
          Resumen económico
        </Typography.Title>
      )}

      {!compact && (
        <Typography.Paragraph type="secondary">
          Los costos de productos se conservarán según las partidas
          realmente consumidas. Los precios faltantes y la labor pendiente
          permiten completar el trabajo.
        </Typography.Paragraph>
      )}

      {showPerLotTargets && (
        <Alert
          type="info"
          message="El cultivo beneficiario general se aplicará a todos los lotes. Cambialo solamente en los destinos que beneficien a otro cultivo."
        />
      )}

      {showPerLotTargets &&
        lots.map((lot, index) => (
          <Form.Item
            key={
              (lot.lot_id || lot.id) +
              ":" +
              (lot.sub_lot_id || "")
            }
            name={["economicTargets", index]}
            label={
              "Cultivo beneficiario · " +
              (lot.lot_name || lot.name || "Lote") +
              (lot.sub_lot_name
                ? " / " + lot.sub_lot_name
                : "") +
              " (si difiere)"
            }
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Usar cultivo beneficiario general"
              options={(crops || []).map((crop) => ({
                value: crop.id || crop._id,
                label: crop.name,
              }))}
            />
          </Form.Item>
        ))}

      {!compact && (
        <Typography.Paragraph type="secondary">
          Campaña:{" "}
          {planning.campaign_name ||
            planning.campaign?.name ||
            "la indicada en la planificación"}
          .
        </Typography.Paragraph>
      )}

      {showPerLotTargets && (
        <Alert
          type="info"
          message="Prorrateado por superficie. No representa consumo medido por lote."
        />
      )}

      {showLabor &&
        (editable ? (
          <LaborFields
            form={form}
            compactPending={compact}
          />
        ) : (
          <Typography.Paragraph type="secondary">
            La labor quedará pendiente de revisión económica.
          </Typography.Paragraph>
        ))}
    </section>
  );
}

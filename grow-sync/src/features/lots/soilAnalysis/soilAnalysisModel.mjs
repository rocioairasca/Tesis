export const MAX_PDF_BYTES=10*1024*1024;
export const RESULT_STATUSES=[{value:'measured',label:'Medido'},{value:'not_requested',label:'No requerido'},{value:'qualitative',label:'Cualitativo'}];
export const HIGHLIGHT_PARAMETERS=['pH','Materia Orgánica','Fósforo','N-NO3'];
export const resultText=result=>result.result_status==='not_requested'?'No requerido':result.raw_value;
export const highlights=sample=>HIGHLIGHT_PARAMETERS.flatMap(name=>{const result=sample.results.find(r=>r.parameter_name===name);return result?[{name,text:resultText(result),raw:result.raw_value}]:[];});
export function depthText(sample){const from=sample.depth_from_cm,to=sample.depth_to_cm;if(from!=null&&to!=null)return 'Profundidad '+String(from).replace(/\.0+$/,'')+'–'+String(to).replace(/\.0+$/,'')+' cm';if(from!=null)return 'Desde '+from+' cm';if(to!=null)return 'Hasta '+to+' cm';return 'Profundidad no consignada';}
export const emptySample=(lot_id,sub_lot_id=null)=>({lot_id,sub_lot_id,results:[{result_status:'measured'}]});
const optional=value=>value==null||value===''?null:value;
const date=value=>value?.format?value.format('YYYY-MM-DD'):optional(value);
export function reportPayload(values){
 return {report_number:optional(values.report_number),laboratory:optional(values.laboratory),received_date:date(values.received_date),notes:optional(values.notes),samples:values.samples.map(sample=>({
  lot_id:sample.lot_id,sub_lot_id:optional(sample.sub_lot_id),sample_date:date(sample.sample_date),depth_from_cm:optional(sample.depth_from_cm),depth_to_cm:optional(sample.depth_to_cm),
  sample_name:optional(sample.sample_name),position_description:optional(sample.position_description),sampled_by:optional(sample.sampled_by),notes:optional(sample.notes),
  results:sample.results.map((r,index)=>({parameter_name:r.parameter_name,method:optional(r.method),unit:optional(r.unit),raw_value:r.raw_value,numeric_value:r.result_status==='not_requested'?null:optional(r.numeric_value),result_status:r.result_status||'measured',sort_order:index})),
 }))};
}
export function validatePdf(file){if(!file)throw new Error('Seleccioná el PDF original.');if(file.type!=='application/pdf')throw new Error('Seleccioná un archivo PDF.');if(!file.size||file.size>MAX_PDF_BYTES)throw new Error('El PDF debe estar entre 1 byte y 10 MB.');}
export function historyRows(reports,lotId,subLotId){return reports.flatMap(report=>report.samples.filter(sample=>sample.lot_id===lotId&&(!subLotId||(subLotId==='full'?!sample.sub_lot_id:sample.sub_lot_id===subLotId))).map(sample=>({...sample,key:report.id+':'+sample.id,report}))).sort((a,b)=>b.sample_date.localeCompare(a.sample_date));}
export function safePdfUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}}

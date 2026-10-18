import {formatNumber} from '../../../utils/numberFormat.js';
export const MAX_PDF_BYTES=10*1024*1024;
export const RESULT_STATUSES=[{value:'measured',label:'Medido'},{value:'not_requested',label:'No requerido'},{value:'qualitative',label:'Cualitativo'}];
export const HIGHLIGHT_PARAMETERS=['pH','Materia Orgánica','Fósforo','N-NO3'];
// Keep decimal strings exact when their precision exceeds JavaScript Number.
const decimalText=value=>String(value).replace(/^\+/, '').replace(',', '.').replace(/^(-?)0+(?=\d)/,'$1').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
export function resultText(result={}){
 const numeric=result.numeric_value;
 if(numeric!=null&&numeric!==''&&Number.isFinite(Number(numeric))){
  const canonical=decimalText(numeric);
  if(/^-?\d{1,14}(?:\.\d{1,6})?$/.test(canonical)&&decimalText(Number(canonical))!==canonical){
   const [whole,fraction]=canonical.split('.');return formatNumber(whole,0)+(fraction?','+fraction:'');
  }
  return formatNumber(numeric,6);
 }
 return typeof result.raw_value==='string'?result.raw_value:'';
}
export function editedResult(raw_value){
 const text=raw_value.trim();let numeric_value=null;
 // Decimal separator only: no grouping, comparisons, exponents or partial parsing.
 if(/^[+-]?\d{1,14}(?:[.,]\d{1,6})?$/.test(text)){
  const canonical=decimalText(text),number=Number(canonical);
  numeric_value=decimalText(number)===canonical?number:canonical;
 }
 return {raw_value,numeric_value,result_status:numeric_value==null?'qualitative':'measured'};
}
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
const normalizedSearch=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function historyRows(reports,lotId,subLotId,search=''){
 const query=normalizedSearch(search);
 return reports.flatMap(report=>report.samples.filter(sample=>(!lotId||sample.lot_id===lotId)&&(!subLotId||(subLotId==='full'?!sample.sub_lot_id:sample.sub_lot_id===subLotId))).filter(sample=>!query||[report.report_number,report.laboratory,sample.sample_name].some(value=>normalizedSearch(value).includes(query))).map(sample=>({...sample,key:report.id+':'+sample.id,report}))).sort((a,b)=>String(b.sample_date||'').localeCompare(String(a.sample_date||'')));}
export function safePdfUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}}

// Extraction is a proposal. Even in a contextual view, lot/division must be selected manually.
export function extractionValues(data,parseDate){
 return {report_number:data.report_number,laboratory:data.laboratory,received_date:parseDate(data.received_date),notes:data.notes,samples:data.samples.length?data.samples.map(s=>({...s,lot_id:null,sub_lot_id:null,sample_date:parseDate(s.sample_date)})):[emptySample(null)]};
}

// Informational entries are explicitly marked by the backend; legacy/unclassified
// warnings remain review items. The API continues to return string[].
export function extractionMessages(warnings=[]){
 const info=[],review=[];
 for(const warning of warnings){if(warning.startsWith('Información: '))info.push(warning.slice('Información: '.length));else review.push(warning);}
 return {info,review};
}

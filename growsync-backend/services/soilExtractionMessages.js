// Keep the existing string[] contract. Only backend-generated informational texts
// carry this human-readable prefix; unclassified provider observations require review.
const INFO_PREFIX='Información: ';
const plain=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const compact=value=>String(value).replace(/\s+/g,' ').trim();
const short=value=>{const text=compact(value);return text.length>70?text.slice(0,69)+'…':text;};
function sampleScope(data,index,text){
 const headers=[...text.matchAll(/(?:^|\n)\s*Muestra(?:\s+\d+)?\s*[:=–-]\s*([^\n]+)/gi)];
 if(data.samples.length===1&&headers.length<=1)return text;
 const name=data.samples[index]?.sample_name;if(!name)return null;
 const matches=headers.filter(h=>compact(h[1])===compact(name));
 if(matches.length!==1)return null;
 const start=matches[0].index,next=headers.find(h=>h.index>start);
 return text.slice(start,next?.index??text.length);
}
function createMessages(data,text){
 const messages=new Map();
 const add=(type,message)=>messages.set(message,type);
 const info=message=>add('info',message),review=message=>add('review',message);
 const context=(field,index)=>index==null?field:data.samples[index]?.sample_name?field+' · '+short(data.samples[index].sample_name):field+' de la muestra '+(index+1);
 const unconfirmed=(label)=>review(label+': el valor propuesto no se pudo confirmar en el PDF. GrowSync dejó el campo vacío. Revisalo antes de guardar.');
 const depthAbsence=index=>sampleScope(data,index,text)?.match(/\bProfundidad(?:\s*\([^)]{0,30}\))?\s*[:=–-]?\s*(NO CONSIGNADO|NO CONSIGNA|NO INFORMADO)\b/i)?.[1];
 const depth=(index,proposed,partial)=>{
  const label=context('Profundidad',index),scope=sampleScope(data,index,text);
  const absent=depthAbsence(index);
  if(absent){info(label+': el informe indica “'+absent.toUpperCase()+'”. GrowSync dejó este campo vacío.');if(proposed)unconfirmed(label);return;}
  if(proposed||partial||scope==null||/\bprofundidad\b/i.test(scope)){
   review(label+': no se pudo identificar un rango completo con claridad en el PDF. GrowSync '+(partial?'conservó solo los valores confirmados.':'dejó este campo vacío.')+' Revisá la profundidad antes de guardar.');return;
  }
  info(label+': el informe no incluye este dato. Podés dejar el campo vacío.');
 };
 function provider(warnings){
  for(const warning of warnings){
   const normalized=plain(warning),ambiguous=/ambigu|dos (?:posibles )?fechas|varias fechas|discrepan|contradic|conflict|asoci|incertid|ilegible|dud|sin defin|no.{0,30}(?:aclar|defin)/.test(normalized);
   const sampleNumber=normalized.match(/muestra\s+(\d+)/),named=data.samples.map((sample,index)=>({sample,index})).filter(({sample})=>sample.sample_name&&normalized.includes(plain(sample.sample_name)));
   const index=sampleNumber&&Number(sampleNumber[1])<=data.samples.length&&Number(sampleNumber[1])>0?Number(sampleNumber[1])-1:named.length===1?named[0].index:undefined;
   // Common redundant model notices are already explained from document evidence.
   if(!ambiguous&&/\bn\.?\s*r\.?(?![a-z])/.test(normalized)&&/omit|no requerid/.test(normalized))continue;
   if(!ambiguous&&/profundidad|depth_|fecha de muestreo|sample_date/.test(normalized)&&[...messages.keys()].some(message=>message.startsWith(context(/profundidad|depth_/.test(normalized)?'Profundidad':'Fecha de muestreo',index??(data.samples.length===1?0:undefined))+':')))continue;
   const optionalFields=[[/notas|notes/,'notes'],[/laboratorio|laboratory/,'laboratory'],[/numero de informe|report_number/,'report_number'],[/fecha de recepcion|received_date/,'received_date'],[/posicion|position_description/,'position_description'],[/enviado|muestreado por|sampled_by/,'sampled_by']];
   const optionalKey=optionalFields.find(([pattern])=>pattern.test(normalized))?.[1];
   const optionalValue=index!=null?data.samples[index]?.[optionalKey]:data[optionalKey];
   if(!ambiguous&&optionalKey&&optionalValue==null&&/no (?:se pudo (?:verificar|confirmar)|se encontro|incluye|contiene|figura|consign)|ausen|null/.test(normalized))continue;

   if(/\bn\.?\s*r\.?(?![a-z])/.test(normalized)){review(context('Resultados',index)+': el significado de N.R. no está aclarado con seguridad. Compará estos resultados con la leyenda del PDF antes de guardar.');continue;}
   const fields=[[/profundidad|depth_/,'Profundidad'],[/fecha|date/,'Fechas'],[/notas|notes/,'Notas'],[/laboratorio|laboratory/,'Laboratorio'],[/numero de informe|report_number/,'Número de informe'],[/resultado|raw_value|numeric_value|result_status/,'Resultados'],[/muestra|sample|estructura|asoci/,'Muestras y resultados']];
   const label=context(fields.find(([pattern])=>pattern.test(normalized))?.[1]||'Datos del informe',index);
   const detail=/dos (?:posibles )?fechas|varias fechas/.test(normalized)?'hay más de una interpretación posible de la fecha. Revisá cuál corresponde antes de guardar.':/asoci|estructura/.test(normalized)?'no se pudo asociar con seguridad cada dato a su muestra. Compará las muestras y sus resultados con el PDF antes de guardar.':'la lectura del PDF dejó una duda que GrowSync no pudo resolver. Compará estos datos con el informe original antes de guardar.';
   review(label+': '+detail);
  }
 }
 return {info,review,context,unconfirmed,depth,depthAbsence,provider,
  values:()=>[...messages].sort((a,b)=>(a[1]==='info')-(b[1]==='info')).slice(0,30).map(([message,type])=>(type==='info'?INFO_PREFIX:'')+message)};
}
module.exports={createMessages,INFO_PREFIX};

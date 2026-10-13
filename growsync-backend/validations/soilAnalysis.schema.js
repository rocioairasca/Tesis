const {z}=require('zod');
const fail=message=>Object.assign(new Error(message),{status:400});
function decimalInput(value,{scale=6,whole=14,nonnegative=false}={}){
 if(value==null||value==='')return null;
 const text=String(value).trim().replace(',','.');
 const expression=new RegExp('^'+(nonnegative?'':'-?')+'\\d{1,'+whole+'}(?:\\.\\d{1,'+scale+'})?$');
 if(!expression.test(text))throw fail('Ingresá un valor decimal válido con hasta '+scale+' decimales.');
 return text;
}
const numberField=options=>z.union([z.string(),z.number()]).nullable().optional().transform((value,ctx)=>{
 try{return decimalInput(value,options);}catch(error){ctx.addIssue({code:'custom',message:error.message});return z.NEVER;}
});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Ingresá una fecha válida.').refine(value=>{
 const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
},'Ingresá una fecha válida.');
const text=z.string().max(4000).nullable().optional();
const result=z.object({parameter_name:z.string().trim().min(1).max(200),method:text,unit:z.string().max(100).nullable().optional(),
 raw_value:z.string().max(4000).refine(value=>value.trim().length>0,'Ingresá el resultado original.'),numeric_value:numberField(),
 result_status:z.enum(['measured','not_requested','qualitative']).default('measured'),sort_order:z.number().int().min(0).max(10000).default(0),
}).strict().superRefine((value,ctx)=>{if(value.result_status==='not_requested'&&value.numeric_value!=null)ctx.addIssue({code:'custom',message:'Un resultado no requerido no puede tener valor numérico.',path:['numeric_value']});});
const sample=z.object({lot_id:z.string().uuid(),sub_lot_id:z.string().uuid().nullable().optional(),sample_date:date,
 depth_from_cm:numberField({scale:2,whole:6,nonnegative:true}),depth_to_cm:numberField({scale:2,whole:6,nonnegative:true}),
 sample_name:text,position_description:text,sampled_by:text,notes:text,results:z.array(result).min(1).max(100),
}).strict().superRefine((value,ctx)=>{
 const micro=v=>{const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
 if(typeof value.depth_from_cm==='string'&&typeof value.depth_to_cm==='string'&&micro(value.depth_to_cm)<micro(value.depth_from_cm))ctx.addIssue({code:'custom',message:'La profundidad hasta debe ser mayor o igual a desde.',path:['depth_to_cm']});
});
const metadata=z.object({report_number:z.string().max(200).nullable().optional(),laboratory:z.string().max(200).nullable().optional(),received_date:date.nullable().optional(),notes:text,samples:z.array(sample).min(1).max(20)}).strict();
const query=z.object({lot_id:z.string().uuid().optional(),sub_lot_id:z.string().uuid().optional(),from:date.optional(),to:date.optional(),
 enabled:z.enum(['true','false','all']).optional(),includeDisabled:z.enum(['true','false']).optional(),
}).strict().superRefine((value,ctx)=>{if(value.from&&value.to&&value.from>value.to)ctx.addIssue({code:'custom',message:'La fecha desde no puede ser posterior a hasta.'});});
const fieldMessages={samples:'Agregá al menos una muestra válida.',results:'Agregá al menos un resultado válido.',lot_id:'Seleccioná un lote válido.',sub_lot_id:'Seleccioná una división válida.',sample_date:'Ingresá una fecha de muestreo válida.',received_date:'Ingresá una fecha de recepción válida.',parameter_name:'Ingresá el nombre del parámetro.',raw_value:'Ingresá el resultado original.',result_status:'Seleccioná un estado del resultado válido.',from:'Ingresá una fecha desde válida.',to:'Ingresá una fecha hasta válida.'};
function parse(schema,value){
 const result=schema.safeParse(value);
 if(!result.success)throw fail(result.error.issues.slice(0,3).map(issue=>{
  if(issue.code==='custom')return issue.message;
  if(issue.code==='unrecognized_keys')return 'No se admiten campos adicionales en este informe.';
  if(issue.code==='too_big')return 'Uno de los campos supera el máximo permitido.';
  return fieldMessages[issue.path.filter(p=>typeof p==='string').at(-1)]||'Revisá los datos ingresados: hay un campo requerido o inválido.';
 }).join(' '));
 return result.data;
}
module.exports={metadata,query,parse,decimalInput,date};

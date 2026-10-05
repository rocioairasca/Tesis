const FIELD_CONTEXTS=['growing_crop','stubble','fallow','pre_sowing','other'];
const CONTEXT_ACTIVITIES=new Set(['fumigacion','fertilizacion']);
function validateFieldContext(activity,cropId,context,{creating=false}={}) {
  const fail=message=>{throw Object.assign(new Error(message),{status:400});};
  if(context!=null && !FIELD_CONTEXTS.includes(context)) fail('Seleccioná una situación del lote válida.');
  if(creating && CONTEXT_ACTIVITIES.has(activity) && context==null) fail('Seleccioná la situación del lote.');
  const requiresCrop=activity==='siembra' || activity==='cosecha' || (
    context==null ? CONTEXT_ACTIVITIES.has(activity) : ['growing_crop','stubble'].includes(context)
  );
  if(requiresCrop && !cropId) fail(context==='stubble' ? 'Seleccioná de qué cultivo proviene el rastrojo.' : 'Seleccioná un cultivo.');
  return activity==='siembra' ? null : (context ?? null);
}
function cropDescription(activity,context,name) {
  if(activity==='siembra' || context==null)return name ? ' para '+name : '';
  switch(context){
    case 'stubble':return name ? ' sobre rastrojo de '+name : ' sobre rastrojo';
    case 'growing_crop':return name ? ' sobre cultivo implantado de '+name : '';
    case 'pre_sowing':return name ? ' en pre-siembra de '+name : ' en pre-siembra';
    case 'fallow':return ' en barbecho';
    default:return name ? ' con cultivo relacionado '+name : '';
  }
}
module.exports={FIELD_CONTEXTS,CONTEXT_ACTIVITIES,validateFieldContext,cropDescription};

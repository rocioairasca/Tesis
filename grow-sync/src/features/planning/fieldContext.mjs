export const FIELD_CONTEXT_OPTIONS=[
  {value:'growing_crop',label:'Cultivo implantado'},
  {value:'stubble',label:'Rastrojo'},
  {value:'fallow',label:'Barbecho'},
  {value:'pre_sowing',label:'Pre-siembra'},
  {value:'other',label:'Otro'},
];
export const hasFieldContext = activity => ['fumigacion','fertilizacion'].includes(activity);
export const cropRequired = (activity,context) => ['siembra','cosecha'].includes(activity) ||
  (context == null ? hasFieldContext(activity) : ['growing_crop','stubble'].includes(context));
export const contextCropLabel = context => ({stubble:'Rastrojo de',pre_sowing:'Cultivo previsto',fallow:'Cultivo relacionado (opcional)',other:'Cultivo relacionado (opcional)'}[context] || 'Cultivo');
export function fieldSituation(row,cropIx={}) {
  if(!row?.field_context || row.activity_type==='siembra')return null;
  const crop=row.crop_name || cropIx[row.crop_id];
  switch(row.field_context){
    case 'growing_crop':return crop ? 'Cultivo implantado: '+crop : 'Cultivo implantado';
    case 'stubble':return crop ? 'Rastrojo de '+crop : 'Rastrojo';
    case 'pre_sowing':return crop ? 'Pre-siembra de '+crop : 'Pre-siembra';
    case 'fallow':return crop ? 'Barbecho · Cultivo relacionado: '+crop : 'Barbecho';
    case 'other':return crop ? 'Otro · Cultivo relacionado: '+crop : 'Otro';
    default:return null;
  }
}

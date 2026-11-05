export const economicReadPermissions=['planning.view','inventory.view'];
export const economicEditPermissions=[...economicReadPermissions,'planning.edit','inventory.edit'];
export const requiresBeneficiary=planning=>planning?.field_context!=='growing_crop'||!planning?.crop_id;
const date=value=>value?.format?value.format('YYYY-MM-DD'):value||null;
export function laborPayload(value){
 if(!value||value.status==='unchanged')return undefined;
 if(value.status==='not_applicable')return {status:'not_applicable'};
 const result={status:value.status||'pending'};
 for(const field of ['currency','rate_original','payment_date','fx_rate','fx_date','fx_source']){
   const v=value[field];
   if(v!=null&&v!=='')result[field]=field.endsWith('_date')?date(v):['rate_original','fx_rate'].includes(field)?String(v).trim().replace(',','.'):String(v).trim();
 }
 if(result.currency==='USD')for(const key of ['fx_rate','fx_date','fx_source'])delete result[key];
 return result;
}
export function executionEconomicPayload(planning,values,canEdit) {
 const result={};
 const targets=(planning.lots||[]).map((lot,index)=>({
  lot_id:lot.lot_id||lot.id,sub_lot_id:lot.sub_lot_id||null,
  beneficiary_crop_id:values.economicTargets?.[index]||(requiresBeneficiary(planning)?null:planning.crop_id)
 }));
 if(targets.some(t=>!t.beneficiary_crop_id))throw Error('Seleccioná el cultivo beneficiario de cada destino.');
 result.targets=targets;
 if(canEdit){const labor=laborPayload(values.economicLabor);if(labor)result.labor=labor;}
 return result;
}

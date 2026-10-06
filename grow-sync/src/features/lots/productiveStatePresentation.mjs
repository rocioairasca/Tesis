export const conflictMessage = 'Estado confirmado con historial pendiente de revisar';
export function stateLabel(unit) {
  const s=unit?.state;
  if(!s)return unit?.current_crop?.crop_name||'Estado no determinado';
  if(s.kind==='growing_crop')return s.crop?.name||'Estado no determinado';
  if(s.kind==='stubble')return s.crop?.name?`Rastrojo de ${s.crop.name}`:'Estado no determinado';
  return s.kind==='fallow'?'Barbecho':'Estado no determinado';
}
export const unitCropName=unit=>unit?.state?unit.state.crop?.name||null:unit?.current_crop?.crop_name||null;
export const unitCampaign=unit=>!unit?.state||
  (unit.state.source==='derived'&&unit.state.kind==='growing_crop'&&unit.state.crop?.id===unit.current_crop?.crop_id)?unit?.current_crop:null;
export function observedLabel(unit){
  const day=unit?.state?.source==='declaration'?unit.state.observed_on:null;
  return day?`Confirmado el ${day.slice(8,10)}/${day.slice(5,7)}/${day.slice(0,4)}`:null;
}

export const effectiveArea = lot => Number(lot?.effective_area_ha ?? lot?.area_ha ?? 0);
export const partialAreaAllowed = activity => ['fumigacion','fertilizacion','riego','mantenimiento','otro'].includes(activity);
const number = value => Number(value || 0).toLocaleString('es-AR',{maximumFractionDigits:4});
export const selectionAreaLabel = lot => effectiveArea(lot) === Number(lot?.area_ha || 0)
  ? number(effectiveArea(lot))+' ha'
  : number(effectiveArea(lot))+' ha trabajadas de '+number(lot.area_ha)+' ha';

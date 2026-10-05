import {hasFieldContext} from './fieldContext.mjs';
const dateKey=value=>value?.format ? value.format('YYYY-MM-DD') : String(value || '').slice(0,10);
export const durationMode=(start,end)=>start && end && dateKey(start)!==dateKey(end) ? 'period' : 'day';
export const changeDuration=(range=[],mode)=>mode==='day' ? [range?.[0] || null,range?.[0] || null] : [range?.[0] || null,range?.[1] || null];
export function validatedDateRange(range,mode='day') {
 const dates=changeDuration(range,mode),[start,end]=dates;
 if(!start || !end)throw new Error(mode==='day' ? 'Seleccioná la fecha.' : 'Seleccioná las fechas desde y hasta.');
 if(dateKey(end)<dateKey(start))throw new Error('La fecha hasta no puede ser anterior a la fecha desde.');
 return dates;
}
export const activityChangeFields=activity=>hasFieldContext(activity) ? {} : {field_context:null};

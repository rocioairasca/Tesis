import { formatNumber } from '../../utils/numberFormat.js';
export const formatRain = value => formatNumber(value);
const currentMonth = now => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Cordoba',year:'numeric',month:'2-digit'}).format(now);
const key = (year,month) => `${year}-${String(month+1).padStart(2,'0')}`;
export function rainSummary(rows, now = new Date()) {
  const month = currentMonth(now);
  return {month:rows.filter(row=>row.month===month).reduce((sum,row)=>sum+Number(row.rain_mm),0),year:rows.filter(row=>row.month.startsWith(month.slice(0,4)+'-')).reduce((sum,row)=>sum+Number(row.rain_mm),0)};
}
export function rainPeriod(rows, period, now = new Date()) {
  const [year,month] = currentMonth(now).split('-').map(Number);
  const count = period==='year'?month:Number(period);
  const values = new Map(rows.map(row=>[row.month,Number(row.rain_mm)]));
  return Array.from({length:count},(_,index)=>{
    const date = new Date(Date.UTC(year,month-count+index,1));
    const monthKey = key(date.getUTCFullYear(),date.getUTCMonth());
    return {month:monthKey,label:new Intl.DateTimeFormat('es-AR',{month:'short',timeZone:'UTC'}).format(date),rain_mm:values.get(monthKey)??0,recorded:values.has(monthKey)};
  });
}

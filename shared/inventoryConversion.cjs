const catalog=require('./inventoryUnits.json');
const aliases={...catalog.legacyAliases,liters:'L',cc:'mL'};
const canonical=u=>typeof u==='string'?(aliases[u.trim()]||u.trim()):null;
const units={kg:['mass',1000n],g:['mass',1n],L:['volume',1000n],mL:['volume',1n],unit:['unit',1n],bag:['bag',1n]};
const fail=message=>Object.assign(new Error(message),{status:400});
function decimalText(value){
  const s=String(value??'').trim().replace(',','.');
  if(!/^\d{1,14}(\.\d{1,6})?$/.test(s))throw fail('Ingresá una cantidad sin separadores de miles y con hasta seis decimales.');
  return s;
}
const micros=s=>{const [a,b='']=s.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
const format=n=>`${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`;
function normalizeQuantity({quantity,inputUnit,productUnit,allowZero=false}){
  const entered_quantity=decimalText(quantity),entered_unit=canonical(inputUnit??productUnit),base=canonical(productUnit);
  if(!units[base]||!units[entered_unit]||units[base][0]!==units[entered_unit][0])throw fail('La unidad seleccionada no es compatible con este producto.');
  const source=micros(entered_quantity);
  if(source===0n&&!allowZero)throw fail('La cantidad debe ser mayor a cero.');
  const numerator=source*units[entered_unit][1],divisor=units[base][1];
  if(numerator%divisor!==0n)throw fail('La conversión requiere más de seis decimales. Revisá la cantidad ingresada.');
  const normalized=numerator/divisor;
  if(normalized>=100000000000000000000n)throw fail('La cantidad convertida supera el máximo permitido.');
  return {entered_quantity,entered_unit,normalized_quantity:format(normalized),base_unit:productUnit,converted:entered_unit!==base};
}
function compatibleUnits(productUnit){const base=canonical(productUnit);if(!units[base])return [];return [base,...Object.keys(units).filter(u=>u!==base&&units[u][0]===units[base][0])];}
module.exports={normalizeQuantity,compatibleUnits,decimalText,canonical};

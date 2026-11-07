// Six-decimal inputs produce exact twelve-decimal products. Only presentation rounds.
const QUANTITY_SCALE=1000000n, COST_SCALE=1000000000000n;
function parse(value,places,maxWhole=40) {
  const text=String(value ?? '').trim().replace(',','.');
  if(!new RegExp('^\\d{1,'+maxWhole+'}(\\.\\d{1,'+places+'})?$').test(text))
    throw new Error('Ingresá un valor no negativo con hasta '+places+' decimales.');
  const [whole,fraction='']=text.split('.');
  return BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
}
const input=value=>parse(value,6,14);
const cost=value=>parse(value,12);
function costText(value) {
  const fraction=String(value%COST_SCALE).padStart(12,'0').replace(/0+$/,'').padEnd(6,'0');
  return String(value/COST_SCALE)+'.'+fraction;
}
const productCost=(quantity,price)=>input(quantity)*input(price);
function centsText(cents) {
  return (cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+String(cents%100n).padStart(2,'0');
}
const formatUsd=value=>value==null?'—':'USD '+centsText((cost(value)+COST_SCALE/200n)/(COST_SCALE/100n));
function simulateLabor(estimate,rate) {
  const products=cost(estimate.known_products_cost_usd);
  const area=estimate.area_ha==null?null:input(estimate.area_ha);
  const hasRate=rate!=null && String(rate).trim()!=='';
  if(hasRate && (!area || area<=0n)) throw new Error('No hay una superficie válida para simular labor.');
  const labor=hasRate?input(rate)*area:null;
  const known=products+(labor??0n);
  const perHa=area>0n?centsText((known*QUANTITY_SCALE*100n+area*COST_SCALE/2n)/(area*COST_SCALE)):null;
  return {labor_usd:labor==null?null:costText(labor),known_total_usd:costText(known),
    total_usd:estimate.status==='complete'?costText(known):null,
    per_ha_display:estimate.status==='complete' && perHa!=null?'USD '+perHa:null};
}
module.exports={QUANTITY_SCALE,COST_SCALE,input,cost,costText,productCost,formatUsd,simulateLabor};

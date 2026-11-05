// Synthetic transport only. Real Planning and economic components run unchanged.
import money from '../../shared/costEstimate.cjs';
export function configureEconomicFixture(rows,user,mode){
 if(!mode)return;
 if(mode!=='denied')user.custom_permissions.push('inventory.view');
 if(!['readonly','denied'].includes(mode))user.custom_permissions.push('inventory.edit');
 for(const row of rows){
  if(row.status!=='cancelado')row.status=row.status_effective='en_progreso';
  row.activity_type='fumigacion';row.crop_id='crop';row.crop_name='Maíz';row.campaign_name='2026';
  row.field_context=mode==='stubble'?'stubble':'growing_crop';
  row.lots=[{id:'lot',lot_id:'lot',name:'Lote A',area_ha:100,effective_area_ha:60},{id:'lot-b',lot_id:'lot-b',name:'Lote B',area_ha:40,effective_area_ha:33}];
  row.products=[{id:'pp',planning_product_id:'pp',product_id:'product',name:'Glifosato',amount:'186',unit:'L',available_quantity:200}];
 }
 window.__economicHistory={};window.__economicFail=mode==='error';
 if(['readonly','denied','error','existing'].includes(mode)){
  const row=rows[20];row.status=row.status_effective='completado';
  window.__economicHistory[row.id]=[build(row,{labor:{status:'confirmed',currency:'USD',rate_original:'6'}},1,mode)];
 }
}
function labor(data){
 if(data?.status==='not_applicable')return null;
 data=data||{status:'pending'};
 const amount=data.rate_original?money.productCost(data.rate_original,'93'):null;
 let usd=data.status==='confirmed'?amount:null;
 if(usd!=null&&data.currency==='ARS')usd=usd*money.QUANTITY_SCALE/money.input(data.fx_rate);
 return {id:'labor',kind:'labor',cost_status:data.status,area_ha:'93',...data,
  amount_usd:usd==null?null:money.costText(usd),amount_original:amount==null?null:money.costText(amount)};
}
function totals(value){
 const products=value.lines.filter(l=>l.kind==='product'),known=products.reduce((n,l)=>n+(l.amount_usd?money.cost(l.amount_usd):0n),0n);
 const sum=value.lines.reduce((n,l)=>n+(l.amount_usd?money.cost(l.amount_usd):0n),0n);
 const pending=value.lines.some(l=>l.cost_status==='pending'),any=value.lines.some(l=>l.cost_status==='confirmed');
 value.snapshot.economic_status=pending?(any?'partial':'pending'):'complete';
 return {...value,pending_product_lines:products.filter(l=>l.cost_status==='pending').length,
  known_products_cost_usd:money.costText(known),known_total_usd:money.costText(sum),total_cost_usd:pending?null:money.costText(sum),
  cost_per_ha_usd:pending?null:money.costText(sum/93n),area_ha:'93',
  comparison_unavailable_reason:'No se conservó un preventivo antes de esta ejecución.'};
}
function build(row,input,revision,mode){
 const pending=mode==='partial';
 const laborRow=labor(input.labor);
 return totals({snapshot:{id:'snapshot-'+revision,revision,campaign_id:row.campaign_id,effective_date:'2026-11-05',labor_status:input.labor?.status||'pending',
  created_by:'Actor',created_at:'2026-11-05',reason:revision>1?'Factura recibida':null},
  lines:[{id:'line-'+revision,kind:'product',product_name_snapshot:'Glifosato',quantity:'186',unit_snapshot:'L',batch_id:'partida-real',
   unit_cost_usd:pending?null:'1',cost_status:pending?'pending':'confirmed',amount_usd:pending?null:'186'},...(laborRow?[laborRow]:[])],
  targets:row.lots.map((l,i)=>({id:'target-'+i,lot_id:l.lot_id,lot_name_snapshot:l.name,crop_name_snapshot:input.targets?.[i]?.beneficiary_crop_id==='soy'?'Soja':'Maíz',
   beneficiary_crop_id:input.targets?.[i]?.beneficiary_crop_id||'crop',applied_area_ha:String(l.effective_area_ha),allocation_method:'area_proportional'}))});
}
export function economicRequest(config,rows,mode){
 if(!mode)return undefined;
 const row=rows.find(r=>config.url.startsWith('/planning/'+r.id+'/'));
 if(!row)return undefined;
 const economic=config.url.includes('/economics'),execute=/\/complete-(work|sowing|activity)$/.test(config.url);
 if(!economic&&!execute)return undefined;
 const history=window.__economicHistory[row.id]||[];
 if(config.method==='get'){
  window.__requests.push({path:config.url,params:config.params||{}});
  if(window.__economicFail)throw Error('Synthetic economic failure');
  const page=Number(config.params?.page||1);
  return config.url.endsWith('/history')?{data:history.slice((page-1)*25,page*25),page,pageSize:25}:{current:history[0]||null};
 }
 const body=JSON.parse(config.data||'{}');
 window.__mutations.push({method:config.method,path:config.url,body,headers:config.headers});
 if(execute){
  row.status=row.status_effective='completado';row.effective_date=body.effective_date;
  const r=build(row,body.economic,1,mode);window.__economicHistory[row.id]=[r];
  return {ok:true,message:'Trabajo completado.'};
 }
 if(config.url.endsWith('/revisions')){
  const r=structuredClone(history[0]);r.snapshot.id='snapshot-'+(history.length+1);r.snapshot.revision=history.length+1;r.snapshot.reason=body.reason;
  if(body.labor){r.lines=r.lines.filter(l=>l.kind!=='labor');const l=labor(body.labor);if(l)r.lines.push(l);r.snapshot.labor_status=body.labor.status;}
  if(window.__invoiceAvailable)r.lines.filter(l=>l.kind==='product'&&l.cost_status==='pending').forEach(l=>{l.cost_status='confirmed';l.amount_usd='186';});
  const current=totals(r);history.unshift(current);return {current};
 }
 throw Error('Unexpected economic write');
}

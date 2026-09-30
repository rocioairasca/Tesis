// Offline report only. No database connection; no source backup edits.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const backup=path.join(root,'audit/don-santiago-pre-reset/20260916T175923749Z');
const read=t=>JSON.parse(fs.readFileSync(path.join(backup,'data',t+'.json'),'utf8'));
const checked=[];
for(const line of fs.readFileSync(path.join(backup,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/)){
  const [,expected,relative]=line.match(/^([a-f0-9]{64})\s+(.+)$/);
  const full=path.resolve(backup,relative);assert.ok(full.startsWith(backup+path.sep));
  const actual=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');assert.equal(actual,expected,relative);checked.push(relative);
}
const source=JSON.parse(fs.readFileSync(path.join(root,'docs/don-santiago-stock-initial-simulation.json'),'utf8'));
const products=read('products'),pp=read('planning_products'),usages=read('usage_records'),planning=read('planning');
const pmap=new Map(products.map(p=>[p.id,p]));
const pendingNames=new Set([16,21,22,34]);
const seven=source.rows.filter(r=>!r.candidates.some(c=>c.preview_valid));
assert.equal(seven.length,7);
const rows=source.rows.map(r=>{
  const technicallyValid=r.candidates.some(c=>c.preview_valid);
  const status=!technicallyValid||pendingNames.has(r.line)?'BLOCKED':r.candidates.length>1?'REVIEW_DUPLICATE':'READY';
  return {...r,status,technical_preview_valid:technicallyValid,proposed_quantity:technicallyValid?r.quantity:null,
    proposed_unit:technicallyValid?r.unit:null,selected_product_id:null};
});
const groups=['Glifosato','MSO','2,4','Finesse','Atrazina'].map(group=>{
  const candidates=products.filter(p=>group==='2,4'?/^2,4 ?D EHE$/i.test(p.name):p.name.startsWith(group));
  const detail=candidates.map(p=>({...p,
    planning_references:pp.filter(v=>v.product_id===p.id).map(v=>({planning_product_id:v.id,planning_id:v.planning_id,amount:v.amount,unit:v.unit,title:planning.find(z=>z.id===v.planning_id)?.title,effective_date:planning.find(z=>z.id===v.planning_id)?.effective_date})),
    usage_references:usages.filter(v=>v.product_id===p.id).map(v=>({id:v.id,amount:v.amount_used,unit:v.unit,date:v.date,planning_id:v.source_planning_id}))}));
  const enabled=detail.filter(p=>p.enabled).sort((a,b)=>(b.planning_references.length+b.usage_references.length)-(a.planning_references.length+a.usage_references.length));
  const tied=enabled.length>1&&(enabled[0].planning_references.length+enabled[0].usage_references.length)===(enabled[1].planning_references.length+enabled[1].usage_references.length);
  return {group,candidates:detail,recommended_id:tied?null:enabled[0]?.id??null,
    recommendation:tied?'No hay ventaja por referencias: decisión humana entre activos.':'Recomendación pendiente de aprobación: activo con continuidad de referencias. No valida su saldo legacy ni su unidad física.'};
});
const purchases=[['Glifosato',38],['Atrazina',100],['MSO',25],['Dicamba',16],['Difimet',62],['Sulfato de Amonio',45]].map(([name,quantity])=>({
  source_product:name,confirmed_quantity:quantity,source_unit:'L',status:'BLOCKED_PENDING_EFFECTIVE_DATE_AND_ID_CONFIRMATION',
  candidates:products.filter(p=>p.name.startsWith(name)).map(p=>({id:p.id,name:p.name,unit:p.unit,enabled:p.enabled})),
  future_payload:{product_id:null,quantity:String(quantity),unit:'L',origin:'purchase',received_date:null,expiration_date:null,unit_price:null,currency:null,supplier:null,reference:null},
  idempotency_key:null,split_by_delivery_and_expiry_if_required:true,
}));
const soy=products.find(p=>p.name==='Semilla Soja para sembrar');
const report={backup_verified_sha256_files:checked.length,backup_timestamp:JSON.parse(fs.readFileSync(path.join(backup,'manifest.json'),'utf8')).backup_timestamp,
  mode:'OFFLINE_ONLY',counts:Object.fromEntries(['READY','BLOCKED','REVIEW_DUPLICATE'].map(s=>[s,rows.filter(r=>r.status===s).length])),
  previous_35_preview_valid:rows.filter(r=>r.technical_preview_valid).map(r=>r.line),previous_7_blocked:seven.map(r=>r.line),rows,duplicates:groups,
  soy:{...soy,planning_references:pp.filter(v=>v.product_id===soy.id),usage_references:usages.filter(v=>v.product_id===soy.id)},purchases};
const out=path.join(root,'docs/don-santiago-final-reconciliation.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const lines=['# Conciliación final para decisión humana — Don Santiago','',
  `Fuente exclusiva: simulación anterior y backup ${report.backup_timestamp}. Integridad verificada: ${checked.length} archivos SHA-256. Sin consultas ni escrituras productivas.`,
  '', '**La expresión anterior «35 READY» no es exacta:** eran 35 líneas con algún candidato que pasaba el preview. Con identidades sin confirmar hay '+report.counts.READY+' READY técnicos, '+report.counts.REVIEW_DUPLICATE+' REVIEW_DUPLICATE y '+report.counts.BLOCKED+' BLOCKED (las 7 originales más 4 equivalencias sin evidencia suficiente). READY no autoriza la carga ni decide un reset.',
  '', '## Las 42 líneas','', '| # / fuente física | Candidato GrowSync / ID | Unidad fuente → producto | Apertura propuesta sin convertir | Vencimiento fuente | Estado |','|---|---|---|---|---|---|'];
for(const r of rows)lines.push(`| ${r.line}. ${r.source_name} | ${r.candidates.map(c=>`${c.name}<br>${c.id}${c.enabled?'':' (deshabilitado)'}`).join('<br>')} | ${r.unit} → ${[...new Set(r.candidates.map(c=>c.unit))].join(', ')} | ${r.proposed_quantity===null?'Pendiente; literal: '+r.quantity+' '+r.unit:r.quantity+' '+r.unit+' (propuesta; ID por confirmar)'} | ${r.expiration_source||'NULL: desconocido'} | ${r.status} |`);
lines.push('', 'No se modificaron cantidades por las anotaciones «sobran» o «faltan». No se convirtió g a kg ni paquete a litros. Para Lambdacialotrina la expresión literal es 5 L + 500 cc; no se propone automáticamente 5,5 L.',
  '', '## Las 35 técnicamente validables y los READY actuales','',
  'Las 35 que pasaban el preview: '+report.previous_35_preview_valid.join(', ')+'.', '',
  'READY técnicos actuales: '+rows.filter(r=>r.status==='READY').map(r=>r.line+'. '+r.source_name).join('; ')+'.',
  '', 'Pasaron preview pero son REVIEW_DUPLICATE: '+rows.filter(r=>r.status==='REVIEW_DUPLICATE').map(r=>r.line+'. '+r.source_name).join('; ')+'.',
  '', 'Pasaron preview pero requieren confirmar nombres: '+rows.filter(r=>pendingNames.has(r.line)).map(r=>r.line+'. '+r.source_name).join('; ')+'.',
  '', '## Las siete bloqueadas originales','',
  '| Hoja / literal | Candidato | Bloqueo | Pregunta en lenguaje común / opciones válidas |','|---|---|---|---|',
  '| Finesse — 1050 g | Tres Finesse en kg; ver tabla de duplicados | Unidad incompatible y dos identidades activas | ¿Confirmás que se contaron 1050 gramos y cuál ficha corresponde al producto físico? Opciones: declarar explícitamente 1,050 kg si confirmás esa equivalencia, o resolver antes un catálogo en gramos. Ninguna conversión se ejecuta aquí. |',
  '| Nicosulfuron granulado — 300 g | Nicosulfuron granulado, 84252f92-6e0f-408c-9cf6-d6ed73e55871, kg | Gramos frente a kilos | ¿Confirmás 300 gramos? Podés aprobar expresamente una declaración de 0,300 kg o resolver previamente la unidad del catálogo. |',
  '| Imazapic para armar — 1 paquete | Imazapic, 47f82237-28b6-4a52-92d5-dd5efa774090, litros | Paquete no identifica volumen, peso ni formulación | ¿Qué dice el envase: nombre completo, formulación y contenido del paquete? Podemos controlar paquetes como presentación real si se incorpora formalmente esa unidad; o usar peso/volumen solo si se conoce y aprobás declararlo. Un paquete no equivale por defecto a 1 L, 1 kg, una bolsa ni una unidad genérica. |',
  '| Lambdacialotrina — 5 L + 500 cc | Lambdacialotrina, 28576c18-e0ca-41b2-9ae1-396e1d69efd7, litros | Expresión compuesta, no número en una sola unidad | ¿Confirmás que el total que querés declarar es 5,5 litros? Otra opción es documentar cantidades por presentaciones y decidir antes su expresión en la unidad base. No se realiza conversión automática. |',
  '| Apron Max fludioxonil — 3 L, vence 03/27 | d5c44c66-8467-42aa-89db-aa852e5c5bd9, litros | Fecha sin día | ¿El envase solo indica marzo de 2027 o hay una fecha completa? Opciones: conservar mes/año con un modelo de precisión explícita, o NULL con mes/año documentado y restricción de uso definida; fecha completa únicamente si existe en la fuente. |',
  '| Maxim Evolution / thiabendazol — 5 L, vence 12/26 | Maxim Evolution tiabendazol, ed325b03-d07b-481f-8ee0-ad6435c92e32, litros | Fecha sin día y nombre por confirmar | ¿Es el mismo Maxim de esa ficha y la etiqueta dice solo diciembre de 2026? Mismas opciones de precisión; sin inventar día. |',
  '| Inoculante para soja Efimax — 18 L, vence 01/27 | Efimax (inoculante para soja), 886effe4-4981-471d-9a50-9103c8f72127, litros | Fecha sin día | ¿La etiqueta dice únicamente enero de 2027 o también un día? Conservar la precisión real, o declarar NULL con información parcial conservada según decisión explícita. |',
  '', '## Duplicados y recomendación pendiente','',
  'Las fechas siguientes son altas digitales, nunca fechas de compra. «Legacy total/disponible» no es una propuesta de apertura. Las referencias se conservan con IDs completos en el JSON adjunto.');
for(const g of groups){
  lines.push('', '### '+g.group,'','| ID / nombre | enabled | Unidad | Planning / Usage | Legacy total / disponible | created_at digital |','|---|---|---|---|---|---|');
  for(const p of g.candidates)lines.push(`| ${p.id}<br>${p.name} | ${p.enabled} | ${p.unit} | ${p.planning_references.length} / ${p.usage_references.length} | ${p.total_quantity} / ${p.available_quantity} | ${p.created_at} |`);
  lines.push('',g.recommended_id?'Identidad principal sugerida: **'+g.recommended_id+'**. '+g.recommendation:g.recommendation);
}
lines.push('', 'Para Finesse la continuidad de referencias no demuestra que el saldo legacy esté en la escala correcta. No conservar una cantidad por el hecho de conservar su ID. Para EHE, sin una ventaja de referencias, no hay fundamento para elegir por la fecha de creación o el orden de la lista.',
  '', '## Equivalencias de nombres','',
  'Percon/Pericon y Perside/Preside: el backup no aporta etiqueta, código comercial o principio activo estructurado que pruebe la equivalencia. La similitud y el texto «flumetsulam» ofrecen un candidato, no una confirmación. Preguntar si la ficha y el envase son el mismo producto.',
  '', 'Mismo criterio para Diflufenican/Diflufenicam, Thiencarbazone metil/Thiencarbazonemetil y Maxim/tiabendazol. Las diferencias de espacios, mayúsculas o descripciones como «herbicida» no cambian una cantidad, pero el manifiesto final igualmente debe revisar los IDs propuestos.',
  '', '## Imazapic y paquete','',
  'La ficha existente está en litros, con total legacy '+pmap.get('47f82237-28b6-4a52-92d5-dd5efa774090').total_quantity+' y disponible '+pmap.get('47f82237-28b6-4a52-92d5-dd5efa774090').available_quantity+'. No contiene información suficiente para deducir el contenido de un paquete. GrowSync admite L, mL, kg, g, unit y bag; no admite paquete como unidad específica. Propuesta: incorporar una unidad de conteo package con presentación documentada si el control real es por paquetes. Es un cambio generalizable, pero primero debe decidirse cómo controlar aperturas y consumos fraccionarios. No implementado.',
  '', '## Vencimientos mes/año: propuesta de producto, no implementada','',
  'Recomiendo un modelo explícito de precisión: expiration_precision = unknown/day/month; expiration_date solo para day; expiration_year y expiration_month para month, con checks que impidan mezclar representaciones. Guardar además la inscripción original si se necesita trazabilidad. La API debe aceptar la precisión declarada y mostrar «03/2027», sin sintetizar un día.',
  '', 'Para FEFO y disponibilidad hay una decisión adicional: una partida con precisión mensual no puede considerarse sin vencimiento por tener expiration_date NULL. Hasta definir la regla aplicable al producto, debe señalarse como fecha parcial y requerir revisión durante el mes indicado. Se puede ordenar por año/mes, pero no afirmar un día de caducidad. Los meses anteriores pueden identificarse como ya transcurridos; el tratamiento exacto debe quedar aprobado como política general.',
  '', 'La alternativa NULL + nota conserva la fuente con menos cambios, pero hoy NULL se interpreta como no vencido en los cálculos: una nota sola no resuelve FEFO ni bloquea consumos. Por eso no recomiendo tratarla como solución definitiva. Cualquier cambio debe alcanzar partidas, preview/confirmación, índices/consultas, alertas y UI, con pruebas. No se implementó en esta tarea.',
  '', '## Semilla de soja posterior','',
  `Ficha: ${soy.id}, ${soy.name}; unidad ${soy.unit}; total legacy ${soy.total_quantity}; disponible ${soy.available_quantity}; alta digital ${soy.created_at}. Referencias: ${report.soy.planning_references.length} Planning y ${report.soy.usage_references.length} Usage.`,
  '', 'Sabemos que no figura en la hoja inicial. No sabemos si 33570 kg es una recepción, varias recepciones, una existencia previa omitida o un valor de carga. La fecha de alta del 13/09 no demuestra compra ni recepción ese día. Preguntar cuándo ingresó físicamente, qué cantidad ingresó en cada entrega y si el total incluye consumo o saldo anterior. No clasificar automáticamente como compra. Si confirman compra posterior, registrar las recepciones reales; si era existencia inicial omitida, resolver con ajuste auditable según el momento de apertura.',
  '', '## Seis compras reales confirmadas: estructura pendiente','',
  '| Producto | Cantidad confirmada | Datos faltantes para registrar |','|---|---|---|');
for(const p of purchases)lines.push(`| ${p.source_product} | +${p.confirmed_quantity} L | Fecha efectiva de cada recepción; ID confirmado; si hubo varias entregas, cantidades por fecha/partida que sumen el total; vencimiento conocido o NULL. Precio, proveedor y comprobante si se tienen. |`);
lines.push('', 'El JSON contiene plantillas PURCHASE deliberadamente no ejecutables: product_id, received_date e Idempotency-Key siguen pendientes. No se asignan fechas de created_at/updated_at. Cada entrega confirmada tendrá su propia clave estable; si se separa por vencimiento, no debe duplicarse la cantidad total.',
  '', '## Preguntas finales antes del reset','',
  '1. ¿Confirmás los IDs principales recomendados para Glifosato, MSO, Finesse y Atrazina, y cuál de las dos fichas activas corresponde a 2,4-D EHE?',
  '2. ¿Percon es Pericon, Perside es Preside y son correctas las equivalencias propuestas para Diflufenican, Thiencarbazone metil y Maxim?',
  '3. ¿Confirmás Finesse 1050 g, Nicosulfuron 300 g y Lambdacialotrina 5 L + 500 cc, y aprobás declararlos expresamente como 1,050 kg, 0,300 kg y 5,5 L respectivamente? Si no, indicar las cantidades/unidades correctas.',
  '4. ¿Qué producto y contenido exacto tiene el paquete de Imazapic, y querés controlar paquetes o su contenido?',
  '5. ¿Apron, Maxim y Efimax tienen solo mes/año? ¿Aprobás diseñar el soporte de vencimiento mensual y su regla de disponibilidad antes de abrir inventario?',
  '6. ¿Cuándo y en qué cantidades ingresó la soja, y era compra posterior o existía al inicio? Para las seis compras confirmadas, ¿cuál fue la fecha y cantidad de cada entrega?',
  '', 'Estas respuestas completan decisiones de datos/producto; no constituyen por sí solas una autorización de reset.',
  '', 'MIGRACIONES EN PRODUCCIÓN: NO APLICADAS.','RESET DON SANTIAGO: NO EJECUTADO.','STOCK INITIAL DON SANTIAGO: NO EJECUTADO.','DATOS PRODUCTIVOS DON SANTIAGO: NO MODIFICADOS.');
fs.writeFileSync(path.join(root,'docs/don-santiago-final-reconciliation.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({verified:checked.length,counts:report.counts,duplicates:groups.map(g=>({group:g.group,recommended:g.recommended_id,candidates:g.candidates.map(c=>({id:c.id,p:c.planning_references.length,u:c.usage_references.length}))})),soy:report.soy},null,2));

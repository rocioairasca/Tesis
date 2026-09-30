// READ ONLY simulation against the existing backup. No DB client or dotenv.
// prepare() is exercised through a SELECT-only in-memory adapter; confirm() is never called.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const initial=require('../services/stockInitialPlan');
const root=path.resolve(__dirname,'../..');
const backup=path.join(root,'audit/don-santiago-pre-reset/20260916T175923749Z/data/products.json');
const products=JSON.parse(fs.readFileSync(backup,'utf8'));
const companyId='2791ea15-7dad-48e2-945b-3791e2d44478';
const actorId='00000000-0000-4000-8000-000000000001'; // Synthetic reviewer, not a tenant user.
const sheet=[
  ['Parakin',80,'L','Parakin'],['Paraquat 5',60,'L','Paraquat'],['Sulfato de amonio',60,'L','Sulfato'],
  ['Glufosinato de Amonio 20',310,'L','Glufosinato'],['Sulfentrazone 50',10,'L','Sulfentrazone'],
  ['Cletodim',10,'L','Cletodim'],['Carbendazim 50',20,'L','Carbendazim 50'],['Carbendazim Thiram',15,'L','Carbendazim Thiram'],
  ['Picloram 24 Rainbow',10,'L','Picloram'],['Terbutilazina 50',20,'L','Terbutilazina'],['Mercantor (herbicida)',5,'L','Mercantor'],
  ['Haloxifop 54',1,'L','Haloxifop'],['Imazetapir 10',150,'L','Imazetapir'],
  ['Lambdacialotrina','5 L + 500 cc','mixta','Lambdacialotrina',null,'Declarar explícitamente una cantidad en la unidad del producto; no se convierte la expresión.'],
  ['Imida lambda',5,'L','Imida lambda'],['Perside (flumetsulam)',4,'L','Preside',null,'Confirmar Perside/Preside.'],
  ['Bifentrin 25',4,'L','Bifentrin'],['Imidacloprid 35',5,'L','Imidacloprid'],['Imida Tebuco',2,'L','Imida Tebuco'],
  ['Imatron',10,'L','Imatron'],['Thiencarbazone metil',3,'L','Thiencarbazonemetil',null,'Confirmar identidad frente a Thiencarbazonemetil.'],
  ['Diflufenican',3,'L','Diflufenicam',null,'Confirmar Diflufenican/Diflufenicam.'],['Boronia',20,'L','Boronia'],
  ['Dasen (benazolin-etil)',3,'L','Dasen'],['Dicamba',19,'L','Dicamba'],['Gesagard 50',30,'L','Gesagard'],
  ['MSO siliconado',85,'L','MSO',null,'Elegir ID entre duplicados; nota «sobran 20» no modifica 85.'],
  ['Finesse',1050,'g','Finesse',null,'Resolver ID y unidad g/kg; nota «2470 g faltan» no modifica 1050 g.'],
  ['2,4-D EHE',20,'L','2,4 ?D EHE',null,'Elegir ID entre duplicados; nota «424 g faltan» no modifica 20 L.'],
  ['Atrazina 50',90,'L','Atrazina',null,'Confirmar ID: también hay un duplicado deshabilitado.'],
  ['Difimet',687,'L','Difimet'],['2,4-D Me',420,'L','2,4D Me'],
  ['Glifosato 66,2',740,'L','Glifosato',null,'Elegir ID entre duplicados; nota «sobran 65» no modifica 740.'],
  ['Percon',3,'L','Pericon',null,'Confirmar Percon/Pericon.'],
  ['Apron Max fludioxonil',3,'L','Apron','03/27','Mes/año no es una fecha completa. Confirmar fecha exacta o declarar NULL conservando la fuente externamente.'],
  ['Maxim Evolution / thiabendazol',5,'L','Maxim','12/26','Confirmar identidad y fecha exacta o NULL; no inventar día.'],
  ['Nicosulfuron 4%',1,'L','Nicosulfuron 4%'],
  ['Inoculante para soja Efimax',18,'L','Efimax','01/27','Mes/año: confirmar fecha exacta o declarar NULL.'],
  ['Arsenal',4,'L','Arsenal'],['Esteres metálicos de ácidos grasos coadyuvante',14,'L','Esteres'],
  ['Nicosulfuron granulado',300,'g','Nicosulfuron granulado',null,'Catálogo kg frente a hoja g; requiere decisión explícita.'],
  ['Imazapic para armar',1,'paquete','Imazapic',null,'Catálogo litros frente a paquete; resolver identidad, presentación y unidad.'],
];
const adapter={async connect(){return {release(){},async query(sql,args){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[]};
  if(sql.startsWith('SELECT * FROM users')) return {rows:[{id:actorId,company_id:companyId,enabled:true,role:1,custom_permissions:['history.import']}]};
  if(sql.startsWith('SELECT inventory_control_start_date')) return {rows:[{inventory_control_start_date:'2026-08-31'}]};
  if(sql.startsWith('SELECT * FROM "products"')) return {rows:products.filter(p=>p.id===args[0]&&p.company_id===args[1])};
  throw new Error('Simulation forbids query: '+sql);
}};}};
(async()=>{
  assert.equal(sheet.length,42);const rows=[];
  for(const [name,quantity,unit,pattern,expiration=null,decision=null] of sheet){
    const candidates=products.filter(p=>new RegExp('^'+pattern,'i').test(p.name));
    assert.ok(candidates.length,'Missing candidate: '+name);
    const validations=[];
    for(const p of candidates){
      let valid=false,error=null;
      try{await initial.prepare(adapter,{companyId,actorId,date:'2026-08-31',entries:[{product_id:p.id,quantity,unit,expiration_date:expiration}]});valid=true;}
      catch(e){error=e.message;}
      validations.push({id:p.id,name:p.name,unit:p.unit,enabled:p.enabled,preview_valid:valid,error});
    }
    rows.push({line:rows.length+1,source_name:name,quantity,unit,expiration_source:expiration,decision_required:decision,candidates:validations});
  }
  const report={mode:'READ_ONLY_BACKUP_SIMULATION',backup,company_id:companyId,assumed_control_date:'2026-08-31',
    date_configured_in_database:false,synthetic_reviewer:true,real_database_connections:0,persisted_openings:0,
    lines:42,lines_with_a_valid_preview:rows.filter(r=>r.candidates.some(c=>c.preview_valid)).length,
    lines_without_a_valid_preview:rows.filter(r=>!r.candidates.some(c=>c.preview_valid)).length,
    automatic_identity_decisions:0,rows};
  fs.writeFileSync(path.join(root,'docs/don-santiago-stock-initial-simulation.json'),JSON.stringify(report,null,2)+'\n');
  const lines=['# Simulación STOCK_INITIAL — Don Santiago','',
    'Fuente: respaldo local 20260916T175923749Z. Sin conexiones a base, sin confirmación, sin carga de stock. Fecha 31/08/2026 y usuario revisor son supuestos de la simulación; no configuran la empresa.',
    '',`42 líneas: ${report.lines_with_a_valid_preview} tienen al menos un candidato que supera la validación técnica individual; ${report.lines_without_a_valid_preview} no. Esto NO aprueba identidades ni constituye un manifiesto listo para confirmar.`,
    '', '| Hoja | Cantidad y unidad originales | Candidatos: ID, unidad, estado | Resultado / decisión pendiente |','|---|---|---|---|'];
  for(const r of rows)lines.push(`| ${r.line}. ${r.source_name} | ${r.quantity} ${r.unit}${r.expiration_source?' · vence '+r.expiration_source:''} | ${r.candidates.map(c=>`${c.name}: ${c.id} (${c.unit}, ${c.enabled?'activo':'deshabilitado'})`).join('<br>')} | ${r.decision_required||'Validación técnica individual; confirmar ID en el manifiesto revisado.'} ${r.candidates.filter(c=>c.enabled&&!c.preview_valid).map(c=>c.error).join(' ')} |`);
  lines.push('','Los 42 productos pueden declararse mediante product_id, cantidad explícita, unidad base y vencimiento completo/NULL una vez resueltos los puntos anteriores. El servicio no convierte cantidades ni cambia productos. Si resolver Imazapic requiere un nuevo registro o presentación, debe hacerse explícitamente antes de la apertura y fuera del importador.',
    '', 'La hoja no registra compras. Sus anotaciones de sobrantes/faltantes no se suman ni se restan. No se usan saldos legacy ni fechas de alta o actualización como cantidades/fechas de apertura.',
    '', 'El JSON adjunto conserva todos los candidatos y errores individuales, incluidos los duplicados deshabilitados.');
  fs.writeFileSync(path.join(root,'docs/don-santiago-stock-initial-simulation.md'),lines.join('\n')+'\n');
  console.log(JSON.stringify({lines:42,valid_preview_candidates:report.lines_with_a_valid_preview,blocked_preview_lines:report.lines_without_a_valid_preview,connections:0,persisted:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});

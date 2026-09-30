// Audit utility only. No database writes, restore, migrations, or functional app changes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../../..');
const req = createRequire(path.join(root, 'growsync-backend/package.json'));
req('dotenv').config({path:path.join(root,'growsync-backend/.env'),quiet:true});
const connection = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if(!connection) throw new Error('Database connection not configured');
const db = req('postgres')(connection,{max:1,connect_timeout:10,ssl:'require'});
const COMPANY='2791ea15-7dad-48e2-945b-3791e2d44478';
const expected={companies:1,planning:25,planning_lots:25,planning_products:25,planning_product_completions:24,usage_records:24,usage_lots:14,harvest_records:11,harvest_crop_assignments:11,crop_assignments:13,harvest_cycle_closures:0,products:55,lots:18,lot_layouts:21,sub_lots:8,crops:6,campaigns:3,users:2,vehicles:0,stock_batches:0,stock_movements:0};
const quote=s=>'"'+s.replace(/"/g,'""')+'"';
const literal=s=>"'"+s.replace(/'/g,"''")+"'";
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(name,bytes)=>{const p=path.join(__dirname,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes,{flag:'wx'});};
const writeJSON=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const arrayText=rows=>'[\n'+rows.map(r=>r.payload).join(',\n')+'\n]\n';
const saved={};
const report={expected_count_differences:[],foreign_key_exceptions:[],semantic_relationship_exceptions:[],company_scope_exceptions:[],database_recheck:[],geometry_checks:[],planning_text_checks:[],external_dependencies:[]};
async function setup(s){await s.unsafe("SET LOCAL statement_timeout='60s'");await s.unsafe("SET LOCAL TIME ZONE 'UTC'");const [r]=await s.unsafe("SELECT current_setting('transaction_read_only') read_only,current_setting('transaction_isolation') isolation,now()::text captured_at,current_database() database,current_user db_user,version() server_version,pg_current_snapshot()::text snapshot");if(r.read_only!=='on')throw Error('Read-only guard failed');return r;}
async function main(){
 if(fs.existsSync(path.join(__dirname,'manifest.json')))throw Error('Existing backup: never overwrite');
 const exported=await db.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY',async s=>{
  const context=await setup(s);
  const columns=await s.unsafe("SELECT c.table_name,c.column_name,c.ordinal_position,c.data_type,c.udt_schema,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.identity_generation,c.is_generated,c.generation_expression,c.numeric_precision,c.numeric_scale,c.datetime_precision FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema='public' AND t.table_type='BASE TABLE' ORDER BY c.table_name,c.ordinal_position");
  const fks=await s.unsafe("SELECT co.conname name,nc.nspname child_schema,cl.relname child,np.nspname parent_schema,pa.relname parent,ARRAY(SELECT a.attname FROM unnest(co.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=co.conrelid AND a.attnum=k.num ORDER BY k.ord) child_columns,ARRAY(SELECT a.attname FROM unnest(co.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=co.confrelid AND a.attnum=k.num ORDER BY k.ord) parent_columns,co.condeferrable,co.condeferred,co.confmatchtype,pg_get_constraintdef(co.oid,true) definition FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid JOIN pg_namespace nc ON nc.oid=cl.relnamespace JOIN pg_class pa ON pa.oid=co.confrelid JOIN pg_namespace np ON np.oid=pa.relnamespace WHERE co.contype='f' AND (nc.nspname='public' OR np.nspname='public') ORDER BY nc.nspname,cl.relname,co.conname");
  const constraints=await s.unsafe("SELECT c.relname table_name,co.conname name,co.contype type,pg_get_constraintdef(co.oid,true) definition,co.condeferrable,co.condeferred FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,co.conname");
  const indexes=await s.unsafe("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname");
  const extensions=await s.unsafe('SELECT extname,extversion FROM pg_extension ORDER BY extname');
  const tables=[...new Set(columns.map(c=>c.table_name))];
  const byTable=Object.fromEntries(tables.map(t=>[t,columns.filter(c=>c.table_name===t)]));
  const owned=new Set(tables.filter(t=>byTable[t].some(c=>c.column_name==='company_id')));
  const included=new Set([...owned,'companies']);
  let changed=true;
  while(changed){changed=false;for(const f of fks){if(f.child_schema==='public'&&f.parent_schema==='public'&&included.has(f.parent)&&tables.includes(f.child)&&!included.has(f.child)){included.add(f.child);changed=true;}}}
  // Follow only explicit FK paths for tables without company ownership. Never include another tenant.
  function condition(t,alias,seen=new Set()){
   if(t==='companies')return `${alias}.id=${literal(COMPANY)}::uuid`;
   if(owned.has(t))return `${alias}.company_id=${literal(COMPANY)}::uuid`;
   if(seen.has(t))return 'false';const next=new Set([...seen,t]);
   const paths=fks.filter(f=>f.child_schema==='public'&&f.child===t&&f.parent_schema==='public'&&included.has(f.parent)).map((f,i)=>{const a='p'+next.size+'_'+i;return `EXISTS (SELECT 1 FROM public.${quote(f.parent)} ${a} WHERE ${f.child_columns.map((c,j)=>`${alias}.${quote(c)}=${a}.${quote(f.parent_columns[j])}`).join(' AND ')} AND (${condition(f.parent,a,next)}))`;});
   return paths.length?paths.join(' OR '):'false';
  }
  const selections={};
  for(const t of [...included].sort()){
   const cols=byTable[t];if(!cols)throw Error('Unknown selected table '+t);
   const select=cols.map(c=>['geometry','geography'].includes(c.udt_name)?`CASE WHEN t.${quote(c.column_name)} IS NULL THEN NULL ELSE encode(ST_AsEWKB(t.${quote(c.column_name)}::geometry,'NDR'),'hex') END AS ${quote(c.column_name)}`:`t.${quote(c.column_name)}`).join(',');
   const predicate=condition(t,'t');
   const sql=`SELECT row_to_json(r)::text payload FROM (SELECT ${select} FROM public.${quote(t)} t WHERE ${predicate}) r ORDER BY row_to_json(r)::text COLLATE "C"`;
   const rows=await s.unsafe(sql);const bytes=arrayText(rows);const file=`data/${t}.json`;write(file,bytes);saved[t]={rows:JSON.parse(bytes),bytes,file,sql};
   selections[t]={predicate,rows:rows.length,file,geometry_columns:cols.filter(c=>['geometry','geography'].includes(c.udt_name)).map(c=>c.column_name)};
   console.log(`${t}: ${rows.length}`);
   if(expected[t]!==undefined&&expected[t]!==rows.length)report.expected_count_differences.push({table:t,expected:expected[t],actual:rows.length});
   for(const c of cols.filter(c=>['geometry','geography'].includes(c.udt_name))){
    const col=`t.${quote(c.column_name)}`;
    const gsql=`SELECT json_build_object('id',t.id,'column',${literal(c.column_name)},'ewkb_hex',CASE WHEN ${col} IS NULL THEN NULL ELSE encode(ST_AsEWKB(${col}::geometry,'NDR'),'hex') END,'srid',ST_SRID(${col}::geometry),'geometry_type',ST_GeometryType(${col}::geometry),'is_valid',ST_IsValid(${col}::geometry),'ewkt',ST_AsEWKT(${col}::geometry,17),'geojson',ST_AsGeoJSON(${col}::geometry,17,0)::json)::text payload FROM public.${quote(t)} t WHERE ${predicate} ORDER BY t.id`;
    const gfile=`geometries/${t}.${c.column_name}.json`;const gb=arrayText(await s.unsafe(gsql));write(gfile,gb);
    selections[t].geometry_files=(selections[t].geometry_files||[]).concat(gfile);
    const check=await s.unsafe(`SELECT count(*)::int total,count(${col})::int nonnull,count(*) FILTER (WHERE ${col} IS NOT NULL AND encode(ST_AsEWKB(ST_GeomFromEWKB(ST_AsEWKB(${col}::geometry,'NDR')),'NDR'),'hex')=encode(ST_AsEWKB(${col}::geometry,'NDR'),'hex'))::int ewkb_roundtrip_exact FROM public.${quote(t)} t WHERE ${predicate}`);
    report.geometry_checks.push({table:t,column:c.column_name,...check[0]});
    saved[gfile]={bytes:gb,file:gfile,sql:gsql,rows:JSON.parse(gb)};
   }
  }
  const srids=[...new Set(Object.keys(saved).filter(k=>k.startsWith('geometries/')).flatMap(k=>saved[k].rows.map(r=>r.srid)).filter(x=>x!==null))];
  const spatialSQL='SELECT row_to_json(s)::text payload FROM public.spatial_ref_sys s WHERE srid=ANY($1::int[]) ORDER BY srid';
  const spatialBytes=arrayText(await s.unsafe(spatialSQL,[srids]));write('schema/spatial_ref_sys.json',spatialBytes);
  const excluded=tables.filter(t=>!included.has(t)).map(t=>({table:t,reason:t==='spatial_ref_sys'?'Global CRS catalog: referenced SRIDs exported separately.':'No company_id or declared FK path to selected company records; not presumed tenant-owned.',columns:byTable[t].map(c=>c.column_name)}));
  writeJSON('schema/schema.json',{columns,constraints,foreign_keys:fks,indexes,extensions,selected_tables:[...included].sort(),excluded_tables:excluded,spatial_ref_sys_srids:srids});
  writeJSON('schema/selections.json',selections);
  // Capture strings in a separate query for an independent exact-content comparison.
  const originalText=await s.unsafe('SELECT id,title,description FROM public.planning WHERE company_id=$1 ORDER BY id',[COMPANY]);
  for(const p of originalText){const row=saved.planning.rows.find(x=>x.id===p.id);report.planning_text_checks.push({id:p.id,title_exact:row?.title===p.title,description_exact:row?.description===p.description});}
  return {context,selections,excluded,fks,columns,extensions,srids};
 });
 // Local validation: JSON parsed for relationships only; export bytes were never JS-reserialized.
 for(const [t,item]of Object.entries(saved).filter(([t])=>!t.startsWith('geometries/'))){for(const row of item.rows){if('company_id'in row&&row.company_id!==COMPANY)report.company_scope_exceptions.push({table:t,id:row.id,company_id:row.company_id});}}
 for(const f of exported.fks.filter(f=>f.child_schema==='public'&&saved[f.child])){
  for(const row of saved[f.child].rows){const values=f.child_columns.map(c=>row[c]);if(values.some(v=>v===null||v===undefined))continue;
   if(f.parent_schema!=='public'||!saved[f.parent]){report.external_dependencies.push({constraint:f.name,parent_schema:f.parent_schema,parent:f.parent,values});continue;}
   if(!saved[f.parent].rows.some(p=>f.parent_columns.every((c,i)=>String(p[c])===String(values[i]))))report.foreign_key_exceptions.push({constraint:f.name,table:f.child,id:row.id??null,parent:f.parent,values});
  }
 }
 const lookup=(t,id)=>saved[t]?.rows.find(x=>x.id===id);
 for(const table of ['planning_lots','usage_lots','harvest_records','crop_assignments'])for(const row of saved[table]?.rows||[]){if(row.sub_lot_id){const sub=lookup('sub_lots',row.sub_lot_id);if(sub&&sub.lot_id!==row.lot_id)report.semantic_relationship_exceptions.push({table,reason:'sub_lot parent differs',row});}}
 for(const sub of saved.sub_lots.rows){if(lookup('lot_layouts',sub.layout_id)?.lot_id!==sub.lot_id)report.semantic_relationship_exceptions.push({table:'sub_lots',id:sub.id,reason:'layout parent differs'});}
 for(const c of saved.planning_product_completions.rows){const pp=lookup('planning_products',c.planning_product_id),u=lookup('usage_records',c.usage_id);if(pp?.planning_id!==c.planning_id||(c.usage_id&&(u?.source_planning_id!==c.planning_id||u?.source_planning_product_id!==c.planning_product_id||u?.product_id!==pp?.product_id)))report.semantic_relationship_exceptions.push({table:'planning_product_completions',row:c});}
 for(const u of saved.usage_records.rows){if(u.source_planning_product_id){const pp=lookup('planning_products',u.source_planning_product_id);if(pp&&(pp.planning_id!==u.source_planning_id||pp.product_id!==u.product_id))report.semantic_relationship_exceptions.push({table:'usage_records',id:u.id,reason:'source product/planning mismatch'});}}
 for(const hca of saved.harvest_crop_assignments.rows){const h=lookup('harvest_records',hca.harvest_id),a=lookup('crop_assignments',hca.crop_assignment_id);if(h&&a&&(h.lot_id!==a.lot_id||h.sub_lot_id!==a.sub_lot_id))report.semantic_relationship_exceptions.push({table:'harvest_crop_assignments',row:hca,reason:'harvest/assignment spatial mismatch'});}
 // Second independent READ ONLY snapshot after files have been written.
 const recheck=await db.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY',async s=>{const ctx=await setup(s);for(const [t,item]of Object.entries(saved)){const bytes=arrayText(await s.unsafe(item.sql));const disk=fs.readFileSync(path.join(__dirname,item.file));report.database_recheck.push({table_or_geometry:t,rows_exported:item.rows.length,rows_rechecked:JSON.parse(bytes).length,file_matches_export:hash(disk)===hash(item.bytes),database_matches_file:hash(bytes)===hash(disk),sha256:hash(disk)});}return ctx;});
 await db.end();
 const evidenceCandidates=['audit/inventory-data-2026-09-13.json','audit/inventory-schema-2026-09-13.json','audit/inventory-audit-2026-09-13.md','audit/harvest-reconciliation/2026-09-09T01-19-54-058Z-before.json','audit/harvest-reconciliation/2026-09-09T01-19-54-058Z-result.json'];
 const evidence=[];
 for(const source of evidenceCandidates){const p=path.join(root,source);if(fs.existsSync(p)){const bytes=fs.readFileSync(p);const target='evidence/'+source;write(target,bytes);evidence.push({source:path.resolve(p),file:target,sha256:hash(bytes),bytes:bytes.length,identical_to_source:hash(fs.readFileSync(path.join(__dirname,target)))===hash(bytes)});}}
 report.local_json_validation={files:[],all_valid:true};
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
 for(const file of walk(__dirname).filter(f=>f.endsWith('.json'))){JSON.parse(fs.readFileSync(file,'utf8'));report.local_json_validation.files.push(path.relative(__dirname,file).replace(/\\/g,'/'));}
 report.all_required_checks_passed=report.foreign_key_exceptions.length===0&&report.semantic_relationship_exceptions.length===0&&report.company_scope_exceptions.length===0&&report.external_dependencies.length===0&&report.database_recheck.every(x=>x.file_matches_export&&x.database_matches_file)&&report.geometry_checks.every(x=>x.nonnull===x.ewkb_roundtrip_exact)&&report.planning_text_checks.every(x=>x.title_exact&&x.description_exact);
 report.recheck_context=recheck;report.restore_test='No restore executed. Syntax, FK closure, exact source bytes, planning text, and EWKB roundtrip checked read-only/local.';
 writeJSON('verification.json',report);
 const rows=Object.entries(exported.selections).map(([t,v])=>`| ${t} | ${v.rows} | ${expected[t]??'sin conteo previo'} |`).join('\n');
 const readme=`# Backup pre-reset — Don Santiago SRL\n\nESTE BACKUP REPRESENTA EL ESTADO PREVIO AL RESET.\n\nNO ES UNA NORMALIZACIÓN DE LOS DATOS.\n\nEmpresa: ${COMPANY}. Captura UTC: ${exported.context.captured_at}.\n\n## Alcance\n\nTodos los registros públicos con company_id de Don Santiago y tablas dependientes descubiertas mediante claves foráneas, sin filtrar enabled ni status. Ver schema/selections.json y schema/schema.json. Los catálogos globales no son datos de la empresa; se incluyen las definiciones de SRID utilizadas. Exclusiones y excepciones se documentan, no se corrigen.\n\n## Corte y contexto\n\nInicio de inventario definido: 31/08/2026. Es la fecha de inicio del control físico declarado; NO fecha de compra. No usar created_at como fecha de compra o fecha operativa. Hay actividades históricas anteriores al corte. Planning.title y Planning.description contienen información agronómica, unidades, variedades, tratamientos y referencias espaciales solo en texto libre. Se conservan literalmente, incluidos NULL y saltos de línea.\n\nSe incluyen lotes deshabilitados, ambos T3, 5-6 bajo, 5-6-7, 5-6-7 completo, layouts locked/active/draft y sublotes. No se infieren vigencias físicas de created_at/activated_at. Las actividades al lote completo no reciben un layout nuevo.\n\n## Formato recuperable\n\nCada data/*.json es un array de filas con todas las columnas, producido como texto JSON por PostgreSQL. Números NUMERIC conservan su precisión decimal en los bytes del archivo; NO reserializar con Number de JavaScript para una restauración. Usar parser decimal/lossless o procesamiento JSON de PostgreSQL. Se preservan UUID, NULL, timestamps con microsegundos, unidades y textos. Las columnas geometry/geography se codifican como cadena hexadecimal EWKB NDR (o NULL). Para restaurarlas se requiere ST_GeomFromEWKB(decode(valor,'hex')), con el tipo original indicado en schema/schema.json.\n\nGeometries/*.json incluye EWKB exacto, SRID, EWKT y GeoJSON de consulta; EWKB es la representación autoritativa de restauración. No se simplificaron ni corrigieron geometrías. location, area y area_ha permanecen en las filas originales.\n\n## Tablas\n\n| Tabla | Filas actuales | Esperadas previamente |\n|---|---:|---:|\n${rows}\n\n## Verificaciones\n\nVer verification.json: comparación exacta de archivos con una SEGUNDA transacción READ ONLY, conteos, FK, relaciones semánticas, pertenencia de empresa, 25 textos Planning y roundtrip EWKB. Resultado de controles requeridos: ${report.all_required_checks_passed?'CORRECTO':'EXCEPCIONES: revisar verification.json'}. No se restauró sobre producción ni se creó infraestructura.\n\n## Recuperación futura\n\nEste es un backup lógico de datos de la empresa, no una imagen completa del servidor. Requiere un esquema compatible, PostGIS y las definiciones de tipos/constraints registradas. Preservar IDs explícitos. Revisar columnas generated/identity y triggers antes de restaurar; no ejecutar rutas funcionales que descuenten stock. Hay ciclos entre planning/usage/completions: un futuro procedimiento deberá planificar el orden y el tratamiento de constraints en un entorno de recuperación autorizado. No se incluye un restaurador ni se ejecuta SQL de escritura. Verificar nuevamente checksums antes de usar. Las credenciales y secretos de conexión no están incluidos.\n\n## Ambigüedades conocidas\n\nDuplicados y unidades problemáticas de inventario se conservan; las cantidades actuales no certifican saldos originales. Las modificaciones legacy no tienen movimientos completos. Hay una cosecha declarada el 11/09 cargada el 02/09; no se clasifica como prueba. No convertir dosis textuales en Usage. No reasignar historia a divisiones actuales.\n\n## Evidencia complementaria\n\n${evidence.map(e=>'- '+e.source+' → '+e.file).join('\n')}\n\nSon copias byte por byte de archivos anteriores, no sustituyen esta captura de DB y pueden describir estados previos o metadata global. Los informes de esta conversación que no existen como archivos del repositorio no se presentan como archivos exportados.\n\n## Integridad de archivos\n\nmanifest.json registra tamaños y SHA-256 de los archivos de contenido. SHA256SUMS.txt cubre también manifest.json. SHA256SUMS.txt no se autohashea: es el índice raíz. Esta convención evita referencias circulares.\n\nCAMBIOS EN BASE DE DATOS: NINGUNO.\nCAMBIOS FUNCIONALES EN CÓDIGO: NINGUNO.\nRESET: NO EJECUTADO.\n\nNo ejecutar el reset sin confirmación explícita.\n`;
 write('README.md',readme);
 const inventory=walk(__dirname).map(p=>{const b=fs.readFileSync(p);return {file:path.relative(__dirname,p).replace(/\\/g,'/'),bytes:b.length,sha256:hash(b)};}).sort((a,b)=>a.file.localeCompare(b.file));
 const url=new URL(connection);
 const manifest={format_version:1,backup_timestamp:exported.context.captured_at,company_id:COMPANY,company_name:saved.companies.rows[0]?.name,environment:{source:'Configured GrowSync backend .env; credentials excluded',host:url.hostname,port:url.port,database:exported.context.database,db_user:exported.context.db_user,server_version:exported.context.server_version,extensions:exported.extensions},transaction:exported.context,verification_transaction:recheck,inventory_start_date:'2026-08-31',tables:exported.selections,files:inventory,evidence,expected_count_differences:report.expected_count_differences,excluded_tables:exported.excluded,verification_passed:report.all_required_checks_passed,observations:['Database read-only; no reset or migrations.','Original data; no normalization.','Geometry is exact EWKB hex in data and companion geometry files.','Original decimal JSON tokens and microsecond timestamps preserved.','Public schema company backup; not a full infrastructure/Auth backup.','Manifest is hashed in SHA256SUMS.txt; checksum index intentionally has no self-hash.']};
 writeJSON('manifest.json',manifest);
 const all=walk(__dirname).sort();write('SHA256SUMS.txt',all.map(p=>`${hash(fs.readFileSync(p))}  ${path.relative(__dirname,p).replace(/\\/g,'/')}`).join('\n')+'\n');
 let verified=0;for(const line of fs.readFileSync(path.join(__dirname,'SHA256SUMS.txt'),'utf8').trim().split('\n')){const [digest,name]=line.split('  ');if(hash(fs.readFileSync(path.join(__dirname,name)))!==digest)throw Error('Checksum failed: '+name);verified++;}
 JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));JSON.parse(fs.readFileSync(path.join(__dirname,'verification.json'),'utf8'));
 console.log(JSON.stringify({backup:__dirname,rows:Object.fromEntries(Object.entries(exported.selections).map(([t,v])=>[t,v.rows])),checksums_verified:verified,passed:report.all_required_checks_passed,exceptions:{fk:report.foreign_key_exceptions,semantic:report.semantic_relationship_exceptions,external:report.external_dependencies,expected:report.expected_count_differences},excluded:exported.excluded},null,2));
 if(!report.all_required_checks_passed)process.exitCode=2;
}
main().catch(async e=>{console.error(e.stack||e.message);try{await db.end({timeout:2});}catch{}process.exitCode=1;});

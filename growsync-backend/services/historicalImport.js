const stock = require('./stock');
const { HISTORICAL, fail } = require('./inventoryImpact');
const { getEffectivePermissions } = require('../constants/permissions');
const { sameUnit } = require('./inventoryUnits');

const TABLES = ['planning', 'planning_lots', 'planning_products', 'usage_records', 'usage_lots',
  'planning_product_completions', 'crop_assignments', 'harvest_records', 'harvest_crop_assignments'];
const ENTITIES = new Set(['planning', 'usage_records', 'crop_assignments', 'harvest_records']);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const refs = {
  planning: { responsible_user:'users', created_by:'users', vehicle_id:'vehicles', crop_id:'crops', campaign_id:'campaigns' },
  planning_lots: { planning_id:'planning', lot_id:'lots', sub_lot_id:'sub_lots' },
  planning_products: { planning_id:'planning', product_id:'products' },
  usage_records: { product_id:'products', user_id:'users', created_by:'users', crop_id:'crops', source_planning_id:'planning', source_planning_product_id:'planning_products' },
  usage_lots: { usage_id:'usage_records', lot_id:'lots', sub_lot_id:'sub_lots' },
  planning_product_completions: { planning_id:'planning', planning_product_id:'planning_products', usage_id:'usage_records' },
  crop_assignments: { campaign_id:'campaigns', lot_id:'lots', sub_lot_id:'sub_lots', crop_id:'crops', source_planning_id:'planning' },
  harvest_records: { lot_id:'lots', sub_lot_id:'sub_lots', crop_id:'crops', campaign_id:'campaigns', created_by:'users' },
  harvest_crop_assignments: { harvest_id:'harvest_records', crop_assignment_id:'crop_assignments' },
};
async function authorize(client, companyId, actorId) {
  const {rows} = await client.query('SELECT * FROM users WHERE company_id=$1 AND id=$2 AND enabled=true', [companyId, actorId]);
  const permissions = rows.length ? getEffectivePermissions(rows[0]) : [];
  if (!permissions.includes('all') && !permissions.includes('history.import')) throw fail('Se requiere permiso para administrar antecedentes históricos.',403);
}
async function reference(client, table, id, companyId) {
  const sql = table === 'planning_products'
    ? 'SELECT pp.* FROM planning_products pp JOIN planning p ON p.id=pp.planning_id WHERE pp.id=$1 AND p.company_id=$2'
    : `SELECT * FROM ${quote(table)} WHERE id=$1 AND company_id=$2`;
  const {rows} = await client.query(sql,[id,companyId]);
  if (!rows.length) throw fail(`Referencia ${table} inexistente o de otra empresa.`,400);
  return rows[0];
}
async function validateReferences(client, table, row, companyId) {
  const found = {};
  for (const [field,parent] of Object.entries(refs[table] || {})) {
    if (row[field] != null) found[field] = await reference(client,parent,row[field],companyId);
  }
  if (found.sub_lot_id && found.sub_lot_id.lot_id !== row.lot_id) throw fail('Sublote y lote no coinciden.',400);
  // Historical surfaces keep their explicit sublot/layout, including locked or disabled ones.
  if (found.product_id && row.unit != null && !sameUnit(found.product_id.unit,row.unit)) throw fail('Unidad histórica incompatible; se requiere revisión, sin conversión automática.',400);
  const p = found.planning_id || found.source_planning_id;
  if (p && p.inventory_impact_mode !== HISTORICAL) throw fail('No se pueden adjuntar antecedentes a un Planning ordinario.');
  const pp = found.planning_product_id || found.source_planning_product_id;
  if (pp && (pp.planning_id !== (row.planning_id || row.source_planning_id))) throw fail('El producto planificado no pertenece al Planning.');
  if (table === 'usage_records' && pp && pp.product_id !== row.product_id) throw fail('Producto de Usage incompatible con Planning.');
  if (table === 'planning_product_completions' && found.usage_id) {
    const u = found.usage_id;
    if (u.source_planning_id !== row.planning_id || u.source_planning_product_id !== row.planning_product_id
      || u.inventory_impact_mode !== HISTORICAL || stock.decimal(u.amount_used) !== stock.decimal(row.actual_amount)) throw fail('Completion y Usage no coinciden.');
  }
  if (table === 'harvest_crop_assignments') {
    const h=found.harvest_id, a=found.crop_assignment_id;
    if (h.inventory_impact_mode!==HISTORICAL || a.inventory_impact_mode!==HISTORICAL
      || h.lot_id!==a.lot_id || h.sub_lot_id!==a.sub_lot_id || h.crop_id!==a.crop_id || h.campaign_id!==a.campaign_id) throw fail('Cosecha y asignación históricas incompatibles.');
  }
}
async function importHistory(pool, {companyId, actorId, key, source, confirmedNoStock, records}) {
  if (confirmedNoStock !== true || typeof source!=='string' || !source.trim() || source.length>1000 || typeof key!=='string' || !key.trim() || key.length>200 || !records || typeof records!=='object' || Array.isArray(records)) throw fail('Confirmación sin stock, origen, registros y clave de idempotencia son obligatorios.',400);
  if (Object.keys(records).some(t=>!TABLES.includes(t)) || TABLES.some(t=>records[t]!==undefined && !Array.isArray(records[t]))) throw fail('Tablas de importación no permitidas.',400);
  if(TABLES.some(t=>(records[t]||[]).some(r=>!r||typeof r!=='object'||Array.isArray(r)))) throw fail('Fila histórica inválida.',400);
  if (TABLES.reduce((n,t)=>n+(records[t]?.length||0),0)>10000) throw fail('Máximo 10000 filas por importación.',400);
  // A manifest creates a closed graph. Junction-only retries cannot append duplicates
  // to previously imported parents under a different idempotency key.
  const parentSets=Object.fromEntries(['planning','usage_records','harvest_records','crop_assignments'].map(t=>[t,new Set((records[t]||[]).map(r=>r.id))]));
  for(const [child,field,parent] of [['planning_lots','planning_id','planning'],['planning_products','planning_id','planning'],
    ['usage_lots','usage_id','usage_records'],['planning_product_completions','planning_id','planning'],
    ['harvest_crop_assignments','harvest_id','harvest_records']]) {
    for(const row of records[child]||[]) if(!parentSets[parent].has(row[field])) throw fail('Las relaciones deben acompañar a sus entidades en el mismo manifiesto.',400);
  }
  const hash=stock.fingerprint({source,records,confirmedNoStock});
  return stock.transaction(pool,async client=>{
    await authorize(client,companyId,actorId);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`history:${companyId}:${key}`]);
    const {rows:previous}=await client.query('SELECT * FROM historical_imports WHERE company_id=$1 AND idempotency_key=$2',[companyId,key]);
    if (previous.length) {
      if (previous[0].request_hash!==hash) throw fail('La clave de importación ya corresponde a otro contenido.');
      return {...previous[0].result,replayed:true};
    }
    const {rows:imports}=await client.query(`INSERT INTO historical_imports(company_id,idempotency_key,request_hash,imported_by,source,payload)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,[companyId,key,hash,actorId,source,JSON.stringify(records)]);
    const importId=imports[0].id;
    const {rows:columns}=await client.query(`SELECT table_name,column_name,is_generated FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`,[TABLES]);
    const counts={};
    for (const table of TABLES) {
      counts[table]=0;
      const schema=columns.filter(c=>c.table_name===table);
      for (const input of records[table] || []) {
        if (!input || typeof input!=='object' || Array.isArray(input)) throw fail('Fila histórica inválida.',400);
        if (Object.keys(input).some(k=>!schema.some(c=>c.column_name===k))) throw fail(`Campos desconocidos en ${table}.`,400);
        const row={...input};
        if((ENTITIES.has(table)||table==='planning_products') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id||'')) throw fail('Cada entidad requiere un ID estable.',400);
        for(const field of ['date','effective_date','start_date','end_date','harvest_date']) {
          if(row[field]!=null) stock.calendarDate(row[field]);
        }
        for(const field of ['amount_used','amount','actual_amount','production_kg','harvested_area_ha','area_ha']) {
          if(row[field]!=null && stock.decimal(row[field])<0n) throw fail('Cantidad o superficie histórica inválida.',400);
        }
        if (schema.some(c=>c.column_name==='company_id')) {
          if (row.company_id && row.company_id!==companyId) throw fail('Empresa incompatible.',403);
          row.company_id=companyId;
        }
        if (ENTITIES.has(table)) { row.inventory_impact_mode=HISTORICAL; row.historical_import_id=importId; }
        await validateReferences(client,table,row,companyId);
        // Do not recalculate dates, quantities, surfaces, productive cycles or stock.
        // Database-generated values (e.g. date_range/yield) are not assigned manually.
        const entries=Object.entries(row).filter(([k])=>schema.find(c=>c.column_name===k)?.is_generated==='NEVER');
        if (!entries.length) throw fail('Fila histórica vacía.',400);
        const {rows:saved}=await client.query(`INSERT INTO ${quote(table)} (${entries.map(([k])=>quote(k)).join(',')}) VALUES (${entries.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,entries.map(([,v])=>v));
        // Refuse silent normalization by existing triggers rather than altering history.
        for(const field of ['area_ha','harvested_area_ha','production_kg','yield_kg_ha','amount','actual_amount','amount_used']) {
          if(input[field]!=null && stock.decimal(saved[0][field])!==stock.decimal(input[field])) throw fail('La base modificaría una cantidad histórica; revisá el manifiesto.');
        }
        counts[table]++;
      }
    }
    const result={import_id:importId,counts,inventory_impact_mode:HISTORICAL};
    await client.query('UPDATE historical_imports SET result=$2::jsonb WHERE id=$1',[importId,JSON.stringify(result)]);
    return result;
  });
}
module.exports={TABLES,ENTITIES,authorize,reference,validateReferences,importHistory};

const {sameUnit,normalizeUnit,validUnit,UNIT_LOCK_MESSAGE}=require('./inventoryUnits');
const quote = identifier => '"'+identifier.replace(/"/g,'""')+'"';
// Discover installed references instead of assuming that optional V1 tables exist.
async function productReferences(client) {
  const {rows}=await client.query(`SELECT DISTINCT ns.nspname AS schema_name,rel.relname AS table_name,a.attname AS column_name
    FROM pg_constraint fk JOIN pg_class rel ON rel.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
    CROSS JOIN LATERAL unnest(fk.conkey,fk.confkey) AS keys(local_key,foreign_key)
    JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=keys.local_key
    JOIN pg_attribute referenced ON referenced.attrelid=fk.confrelid AND referenced.attnum=keys.foreign_key
    WHERE fk.contype='f' AND fk.confrelid='public.products'::regclass AND referenced.attname='id'`);
  return rows;
}
async function decorateUnitHistory(client,companyId,products) {
  if(!products.length)return products;
  // No SQL connection: do not imply that editing is safe.
  if(!client)return products.map(p=>({...p,unit_locked:true,unit_history_verified:false}));
  const references=await productReferences(client);
  const ids=products.map(p=>p.id);
  const found=new Set();
  for(const ref of references){
    const {rows}=await client.query(`SELECT DISTINCT ${quote(ref.column_name)} AS product_id FROM ${quote(ref.schema_name)}.${quote(ref.table_name)} WHERE ${quote(ref.column_name)}=ANY($1::uuid[])`,[ids]);
    rows.forEach(row=>found.add(String(row.product_id)));
  }
  return products.map(p=>({...p,unit_history_verified:true,unit_locked:found.has(String(p.id))||Number(p.total_quantity||0)!==0||Number(p.available_quantity||0)!==0}));
}
async function resolveUnitChange(client,companyId,product,nextUnit) {
  if(!validUnit(nextUnit))throw Object.assign(new Error('Unidad base inválida.'),{status:400});
  if(sameUnit(product.unit,nextUnit))return product.unit;
  const [state]=await decorateUnitHistory(client,companyId,[product]);
  if(state.unit_locked)throw Object.assign(new Error(UNIT_LOCK_MESSAGE),{status:409});
  return normalizeUnit(nextUnit);
}
module.exports={productReferences,decorateUnitHistory,resolveUnitChange};

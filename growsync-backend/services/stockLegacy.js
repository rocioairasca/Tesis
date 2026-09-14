const {validUnit} = require('./inventoryUnits');
const { decimal, amount, receiveStock, fail } = require('./stock');

// Audit 2026-09-13: only identities classified CONSERVAR may be proposed.
// This is a denylist in addition to an explicit approved-ID allowlist, never
// an automatic scan/migration. Duplicates pending fusion are excluded too.
const REVIEW_IDS = new Set([
  '589e5362-c45d-43a2-8f33-d12825843f9b', // Difimet
  '16e33e56-e2d3-4092-ab95-a94037addbb3', // Sulfato de Amonio
  '9f5c2d5d-1f01-4197-b48e-96e19422a450',
  'b2f84fc3-ee5c-4884-b152-3dd715148680', // proposed fusion, not approved
]);
function proposeOpenings(products, {companyId, approvedProductIds = [], reviewProductIds = []}) {
  if(!companyId) throw fail('Empresa obligatoria para preparar la apertura.',400);
  const approved = new Set(approvedProductIds), review = new Set([...REVIEW_IDS,...reviewProductIds]);
  return products.filter(p => p.company_id===companyId && p.enabled===true && approved.has(p.id)
    && !review.has(p.id) && !/finesse/i.test(p.name) && validUnit(p.unit)
    && p.available_quantity != null && decimal(p.available_quantity)>0n)
    .map(p => ({companyId,productId:p.id,quantity:amount(decimal(p.available_quantity)),unit:p.unit,origin:'legacy',
      unit_price:null,currency:null,exchange_rate:null,total_original:null,total_ars:null,supplier:null,
      received_date:null,expiration_date:null,notes:'Stock inicial / legacy. Vencimiento pendiente de validación.'}));
}
// No route or startup invokes this. Future operator supplies a reviewed manifest
// and an existing transaction; compare approved balance against the locked row.
async function openApprovedLegacy(client, {companyId, actorId, approved, runId, reviewProductIds=[]}) {
  if(!runId || !approved?.length) throw fail('Se requiere un manifiesto de apertura aprobado.');
  const ids=approved.map(x=>x.productId);
  const {rows}=await client.query('SELECT * FROM products WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[companyId,ids]);
  const proposals=proposeOpenings(rows,{companyId,approvedProductIds:ids,reviewProductIds});
  if(proposals.length!==ids.length || new Set(ids).size!==ids.length) throw fail('El manifiesto incluye productos excluidos, inexistentes o sin saldo.');
  const result=[];
  for(const p of proposals){
    const entry=approved.find(x=>x.productId===p.productId);
    if(decimal(entry.quantity)!==decimal(p.quantity)) throw fail('El saldo actual difiere del aprobado.');
    // Never silently activate an identity that already received stock.
    const {rows:existing}=await client.query('SELECT id FROM stock_batches WHERE company_id=$1 AND product_id=$2',[companyId,p.productId]);
    if(existing.length) throw fail('El producto ya tiene partidas; apertura bloqueada.');
    result.push(await receiveStock(client,{...p,actorId,key:`legacy:${runId}:${p.productId}`,approvedLegacy:true,
      received_date:entry.verifiedReceivedDate??null,expiration_date:entry.verifiedExpirationDate||null,reference:`legacy:${runId}`}));
  }
  return result;
}
module.exports={proposeOpenings,openApprovedLegacy};

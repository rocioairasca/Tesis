const {effectiveExpirationSql}=require('./inventoryExpiration');
// $3 is the operational date. Simulations never add FOR UPDATE/advisory locks.
const eligibleBatchSql = `enabled=true AND available_quantity>0
  AND COALESCE(received_date, (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) <= $3::date
  AND (${effectiveExpirationSql} IS NULL OR ${effectiveExpirationSql} >= $3::date)`;
const fefoOrderSql = `${effectiveExpirationSql} ASC NULLS LAST, received_date ASC NULLS LAST, id ASC`;
module.exports={eligibleBatchSql,fefoOrderSql};

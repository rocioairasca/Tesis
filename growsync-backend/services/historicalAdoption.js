const stock = require('./stock');
const { getEffectivePermissions } = require('../constants/permissions');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(client, companyId, actorId) {
  const { rows } = await client.query('SELECT * FROM users WHERE id=$1 AND company_id=$2 AND enabled=true', [actorId, companyId]);
  const user = rows[0], permissions = user ? getEffectivePermissions(user) : [];
  if (!user || user.role !== 3 || (!permissions.includes('all') &&
      !['planning.edit', 'history.import'].every(p => permissions.includes(p)))) {
    throw stock.fail('Se requiere Admin con permisos de planificación e históricos.', 403);
  }
}
function validateIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !UUID.test(id)) || new Set(ids.map(id => id.toLowerCase())).size !== ids.length) {
    throw stock.fail('Seleccioná entre 1 y 50 planificaciones distintas.', 400);
  }
  return ids.map(id => id.toLowerCase()).sort();
}
async function run(pool, input, confirm) {
  const ids = validateIds(input.planningIds);
  if (confirm && (input.confirmed !== true || typeof input.key !== 'string' || !input.key.trim() || input.key.length > 200)) {
    throw stock.fail('Confirmación explícita y clave de idempotencia obligatorias.', 400);
  }
  try {
    return await stock.transaction(pool, async client => {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await authorize(client, input.companyId, input.actorId);
      const { rows } = await client.query(confirm
        ? 'SELECT public.confirm_history_adoption($1,$2,$3::uuid[],$4,$5) AS result'
        : 'SELECT public.prepare_history_adoption($1,$2,$3::uuid[]) AS result',
      confirm ? [input.companyId,input.actorId,ids,input.key,input.confirmed] : [input.companyId,input.actorId,ids]);
      return rows[0].result;
    });
  } catch (error) {
    if (error.code === '42501') throw stock.fail('No tenés permisos para adoptar antecedentes.',403);
    if (error.code === '22023') throw stock.fail('Revisá los registros y la confirmación.',400);
    if (error.code === 'P0001') {
      const failure = stock.fail(error.message,409);
      // Kept separately from response details: the HTTP handler only logs this property.
      if (error.detail) {
        try {
          const diagnostic = JSON.parse(error.detail);
          if (diagnostic.kind === 'historical_adoption_diff') {
            Object.defineProperty(failure, 'adoptionDiagnostic', { value: diagnostic });
          }
        } catch { /* An unstructured database detail is not a public message. */ }
      }
      throw failure;
    }
    if (['55P03','40P01','57014'].includes(error.code)) throw stock.fail('Hay operaciones en curso. Reintentá la adopción en unos momentos.',409);
    throw error;
  }
}
module.exports = { prepare: (pool,input) => run(pool,input,false), confirm: (pool,input) => run(pool,input,true), validateIds };
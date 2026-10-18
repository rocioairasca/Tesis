const { PERMISSIONS, getEffectivePermissions } = require('../constants/permissions');
const { isHistorical, fail } = require('./inventoryImpact');
const sameId = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
// Call only with a DB row read FOR UPDATE inside the operation's transaction.
// Completed rows reach the existing completion service to retain technical retry semantics.
function assertCanExecutePlanning(user, planning) {
  const permissions = user ? getEffectivePermissions(user) : [];
  const editor = permissions.includes('all') || permissions.includes(PERMISSIONS.PLANNING_EDIT);
  if (!sameId(user?.company_id, planning?.company_id) || (!editor &&
      (!permissions.includes(PERMISSIONS.PLANNING_EXECUTE) || !sameId(user?.id, planning?.responsible_user)))) {
    throw fail('No tenés permiso para ejecutar esta tarea.', 403);
  }
  if (planning.enabled !== true || planning.status === 'cancelado') {
    throw fail('No se puede ejecutar una tarea deshabilitada o cancelada.', editor ? 400 : 403);
  }
  if (isHistorical(planning)) throw fail('Este antecedente requiere el flujo administrativo histórico.', 409);
}
module.exports = { assertCanExecutePlanning };

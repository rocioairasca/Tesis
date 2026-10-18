const { cropDescription } = require('./planningFieldContext');
const { selectionKey } = require('./planningSelections');
const { canonical } = require('./inventoryConversion');
const serverFields = ['created_by', 'assigned_by', 'assigned_at', 'actor_user_id'];
const fail = message => Object.assign(new Error(message), { status: 400 });

function rejectClientAuthorship(body) {
  if (serverFields.some(key => Object.hasOwn(body, key)))
    throw fail('La autoría y la asignación se registran automáticamente con tu sesión.');
}
async function resolvePlanningResponsible(client, id, companyId) {
  const { rows } = await client.query(
    'SELECT id, full_name, email FROM users WHERE id=$1 AND company_id=$2 AND enabled=true FOR SHARE', [id, companyId]);
  if (!rows.length) throw fail('Seleccioná un responsable activo de tu empresa.');
  return rows[0];
}
const displayName = user => user?.full_name?.trim() || user?.email?.trim() || 'Usuario';
const activities = { siembra:'Siembra', fumigacion:'Fumigación', fertilizacion:'Fertilización', cosecha:'Cosecha', riego:'Riego', mantenimiento:'Mantenimiento' };
function planningDisplayName(plan) {
  return plan.title?.trim() || (activities[plan.activity_type]
    ? activities[plan.activity_type] + cropDescription(plan.activity_type, plan.field_context, plan.crop_name)
    : 'Trabajo planificado');
}
// Planning stores calendar days as midnight UTC, without local TZ conversion.
const dateKey = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value || '').slice(0,10);
const humanDate = value => dateKey(value).split('-').reverse().join('/');
function formatPlanningPeriod(plan) {
  return dateKey(plan.start_at) === dateKey(plan.end_at)
    ? 'para el ' + humanDate(plan.start_at)
    : 'del ' + humanDate(plan.start_at) + ' al ' + humanDate(plan.end_at);
}
// Compare persisted decimals exactly; never round through a JS floating point number.
const numeric = value => {
  if (value == null) return null;
  const [whole, fraction=''] = String(value).split('.');
  const tail = fraction.replace(/0+$/, '');
  return whole.replace(/^0+(?=\d)/, '') + (tail ? '.' + tail : '');
};
const sorted = rows => rows.map(row => JSON.stringify(row)).sort();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const instant = value => value == null ? null : new Date(value).getTime();
function detectMeaningfulChanges(before, after) {
  const fields = [];
  if (instant(before.start_at) !== instant(after.start_at) || instant(before.end_at) !== instant(after.end_at)) fields.push('dates');
  if ((before.title?.trim() || '') !== (after.title?.trim() || '') || before.activity_type !== after.activity_type) fields.push('work');
  if (before.crop_id !== after.crop_id || before.field_context !== after.field_context) fields.push('crop_context');
  const lots = p => sorted((p.lots || []).map(l => [selectionKey(l), numeric(l.effective_area_ha ?? l.area_ha)]));
  if (!same(lots(before), lots(after))) fields.push('lots');
  const products = p => sorted((p.products || []).map(i => [i.product_id, numeric(i.amount), canonical(i.unit), numeric(i.dose_amount), canonical(i.dose_unit)]));
  if ((before.recipe_id ?? null) !== (after.recipe_id ?? null) || !same(products(before), products(after))) fields.push('products');
  if (before.status !== after.status) fields.push('status');
  return fields;
}
async function snapshot(client, id, companyId) {
  const { rows } = await client.query(
    `SELECT p.*, c.name AS crop_name,
      COALESCE((SELECT json_agg(json_build_object('lot_id',l.lot_id,'sub_lot_id',l.sub_lot_id,'area_ha',l.area_ha::text,'effective_area_ha',to_jsonb(l)->>'effective_area_ha')) FROM planning_lots l WHERE l.planning_id=p.id), '[]') AS lots,
      COALESCE((SELECT json_agg(json_build_object('product_id',i.product_id,'amount',i.amount::text,'unit',i.unit,'dose_amount',to_jsonb(i)->>'dose_amount','dose_unit',to_jsonb(i)->>'dose_unit')) FROM planning_products i WHERE i.planning_id=p.id), '[]') AS products
     FROM planning p LEFT JOIN crops c ON c.id=p.crop_id AND c.company_id=p.company_id
     WHERE p.id=$1 AND p.company_id=$2`, [id, companyId]);
  return rows[0];
}
// Resolve recipients inside the transaction; dispatch only after its COMMIT.
async function prepare(client, { before=null, after, actorId, companyId, operation }) {
  if (!after || after.company_id !== companyId || after.inventory_impact_mode === 'HISTORICAL_NO_STOCK' || operation === 'registerCompleted') return [];
  const actor = await resolvePlanningResponsible(client, actorId, companyId);
  const actorName = displayName(actor), name = planningDisplayName(after), events = [];
  const add = async (target, action, title, message, extra={}) => {
    if (!target || target === actorId) return;
    const {rows} = await client.query('SELECT id FROM users WHERE id=$1 AND company_id=$2 AND enabled=true FOR SHARE', [target,companyId]);
    if (!rows.length) return;
    events.push([target, 'planning_' + action, 'low', title, message,
      {planning_id:after.id, action, actor_user_id:actorId, activity_type:after.activity_type, start_at:after.start_at, end_at:after.end_at, ...extra}, companyId]);
  };
  const assigned = () => add(after.responsible_user, 'assigned', 'Nueva tarea asignada', actorName + ' te asignó “' + name + '” ' + formatPlanningPeriod(after) + '.');
  if (operation === 'create') { await assigned(); return events; }
  if (operation === 'completion' || (before?.status !== 'completado' && after.status === 'completado')) {
    await add(after.assigned_by || after.created_by, 'completed', 'Trabajo completado', actorName + ' completó “' + name + '”.');
    return events;
  }
  if (before?.status !== 'cancelado' && after.status === 'cancelado') {
    await add(after.responsible_user, 'cancelled', 'Tarea cancelada', actorName + ' canceló “' + name + '”.');
    return events;
  }
  if (before && before.responsible_user !== after.responsible_user) {
    await assigned();
    await add(before.responsible_user, 'unassigned', 'Asignación modificada', 'Ya no sos responsable de “' + name + '”.');
    return events;
  }
  const changes = before ? detectMeaningfulChanges(before,after) : [];
  if (changes.length) {
    const labels = {dates:'la fecha', work:'el trabajo', crop_context:'el cultivo o contexto', lots:'la ubicación o superficie', products:'los productos previstos', status:'el estado'};
    const detail = changes.map(key=>labels[key]).join(', ');
    const message = changes.length === 1 && changes[0] === 'dates'
      ? actorName + ' cambió la fecha de “' + name + '”: ' + formatPlanningPeriod(after) + '.'
      : actorName + ' actualizó “' + name + '”: cambió ' + detail + '.';
    await add(after.responsible_user, 'updated', 'Cambios en una tarea asignada', message, {changed_fields:changes});
  }
  return events;
}
async function dispatch(events, createNotification) {
  for (const event of events) {
    try { await createNotification(...event); }
    catch { console.error('No se pudo enviar una notificación de planificación confirmada.'); }
  }
}
module.exports = { rejectClientAuthorship, resolvePlanningResponsible, displayName, planningDisplayName, formatPlanningPeriod, detectMeaningfulChanges, snapshot, prepare, dispatch };

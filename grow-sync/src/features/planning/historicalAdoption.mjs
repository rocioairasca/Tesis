export function canAdoptExisting(user, row, cutoff) {
  const permissions = Array.isArray(user?.custom_permissions) ? user.custom_permissions : (Number(user?.role) === 3 ? ['all'] : []);
  if (Number(user?.role) !== 3 || !['planning.edit','history.import'].every(p => permissions.includes('all') || permissions.includes(p))) return false;
  if (!cutoff || row?.status !== 'completado' || row?.inventory_impact_mode !== 'NORMAL' || row?.historical_import_id) return false;
  let date = row.effective_date;
  if (!date && row.end_at) {
    const parsed = new Date(row.end_at);
    if (!Number.isFinite(parsed.getTime())) return false;
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(parsed);
    const get = type => parts.find(p => p.type === type).value;
    date = `${get('year')}-${get('month')}-${get('day')}`;
  }
  return Boolean(date && String(date).slice(0,10) < cutoff);
}
export const adoptionApi = api => ({
  prepare: async ids => (await api.post('/history/adopt-existing/prepare',{planning_ids:ids})).data,
  confirm: async (ids,key) => (await api.post('/history/adopt-existing/confirm',{
    planning_ids:ids,confirmed_no_stock:true
  },{headers:{'Idempotency-Key':key}})).data,
});
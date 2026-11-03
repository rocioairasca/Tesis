// Inclusive calendar dates, independent of administrative status.
const dateKey = value => value == null ? null : value instanceof Date
  ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const operationalWindow = campaign => ({
  start: dateKey(campaign.work_start_date ?? campaign.start_date),
  end: dateKey(campaign.work_end_date ?? campaign.end_date),
});
const operationalSql = (alias = '') => {
  if (alias && !/^[a-z_]+$/i.test(alias)) throw new Error('Invalid SQL alias');
  const p = alias ? `${alias}.` : '';
  return { start: `COALESCE(${p}work_start_date, ${p}start_date)`, end: `COALESCE(${p}work_end_date, ${p}end_date)` };
};
const campaignDateIssues = campaign => {
  const start = dateKey(campaign.start_date), end = dateKey(campaign.end_date);
  const workStart = dateKey(campaign.work_start_date), workEnd = dateKey(campaign.work_end_date);
  const issues = [];
  if (workStart && start && workStart > start) issues.push({ path: 'work_start_date', message: 'La fecha "Trabajos desde" no puede ser posterior al inicio oficial.' });
  if (end && start && start > end) issues.push({ path: 'end_date', message: 'El fin oficial no puede ser anterior al inicio oficial.' });
  if (workEnd && (!end || workEnd < end)) issues.push({ path: 'work_end_date', message: 'El fin de trabajos requiere un fin oficial y no puede ser anterior a él.' });
  return issues;
};
const windowReduced = (before, after) => after.start > before.start || (after.end != null && (before.end == null || after.end < before.end));
module.exports = { dateKey, operationalWindow, operationalSql, campaignDateIssues, windowReduced };

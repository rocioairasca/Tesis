// Identity and chronology are independent. Never parse a name as a date.
const text = value => typeof value === 'string' && value.trim() ? value : null;
const dateKey = value => {
  if (typeof value !== 'string') return null;
  const key = value.slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === key ? key : null;
};
const relatedCampaign = row => row && ['campaign_id','campaign_name','campaign_start_date','campaign_start'].some(key=>Object.hasOwn(row,key));
export const campaignStart = row => dateKey(relatedCampaign(row) ? row.campaign_start_date ?? row.campaign_start : row?.campaign?.start_date ?? row?.start_date);
export const campaignEnd = row => dateKey(relatedCampaign(row) ? row.campaign_end_date : row?.campaign?.end_date ?? row?.end_date);
export function campaignPeriod(row) {
  const start = campaignStart(row), end = campaignEnd(row);
  if (!start) return '';
  return end && end.slice(0,4) !== start.slice(0,4) ? `${start.slice(0,4)}/${end.slice(2,4)}` : start.slice(0,4);
}
export function campaignLabel(row) {
  if (typeof row === 'string') return text(row) || 'No informada';
  return text(row?.campaign_name) || text(row?.campaign?.name) || text(row?.name)
    || campaignPeriod(row) || text(row?.campaign) || 'No informada';
}
export const campaignValue = row => typeof row === 'string' ? row : row?.campaign_id ?? row?.campaign?.id ?? row?.campaign ?? row?.campaign_name ?? row?.id ?? campaignLabel(row);
export function sortCampaigns(rows, direction = 'asc') {
  return [...rows].sort((a,b) => {
    const left=campaignStart(a), right=campaignStart(b);
    if (!left || !right) return left ? -1 : right ? 1 : 0;
    return (direction === 'desc' ? -1 : 1) * left.localeCompare(right);
  });
}
export const campaignOptions = rows => sortCampaigns(rows,'desc').map(row=>({value:campaignValue(row),label:campaignLabel(row)}));
export const campaignFilterOptions = data => campaignOptions(data?.campaign_details ?? data?.campaigns ?? []);

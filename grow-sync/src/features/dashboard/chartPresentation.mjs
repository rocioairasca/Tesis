import { campaignStart, campaignLabel, sortCampaigns } from '../../utils/campaigns.mjs';
import { numberValue } from '../../utils/numberFormat.js';
// Use the server's weighted yield unchanged; missing area is not a zero yield.
export const yieldChartRows = rows => rows.map(row => ({ ...row, chartYield: numberValue(row.area_ha) > 0 ? numberValue(row.yield_kg_ha) : null }));
export function campaignChartRows(rows) {
  return { chronological: rows.every(row=>campaignStart(row)!==null), rows: sortCampaigns(rows).map(row=>({...row,campaign:campaignLabel(row)})) };
}

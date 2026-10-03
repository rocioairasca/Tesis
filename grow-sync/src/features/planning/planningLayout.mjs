// Preserve the readable desktop column widths; switch views when they no longer fit.
export const PLANNING_COLUMN_WIDTHS = {
  crop: 115, activity: 125, lots: 155, period: 145, status: 210,
  area: 105, responsible: 140, campaign: 95, actions: 110,
};
export const PLANNING_TABLE_WIDTH = Object.values(PLANNING_COLUMN_WIDTHS).reduce((sum, width) => sum + width, 0);
export const isCompactPlanningWidth = width => width < PLANNING_TABLE_WIDTH;

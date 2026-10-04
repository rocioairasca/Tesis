const fail = message => Object.assign(new Error(message), {status:400});
const PARTIAL_ACTIVITIES = new Set(['fumigacion','fertilizacion','riego','mantenimiento','otro']);
function validateEffectiveArea(value, structural, activityType, subLotId) {
  if(value === undefined || value === null) return null;
  const text=String(value).trim().replace(',', '.');
  if(!/^\d+(?:\.\d{1,4})?$/.test(text) || !Number.isFinite(Number(text)) || Number(text)<=0)
    throw fail('La superficie a trabajar debe ser mayor que cero y tener hasta cuatro decimales.');
  const amount=Number(text), maximum=Number(structural);
  if(!Number.isFinite(maximum) || amount>maximum)
    throw fail('La superficie a trabajar no puede superar la superficie del lote o sublote seleccionado.');
  // Sowing keeps its current full-selection semantics, including existing sublots.
  if(!PARTIAL_ACTIVITIES.has(activityType) && amount<maximum)
    throw fail(activityType==='siembra' ? 'Para una siembra usá toda la superficie seleccionada. Podés seleccionar un sublote existente.' : 'Esta actividad utiliza toda la superficie seleccionada.');
  return text;
}

const normalizeLotSelections = (lotIds = [], lotSelections = null) => {
  if (Array.isArray(lotSelections) && (lotSelections.length > 0 || !Array.isArray(lotIds) || lotIds.length === 0)) {
    return lotSelections.map(item => ({
      lot_id: item.lot_id,
      sub_lot_id: item.sub_lot_id || null,
      effective_area_ha: item.effective_area_ha,
    }));
  }

  if (Array.isArray(lotIds)) {
    return lotIds.map(lotId => ({
      lot_id: lotId,
      sub_lot_id: null,
    }));
  }

  return [];
};

const validateSelectionMix = (selections) => {
  const byLot = new Map();

  for (const selection of selections) {
    const current = byLot.get(selection.lot_id) || { full: false, subLots: new Set() };
    if (selection.sub_lot_id) {
      current.subLots.add(selection.sub_lot_id);
    } else {
      current.full = true;
    }
    byLot.set(selection.lot_id, current);
  }

  for (const [lotId, current] of byLot.entries()) {
    if (current.full && current.subLots.size) {
      const err = new Error('No se puede seleccionar un lote completo junto con sus sublotes');
      err.status = 400;
      err.details = { lot_id: lotId };
      throw err;
    }
  }
};

const selectionKey = (selection) => `${selection.lot_id}:${selection.sub_lot_id || 'full'}`;

const haveSameSelections = (a, b) => {
  if (a.length !== b.length) return false;

  const aKeys = new Set(a.map(selectionKey));
  if (aKeys.size !== b.length) return false;

  return b.every(selection => aKeys.has(selectionKey(selection)));
};

const resolveLotSelections = async (client, selections, companyId, options = {}) => {
  const allowHistoricalSelectionKeys = options.allowHistoricalSelectionKeys || new Set();
  validateSelectionMix(selections);

  if (!selections.length) return [];

  const lotIds = selections.map(item => item.lot_id);
  const subLotIds = selections.map(item => item.sub_lot_id);

  const { rows } = await client.query(`
    WITH requested AS (
      SELECT
        lot_id,
        sub_lot_id,
        ord
      FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS r(lot_id, sub_lot_id, ord)
    )
    SELECT
      r.ord,
      r.lot_id,
      r.sub_lot_id,
      l.name AS lot_name,
      sl.name AS sub_lot_name,
      CASE
        WHEN r.sub_lot_id IS NULL THEN COALESCE(l.area_ha, NULLIF(l.area, 0)::NUMERIC)
        ELSE sl.area_ha
      END AS area_ha,
      CASE WHEN l.id IS NULL THEN TRUE ELSE FALSE END AS missing_lot,
      CASE
        WHEN r.sub_lot_id IS NULL THEN FALSE
        WHEN sl.id IS NULL THEN TRUE
        ELSE FALSE
      END AS missing_sub_lot,
      ll.status AS layout_status
    FROM requested r
    LEFT JOIN lots l
      ON l.id = r.lot_id
     AND l.company_id = $3
     AND COALESCE(l.enabled, TRUE) IS TRUE
    LEFT JOIN sub_lots sl
      ON sl.id = r.sub_lot_id
     AND sl.lot_id = r.lot_id
     AND sl.company_id = $3
     AND COALESCE(sl.enabled, TRUE) IS TRUE
    LEFT JOIN lot_layouts ll
      ON ll.id = sl.layout_id
     AND ll.lot_id = r.lot_id
     AND ll.company_id = $3
    ORDER BY r.ord;
  `, [lotIds, subLotIds, companyId]);

  const invalidLot = rows.find(row => row.missing_lot);
  if (invalidLot) {
    const err = new Error('El lote seleccionado no existe o no pertenece a la empresa');
    err.status = 400;
    err.details = { lot_id: invalidLot.lot_id };
    throw err;
  }

  const invalidSubLot = rows.find(row => row.missing_sub_lot);
  if (invalidSubLot) {
    const err = new Error('El sublote seleccionado no existe o no pertenece al lote indicado');
    err.status = 400;
    err.details = { lot_id: invalidSubLot.lot_id, sub_lot_id: invalidSubLot.sub_lot_id };
    throw err;
  }

  const inactiveSubLot = rows.find(row => (
    row.sub_lot_id
    && row.layout_status !== 'active'
    && !allowHistoricalSelectionKeys.has(`${row.lot_id}:${row.sub_lot_id}`)
  ));
  if (inactiveSubLot) {
    const err = new Error('El sublote seleccionado ya no corresponde a la división vigente del lote.');
    err.status = 400;
    err.details = { lot_id: inactiveSubLot.lot_id, sub_lot_id: inactiveSubLot.sub_lot_id };
    throw err;
  }

  const missingArea = rows.find(row => row.area_ha === null || !Number.isFinite(Number(row.area_ha)) || Number(row.area_ha) <= 0);
  if (missingArea) {
    const err = new Error('No se pudo determinar la superficie del lote o sublote seleccionado');
    err.status = 400;
    err.details = { lot_id: missingArea.lot_id, sub_lot_id: missingArea.sub_lot_id };
    throw err;
  }

  return rows.map((row,index) => ({
    effective_area_ha: validateEffectiveArea(selections[index].effective_area_ha, row.area_ha, options.activityType, row.sub_lot_id),
    lot_id: row.lot_id,
    sub_lot_id: row.sub_lot_id || null,
    area_ha: row.area_ha,
  }));
};

const checkLotScheduleConflicts = async (client, selections, startAt, endAt, companyId, excludePlanningId = null) => {
  if (!selections.length || !startAt || !endAt) return [];

  const lotIds = selections.map(item => item.lot_id);
  const subLotIds = selections.map(item => item.sub_lot_id);
  const params = [lotIds, subLotIds, startAt, endAt, companyId];
  const excludeSql = excludePlanningId ? 'AND p.id <> $6' : '';
  if (excludePlanningId) params.push(excludePlanningId);

  const { rows } = await client.query(`
    WITH requested AS (
      SELECT lot_id, sub_lot_id
      FROM unnest($1::uuid[], $2::uuid[]) AS r(lot_id, sub_lot_id)
    )
    SELECT DISTINCT pl.lot_id, pl.sub_lot_id
    FROM planning p
    JOIN planning_lots pl ON pl.planning_id = p.id
    JOIN requested r ON r.lot_id = pl.lot_id
    WHERE p.status <> 'cancelado'
      AND p.date_range && tstzrange($3::timestamptz, $4::timestamptz, '[]')
      AND p.company_id = $5
      ${excludeSql}
      AND (
        r.sub_lot_id IS NULL
        OR pl.sub_lot_id IS NULL
        OR pl.sub_lot_id = r.sub_lot_id
      );
  `, params);

  return rows;
};

const insertPlanningLots = async (client, planningId, selections) => {
  if (!selections.length) return;

  const params = [planningId];
  const values = selections.map((selection, index) => {
    const base = index * 4 + 2;
    params.push(selection.lot_id, selection.sub_lot_id, selection.area_ha, selection.effective_area_ha ?? null);
    return `($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3})`;
  });

  await client.query(
    `INSERT INTO planning_lots(planning_id, lot_id, sub_lot_id, area_ha, effective_area_ha) VALUES ${values.join(',')}`,
    params
  );
};

module.exports={normalizeLotSelections,resolveLotSelections,selectionKey,haveSameSelections,checkLotScheduleConflicts,insertPlanningLots,validateEffectiveArea};

const { pool } = require('../db/supabaseClient');
const { parsePage, parsePageSize } = require('../utils/pagination');
const { createNotification } = require('./notifications');
const { PERMISSIONS, getEffectivePermissions } = require('../constants/permissions');
const planningCompletion = require('../services/planningCompletion');

const lotSelectionJsonSql = `
  SELECT json_agg(
    json_build_object(
      'id', l.id,
      'name', CASE
        WHEN sl.id IS NULL THEN l.name
        ELSE l.name || ' / ' || sl.name
      END,
      'lot_id', l.id,
      'lot_name', l.name,
      'lot_geom', ST_AsGeoJSON(l.geom)::json,
      'lot_location', l.location,
      'sub_lot_id', sl.id,
      'sub_lot_name', sl.name,
      'sub_lot_geom', ST_AsGeoJSON(sl.geom)::json,
      'area_ha', pl.area_ha
    )
    ORDER BY l.name, sl.sort_order NULLS FIRST, sl.code NULLS FIRST
  )
  FROM planning_lots pl
  JOIN lots l ON l.id = pl.lot_id
  LEFT JOIN sub_lots sl ON sl.id = pl.sub_lot_id
  WHERE pl.planning_id = b.id
`;

const plannedAreaSql = `
  SELECT COALESCE(ROUND(SUM(pl.area_ha)::NUMERIC, 4), 0)
  FROM planning_lots pl
  WHERE pl.planning_id = b.id
`;

const ACTIVITIES_REQUIRING_CROP = new Set(['fumigacion', 'siembra', 'cosecha', 'fertilizacion']);

const validateRequiredCrop = (activityType, cropId) => {
  if (ACTIVITIES_REQUIRING_CROP.has(activityType) && !cropId) {
    const err = new Error('Seleccioná un cultivo.');
    err.status = 400;
    throw err;
  }
};

const resolveCrop = async (client, cropId, companyId, options = {}) => {
  if (!cropId) return null;

  const { allowDisabledCropId = null } = options;
  const { rows } = await client.query(
    `
    SELECT id, name, enabled
    FROM crops
    WHERE id = $1
      AND company_id = $2
    LIMIT 1;
    `,
    [cropId, companyId]
  );

  if (!rows.length) {
    const err = new Error('El cultivo seleccionado no existe');
    err.status = 400;
    throw err;
  }

  const crop = rows[0];
  if (!crop.enabled && crop.id !== allowDisabledCropId) {
    const err = new Error('El cultivo seleccionado no está disponible');
    err.status = 400;
    throw err;
  }

  return crop;
};

const assertCropFilterBelongsToCompany = async (cropId, companyId) => {
  if (!cropId) return;

  const { rows } = await pool.query(
    'SELECT 1 FROM crops WHERE id = $1 AND company_id = $2 LIMIT 1',
    [cropId, companyId]
  );

  if (!rows.length) {
    const err = new Error('El cultivo seleccionado no existe');
    err.status = 400;
    throw err;
  }
};

const assertCampaignFilterBelongsToCompany = async (campaignId, companyId) => {
  if (!campaignId) return;

  const { rows } = await pool.query(
    'SELECT 1 FROM campaigns WHERE id = $1 AND company_id = $2 LIMIT 1',
    [campaignId, companyId]
  );

  if (!rows.length) {
    const err = new Error('La campaña seleccionada no existe');
    err.status = 400;
    throw err;
  }
};

const assertLotFilterBelongsToCompany = async (lotId, companyId) => {
  if (!lotId) return;

  const { rows } = await pool.query(
    'SELECT 1 FROM lots WHERE id = $1 AND company_id = $2 LIMIT 1',
    [lotId, companyId]
  );

  if (!rows.length) {
    const err = new Error('El lote seleccionado no existe');
    err.status = 400;
    throw err;
  }
};

const assertSubLotFilterBelongsToCompany = async (subLotId, companyId) => {
  if (!subLotId) return;

  const { rows } = await pool.query(
    'SELECT 1 FROM sub_lots WHERE id = $1 AND company_id = $2 LIMIT 1',
    [subLotId, companyId]
  );

  if (!rows.length) {
    const err = new Error('El sublote seleccionado no existe');
    err.status = 400;
    throw err;
  }
};

const hasEffectivePermission = (user, permission) => {
  const permissions = getEffectivePermissions(user || {});
  return permissions.includes('all') || permissions.includes(permission);
};

const PLANNING_STATUS_TRANSITIONS = {
  planificado: new Set(['pendiente', 'en_progreso', 'completado']),
  pendiente: new Set(['planificado', 'en_progreso', 'completado']),
  en_progreso: new Set(['pendiente', 'completado']),
  completado: new Set(['pendiente']),
  cancelado: new Set([]),
};

const PLANNING_STATUS_LABELS = {
  planificado: 'planificado',
  pendiente: 'pendiente',
  en_progreso: 'en progreso',
  completado: 'completado',
  cancelado: 'cancelado',
};

const planningStatusLabel = (status) => PLANNING_STATUS_LABELS[status] || 'otro estado';

const ACTIVITY_LABELS = {
  siembra: 'siembra',
  fumigacion: 'fumigación',
  cosecha: 'cosecha',
  fertilizacion: 'fertilización',
  riego: 'riego',
  mantenimiento: 'mantenimiento',
  otro: 'actividad',
};

const activityLabel = (activityType) => ACTIVITY_LABELS[activityType] || 'actividad';

const assertPlanningStatusTransition = (currentStatus, nextStatus) => {
  if (!nextStatus) return;

  if (nextStatus === currentStatus) return;

  const allowed = PLANNING_STATUS_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.has(nextStatus)) {
    const err = new Error('Transición de estado no permitida para la planificación');
    err.status = 400;
    err.details = { current_status: currentStatus, next_status: nextStatus };
    throw err;
  }
};

const assertSowingUsesCompletionEndpoint = (activityType, nextStatus) => {
  if (activityType === 'siembra' && nextStatus === 'completado') {
    const err = new Error('Para completar una siembra, confirmá la fecha efectiva de siembra.');
    err.status = 400;
    throw err;
  }
};

const calendarDateSql = (param) => `left($${param}::text, 10)::date`;

const campaignWorkStartSql = 'COALESCE(work_start_date, start_date)';

const resolveCampaign = async (client, campaignId, companyId, options = {}) => {
  if (!campaignId) {
    const err = new Error('Seleccioná una campaña.');
    err.status = 400;
    throw err;
  }

  const {
    allowClosedCampaignId = null,
    allowClosedHistorical = false,
    startAt = null,
    endAt = null,
  } = options;
  const { rows } = await client.query(
    `
    SELECT id, name, status, work_start_date, start_date, end_date
    FROM campaigns
    WHERE id = $1
      AND company_id = $2
    LIMIT 1;
    `,
    [campaignId, companyId]
  );

  if (!rows.length) {
    const err = new Error('La campaña seleccionada no existe');
    err.status = 400;
    throw err;
  }

  const campaign = rows[0];
  if (startAt && endAt) {
    const { rows: dateRows } = await client.query(
      `
      WITH compatible_campaigns AS (
        SELECT id, name, status, start_date
        FROM campaigns
        WHERE company_id = $5
          AND ${calendarDateSql(1)} >= ${campaignWorkStartSql}
          AND (end_date IS NULL OR ${calendarDateSql(1)} <= end_date)
      )
      SELECT
        (
          ${calendarDateSql(1)} >= $3::date
          AND ($4::date IS NULL OR ${calendarDateSql(2)} <= $4::date)
        ) AS matches_campaign,
        (
          SELECT CASE
            WHEN COUNT(*) = 1 THEN (
              SELECT json_build_object('id', id, 'name', name, 'status', status)
              FROM compatible_campaigns
              ORDER BY start_date DESC, name ASC
              LIMIT 1
            )
            ELSE NULL
          END
          FROM compatible_campaigns
          LIMIT 1
        ) AS suggested_campaign;
      `,
      [startAt, endAt, campaign.work_start_date || campaign.start_date, campaign.end_date, companyId]
    );

    if (!dateRows[0]?.matches_campaign) {
      const err = new Error('La campaña seleccionada no admite trabajos en las fechas indicadas.');
      err.status = 400;
      err.details = { suggested_campaign: dateRows[0]?.suggested_campaign || null };
      throw err;
    }
  }

  if (
    campaign.status !== 'active'
    && campaign.id !== allowClosedCampaignId
    && !allowClosedHistorical
  ) {
    const err = new Error('La campaña seleccionada está cerrada');
    err.status = 400;
    throw err;
  }

  return campaign;
};

const normalizeLotSelections = (lotIds = [], lotSelections = null) => {
  if (Array.isArray(lotSelections) && (lotSelections.length > 0 || !Array.isArray(lotIds) || lotIds.length === 0)) {
    return lotSelections.map(item => ({
      lot_id: item.lot_id,
      sub_lot_id: item.sub_lot_id || null,
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

  const missingArea = rows.find(row => row.area_ha === null || Number(row.area_ha) <= 0);
  if (missingArea) {
    const err = new Error('No se pudo determinar la superficie del lote o sublote seleccionado');
    err.status = 400;
    err.details = { lot_id: missingArea.lot_id, sub_lot_id: missingArea.sub_lot_id };
    throw err;
  }

  return rows.map(row => ({
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
    const base = index * 3 + 2;
    params.push(selection.lot_id, selection.sub_lot_id, selection.area_ha);
    return `($1, $${base}, $${base + 1}, $${base + 2})`;
  });

  await client.query(
    `INSERT INTO planning_lots(planning_id, lot_id, sub_lot_id, area_ha) VALUES ${values.join(',')}`,
    params
  );
};

/**
 * Controlador: Planificación
 * Ubicación: controllers/planning.js
 * Descripción:
 *  Maneja la gestión de planificaciones (actividades agrícolas).
 * Opciones: includeDisabled, includeCanceled
 */

/**
 * LISTAR PLANIFICACIONES (habilitadas por defecto)
 */
exports.list = async (req, res, next) => {
  try {
    const {
      from, to, type, status, responsible, lotId, search,
      cropId, campaignId, subLotId,
      includeDisabled = false, includeCanceled = false,
      page = 1, pageSize = 20
    } = req.query;

    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }
    await assertCropFilterBelongsToCompany(cropId, company_id);
    await assertCampaignFilterBelongsToCompany(campaignId, company_id);
    await assertLotFilterBelongsToCompany(lotId, company_id);
    await assertSubLotFilterBelongsToCompany(subLotId, company_id);

    // Build WHERE dinámico
    let p = [company_id];
    const w = [`p.company_id = $1`];

    // Soft delete / cancelados (por defecto se ocultan)
    if (!includeDisabled) w.push(`p.enabled IS TRUE`);
    if (!includeCanceled) w.push(`p.status <> 'cancelado'`);

    if (from && to) {
      p.push(from, to);
      w.push(`p.date_range && tstzrange($${p.length - 1}, $${p.length}, '[]')`);
    }

    if (type) {
      p.push(type);
      w.push(`p.activity_type = $${p.length}`);
    }

    // Filtro por estado usa el estado "efectivo" (derivado en_demora si pasa end_at)
    if (status) {
      p.push(status);
      w.push(`(
        CASE
          WHEN p.status NOT IN ('completado','cancelado') AND now() > p.end_at
          THEN 'en_demora'
          ELSE p.status
        END
      ) = $${p.length}`);
    }

    if (responsible) {
      p.push(responsible);
      w.push(`p.responsible_user = $${p.length}`);
    }

    if (lotId) {
      p.push(lotId);
      w.push(`EXISTS (
        SELECT 1
        FROM planning_lots pl
        WHERE pl.planning_id = p.id AND pl.lot_id = $${p.length}
      )`);
    }

    if (subLotId) {
      p.push(subLotId);
      w.push(`EXISTS (
        SELECT 1
        FROM planning_lots pl
        WHERE pl.planning_id = p.id AND pl.sub_lot_id = $${p.length}
      )`);
    }

    if (cropId) {
      p.push(cropId);
      w.push(`p.crop_id = $${p.length}`);
    }

    if (campaignId) {
      p.push(campaignId);
      w.push(`p.campaign_id = $${p.length}`);
    }

    if (search) {
      p.push(`%${search}%`);
      w.push(`(p.title ILIKE $${p.length} OR p.description ILIKE $${p.length})`);
    }

    const whereSql = w.length ? `WHERE ${w.join(' AND ')}` : '';

    const limit = parsePageSize(pageSize, 20, 1000);
    const offset = (parsePage(page, 1) - 1) * limit;

    // 1) COUNT total (sin LIMIT/OFFSET)
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM planning p
      JOIN users u ON u.id = p.responsible_user
      ${whereSql};
    `;
    const { rows: countRows } = await pool.query(countSql, p.slice());
    const total = countRows?.[0]?.total ?? 0;

    // 2) DATA con LIMIT/OFFSET
    p.push(limit, offset);
    const dataSql = `
      WITH base AS (
        SELECT p.*,
               CASE
                 WHEN p.status NOT IN ('completado','cancelado') AND now() > p.end_at
                 THEN 'en_demora' ELSE p.status
               END AS status_effective,
               u.name AS responsible_name,
               c.name AS crop_name,
               cp.name AS campaign_name
        FROM planning p
        JOIN users u ON u.id = p.responsible_user
        LEFT JOIN crops c ON c.id = p.crop_id AND c.company_id = p.company_id
        LEFT JOIN campaigns cp ON cp.id = p.campaign_id AND cp.company_id = p.company_id
        ${whereSql}
        ORDER BY p.start_at DESC
        LIMIT $${p.length - 1} OFFSET $${p.length}
      )
      SELECT b.*,
             COALESCE((
               ${lotSelectionJsonSql}
             ), '[]') AS lots,
             (${plannedAreaSql}) AS planned_area_ha,
             COALESCE((
               SELECT json_agg(json_build_object('id', pp.id, 'product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit, 'available_quantity', pr.available_quantity))
               FROM planning_products pp
               JOIN products pr ON pr.id = pp.product_id
               WHERE pp.planning_id = b.id
             ), '[]') AS products
      FROM base b;
    `;
    const { rows } = await pool.query(dataSql, p);

    return res.json({
      data: rows,
      page: Number(page),
      pageSize: limit,
      total,
    });
  } catch (e) {
    next(e);
  }
};

/**
 * OBTENER UNA PLANIFICACIÓN POR ID
 * Incluye lotes y productos asociados
 */
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    const sql = `
      WITH base AS (
        SELECT p.*,
               CASE
                 WHEN p.status NOT IN ('completado','cancelado') AND now() > p.end_at
                 THEN 'en_demora' ELSE p.status
               END AS status_effective,
               u.name AS responsible_name,
               c.name AS crop_name,
               cp.name AS campaign_name
        FROM planning p
        JOIN users u ON u.id = p.responsible_user
        LEFT JOIN crops c ON c.id = p.crop_id AND c.company_id = p.company_id
        LEFT JOIN campaigns cp ON cp.id = p.campaign_id AND cp.company_id = p.company_id
        WHERE p.id = $1 AND p.company_id = $2
        LIMIT 1
      )
      SELECT b.*,
             COALESCE((
               ${lotSelectionJsonSql}
             ), '[]') AS lots,
             (${plannedAreaSql}) AS planned_area_ha,
             COALESCE((
               SELECT json_agg(json_build_object('id', pp.id, 'product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit, 'available_quantity', pr.available_quantity))
               FROM planning_products pp
               JOIN products pr ON pr.id = pp.product_id
               WHERE pp.planning_id = b.id
             ), '[]') AS products
      FROM base b;
    `;

    const { rows } = await pool.query(sql, [id, company_id]);

    if (!rows.length) {
      return res.status(404).json({ message: 'No encontramos la planificación solicitada.' });
    }

    return res.json(rows[0]);
  } catch (e) {
    next(e);
  }
};

/**
 * CREAR PLANIFICACIÓN
 * Valida conflictos de fechas en lotes y vehículo.
 * Inserta lotes/productos relacionados.
 */
const createPlanningRecord = async (
  client,
  {
    body,
    companyId,
    userId,
    allowClosedHistorical = false,
    forcedStatus = null,
    skipScheduleConflicts = false,
  }
) => {
  const {
    title,
    description,
    activity_type,
    start_at,
    end_at,
    responsible_user,
    status = 'pendiente',
    vehicle_id,
    campaign_id,
    crop_id,
    lot_ids = [],
    lot_selections,
    products = [],
    created_by,
  } = body;

  const effectiveStatus = forcedStatus || status;
  const creator = created_by || userId || null;

  await resolveCampaign(client, campaign_id, companyId, {
    startAt: start_at,
    endAt: end_at,
    allowClosedHistorical,
  });
  validateRequiredCrop(activity_type, crop_id);
  assertSowingUsesCompletionEndpoint(activity_type, effectiveStatus);
  const resolvedCrop = await resolveCrop(client, crop_id, companyId);

  const requestedSelections = normalizeLotSelections(lot_ids, lot_selections);
  const resolvedSelections = await resolveLotSelections(client, requestedSelections, companyId);

  if (!skipScheduleConflicts && resolvedSelections.length && start_at && end_at) {
    const conflicts = await checkLotScheduleConflicts(client, resolvedSelections, start_at, end_at, companyId);
    if (conflicts.length) {
      const err = new Error('Ya existe una planificación para ese lote o sublote en el mismo período.');
      err.status = 409;
      throw err;
    }
  }

  if (!skipScheduleConflicts && vehicle_id && start_at && end_at) {
    const q = `
      SELECT 1
      FROM planning p
      WHERE p.vehicle_id = $1
        AND p.status <> 'cancelado'
        AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]')
        AND p.company_id = $4
      LIMIT 1;
    `;
    const { rows } = await client.query(q, [vehicle_id, start_at, end_at, companyId]);
    if (rows.length) {
      const err = new Error('El vehículo ya está asignado en ese período.');
      err.status = 409;
      throw err;
    }
  }

  const insertSql = `
    INSERT INTO planning(
      title, description, activity_type, start_at, end_at, campaign_id, crop_id,
      responsible_user, status, vehicle_id, created_by, company_id
    ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id;
  `;
  const { rows: newPlan } = await client.query(insertSql, [
    title?.trim() || null,
    description ?? null,
    activity_type,
    start_at,
    end_at,
    campaign_id,
    crop_id ?? null,
    responsible_user,
    effectiveStatus,
    vehicle_id ?? null,
    creator,
    companyId,
  ]);
  const id = newPlan[0].id;

  await insertPlanningLots(client, id, resolvedSelections);

  if (Array.isArray(products) && products.length) {
    const tuples = products
      .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
      .join(',');
    const params = [id];
    products.forEach(p => {
      params.push(p.product_id, p.amount ?? null, p.unit ?? null);
    });
    await client.query(
      `INSERT INTO planning_products(planning_id, product_id, amount, unit) VALUES ${tuples}`,
      params
    );
  }

  return { id, resolvedCrop, resolvedSelections };
};

exports.create = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { company_id, id: userId } = req.user;
    if (!company_id) {
      client.release();
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    await client.query('BEGIN');
    const { id, resolvedCrop } = await createPlanningRecord(client, {
      body: req.body,
      companyId: company_id,
      userId,
      allowClosedHistorical: hasEffectivePermission(req.user, PERMISSIONS.PLANNING_EDIT),
    });

    await client.query('COMMIT');

    // [NOTIFICACIÓN] Nueva asignación
    if (req.body.responsible_user) {
      createNotification(
        req.body.responsible_user,
        'planning_assigned',
        'low',
        'Nueva planificación asignada',
        `Se te asignó una planificación de ${activityLabel(req.body.activity_type)}${resolvedCrop?.name ? ` para ${resolvedCrop.name}` : ''}.`,
        { planning_id: id, activity_type: req.body.activity_type },
        company_id
      ).catch(err => console.error('Error enviando notificación:', err));
    }

    client.release();
    return res.status(201).json({ id });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    client.release();
    next(e);
  }
};

exports.registerCompleted = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { company_id, id: userId } = req.user;
    if (!company_id) {
      client.release();
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    const effectiveDate = req.body.activity_type === 'siembra'
      ? planningCompletion.getEffectiveSowingDate(req.body.effective_date)
      : planningCompletion.getEffectiveWorkDate(req.body.effective_date);

    await client.query('BEGIN');

    const { id, resolvedCrop } = await createPlanningRecord(client, {
      body: req.body,
      companyId: company_id,
      userId,
      allowClosedHistorical: hasEffectivePermission(req.user, PERMISSIONS.PLANNING_EDIT),
      forcedStatus: 'pendiente',
      skipScheduleConflicts: true,
    });

    const planning = await planningCompletion.getPlanningForCompletion(client, id, company_id);
    let completion;

    if (planning.activity_type === 'siembra') {
      await resolveCrop(client, planning.crop_id, company_id);
      completion = await planningCompletion.completeSowingPlanning(client, planning, {
        effectiveDate,
        companyId: company_id,
        historical: true,
        registeredRetroactively: true,
      });
    } else if (
      planningCompletion.PRODUCT_CONSUMING_ACTIVITIES.has(planning.activity_type)
    ) {
      completion = await planningCompletion.completeWorkPlanning(client, planning, {
        effectiveDate,
        companyId: company_id,
        registeredRetroactively: true,
      });
    } else {
      completion = await planningCompletion.completeActivityWithoutProductiveEffects(client, planning, {
        effectiveDate,
        companyId: company_id,
        registeredRetroactively: true,
      });
    }

    await client.query('COMMIT');

    if (req.body.responsible_user) {
      createNotification(
        req.body.responsible_user,
        'planning_assigned',
        'low',
        'Actividad registrada como realizada',
        `Se registró como realizada una actividad de ${activityLabel(req.body.activity_type)}${resolvedCrop?.name ? ` para ${resolvedCrop.name}` : ''}.`,
        { planning_id: id, activity_type: req.body.activity_type, new_status: 'completado' },
        company_id
      ).catch(err => console.error('Error enviando notificación:', err));
    }

    return res.status(201).json({
      ok: true,
      id,
      status: 'completado',
      effective_date: effectiveDate,
      registered_retroactively: true,
      assignments_created: completion.assignments_created || 0,
      closed_previous_cycles: completion.closed_previous_cycles || 0,
      usage_records_created: completion.usage_records_created || 0,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Esta planificación ya registró sus efectos de completado.' });
    }
    next(e);
  } finally {
    client.release();
  }
};

exports.completeSowing = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { actual_products = [] } = req.body;
    const { company_id } = req.user;
    const effectiveDate = planningCompletion.getEffectiveSowingDate(req.body.effective_date);

    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    await client.query('BEGIN');

    const planning = await planningCompletion.getPlanningForCompletion(client, id, company_id);
    await resolveCrop(client, planning.crop_id, company_id);
    const completion = await planningCompletion.completeSowingPlanning(client, planning, {
      actualProducts: actual_products,
      effectiveDate,
      companyId: company_id,
      registeredRetroactively: false,
    });

    await client.query('COMMIT');

    if (completion.already_applied) {
      return res.status(200).json({
        ok: true,
        already_applied: true,
        message: completion.message,
      });
    }

    if (planning.responsible_user) {
      const locationText = completion.selections
        .map(selection => selection.sub_lot_name || selection.lot_name)
        .join(', ');
      createNotification(
        planning.responsible_user,
        'state_change',
        'low',
        'Siembra completada',
        `Se completó la siembra de ${planning.crop_name || 'cultivo'} en ${locationText}.`,
        { planning_id: id, new_status: 'completado' },
        company_id
      ).catch(err => console.error('Error enviando notificación:', err));
    }

    return res.json({
      ok: true,
      message: completion.planned_products_count
        ? 'La siembra fue completada, el cultivo quedó registrado y se actualizaron los productos utilizados.'
        : 'La siembra fue completada y el cultivo quedó registrado.',
      assignments_created: completion.assignments_created,
      closed_previous_cycles: completion.closed_previous_cycles,
      usage_records_created: completion.usage_records_created,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Esta siembra ya fue registrada en el estado productivo.' });
    }
    next(e);
  } finally {
    client.release();
  }
};

exports.completeWork = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { actual_products = [] } = req.body;
    const effectiveDate = planningCompletion.getEffectiveWorkDate(req.body.effective_date);
    const { company_id } = req.user;

    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    await client.query('BEGIN');

    const planning = await planningCompletion.getPlanningForCompletion(client, id, company_id);
    const completion = await planningCompletion.completeWorkPlanning(client, planning, {
      actualProducts: actual_products,
      effectiveDate,
      companyId: company_id,
      registeredRetroactively: false,
    });

    await client.query('COMMIT');

    if (completion.already_applied) {
      return res.status(200).json({
        ok: true,
        already_applied: true,
        message: completion.message,
      });
    }

    if (planning.responsible_user) {
      const locationText = completion.selections
        .map(selection => selection.sub_lot_name || selection.lot_name)
        .join(', ');
      createNotification(
        planning.responsible_user,
        'state_change',
        'low',
        'Trabajo completado',
        `Se completó la ${activityLabel(planning.activity_type)}${planning.crop_name ? ` de ${planning.crop_name}` : ''} en ${locationText}.`,
        { planning_id: id, new_status: 'completado' },
        company_id
      ).catch(err => console.error('Error enviando notificación:', err));
    }

    return res.json({
      ok: true,
      message: completion.planned_products_count
        ? 'El trabajo fue completado y los productos utilizados quedaron registrados.'
        : 'El trabajo fue completado.',
      usage_records_created: completion.usage_records_created,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Esta planificación ya registró sus consumos.' });
    }
    next(e);
  } finally {
    client.release();
  }
};

/**
 * ACTUALIZAR PLANIFICACIÓN
 * Revalida conflictos si cambian fechas/lotes/vehículo.
 * Actualiza relaciones (borra y reinserta lotes/productos).
 */
exports.update = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      title, description, activity_type, start_at, end_at,
      responsible_user, status, vehicle_id, campaign_id, crop_id, lot_ids, lot_selections, products
    } = req.body;

    const { company_id } = req.user;
    if (!company_id) {
      client.release();
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    await client.query('BEGIN');

    // Verificar que la planificación pertenezca a la compañía
    const checkSql = 'SELECT id, start_at, end_at, activity_type, campaign_id, crop_id, status, enabled FROM planning WHERE id = $1 AND company_id = $2';
    const { rows: checkRows } = await client.query(checkSql, [id, company_id]);
    if (checkRows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ message: 'No encontramos la planificación solicitada.' });
    }

    const { rows: productCompletionRows } = await client.query(
      `
      SELECT 1
      FROM planning_product_completions ppc
      WHERE ppc.planning_id = $1
      LIMIT 1;
      `,
      [id]
    );
    const hasProductCompletions = productCompletionRows.length > 0;
    const updatesProductImpactStructure = (
      products !== undefined
      || lot_ids !== undefined
      || lot_selections !== undefined
      || start_at !== undefined
      || end_at !== undefined
      || crop_id !== undefined
      || campaign_id !== undefined
      || activity_type !== undefined
    );

    if (hasProductCompletions && updatesProductImpactStructure) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        message: 'Esta planificación ya registró consumos de productos. Corregí los usos asociados antes de modificarla.',
      });
    }

    if (status !== undefined) {
      assertPlanningStatusTransition(checkRows[0].status, status);
      assertSowingUsesCompletionEndpoint(activity_type ?? checkRows[0].activity_type, status);

      if (hasProductCompletions && checkRows[0].status === 'completado' && status !== 'completado') {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: 'Esta planificación ya registró consumos de productos. Corregí los usos asociados antes de reabrirla.',
        });
      }

      if (checkRows[0].status === 'completado' && status !== 'completado') {
        const { rows: sourcedAssignments } = await client.query(
          `
          SELECT 1
          FROM crop_assignments
          WHERE source_planning_id = $1
            AND company_id = $2
          LIMIT 1;
          `,
          [id, company_id]
        );

        if (sourcedAssignments.length) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({
            message: 'Esta siembra ya actualizó el estado productivo. Corregí el cultivo registrado antes de reabrirla.',
          });
        }
      }
    }

    if (campaign_id !== undefined) {
      await resolveCampaign(client, campaign_id, company_id, {
        allowClosedCampaignId: checkRows[0].campaign_id,
        allowClosedHistorical: hasEffectivePermission(req.user, PERMISSIONS.PLANNING_EDIT),
        startAt: start_at ?? checkRows[0].start_at,
        endAt: end_at ?? checkRows[0].end_at,
      });
    } else if ((start_at !== undefined || end_at !== undefined) && checkRows[0].campaign_id) {
      await resolveCampaign(client, checkRows[0].campaign_id, company_id, {
        allowClosedCampaignId: checkRows[0].campaign_id,
        allowClosedHistorical: hasEffectivePermission(req.user, PERMISSIONS.PLANNING_EDIT),
        startAt: start_at ?? checkRows[0].start_at,
        endAt: end_at ?? checkRows[0].end_at,
      });
    }

    const effectiveActivityType = activity_type ?? checkRows[0].activity_type;
    const effectiveCropId = crop_id !== undefined ? crop_id : checkRows[0].crop_id;
    if (crop_id !== undefined || activity_type !== undefined) {
      validateRequiredCrop(effectiveActivityType, effectiveCropId);
    }
    if (crop_id !== undefined) {
      await resolveCrop(client, crop_id, company_id, {
        allowDisabledCropId: checkRows[0].crop_id,
      });
    }

    const hasLotSelectionsPayload = Array.isArray(lot_selections);
    const hasLegacyLotIdsPayload = Array.isArray(lot_ids);
    const shouldUpdateLots = hasLotSelectionsPayload || hasLegacyLotIdsPayload;
    const shouldCheckLotConflicts = shouldUpdateLots || start_at !== undefined || end_at !== undefined;
    const requestedSelections = shouldUpdateLots
      ? normalizeLotSelections(lot_ids, lot_selections)
      : [];
    let existingSelections = [];

    if (shouldCheckLotConflicts) {
      const { rows } = await client.query(
        'SELECT lot_id, sub_lot_id, area_ha FROM planning_lots WHERE planning_id = $1',
        [id]
      );
      existingSelections = rows.map(row => ({
        lot_id: row.lot_id,
        sub_lot_id: row.sub_lot_id || null,
        area_ha: row.area_ha,
      }));
    }

    const relationChanged = shouldUpdateLots
      ? !haveSameSelections(existingSelections, requestedSelections)
      : false;
    const existingHistoricalKeys = new Set(
      existingSelections
        .filter(row => row.sub_lot_id)
        .map(selectionKey)
    );
    const resolvedSelections = shouldUpdateLots
      ? (
        relationChanged
          ? await resolveLotSelections(client, requestedSelections, company_id, {
            allowHistoricalSelectionKeys: existingHistoricalKeys,
          })
          : existingSelections
      )
      : [];

    // Revalidar conflictos si cambian fecha/lotes/vehículo
    if (shouldCheckLotConflicts) {
      const effectiveStartAt = start_at ?? checkRows[0].start_at;
      const effectiveEndAt = end_at ?? checkRows[0].end_at;
      const selectionsForConflict = shouldUpdateLots ? resolvedSelections : existingSelections;
      const conflicts = await checkLotScheduleConflicts(
        client,
        selectionsForConflict,
        effectiveStartAt,
        effectiveEndAt,
        company_id,
        id
      );
      if (conflicts.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: 'Ya existe una planificación para ese lote o sublote en el mismo período.',
        });
      }
    }

    if (vehicle_id && start_at && end_at) {
      const q = `
        SELECT 1
        FROM planning p
        WHERE p.vehicle_id = $1
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]')
          AND p.id <> $4
          AND p.company_id = $5
        LIMIT 1;
      `;
      const { rows } = await client.query(q, [vehicle_id, start_at, end_at, id, company_id]);
      if (rows.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: 'El vehículo ya está asignado en ese período.',
        });
      }
    }

    // Update parcial
    const sets = [];
    const vals = [];
    const push = (v, k) => {
      vals.push(v);
      sets.push(`${k} = $${vals.length}`);
    };

    if (title !== undefined) push(title?.trim() || null, 'title');
    if (description !== undefined) push(description, 'description');
    if (activity_type !== undefined) push(activity_type, 'activity_type');
    if (start_at !== undefined) push(start_at, 'start_at');
    if (end_at !== undefined) push(end_at, 'end_at');
    if (responsible_user !== undefined) push(responsible_user, 'responsible_user');
    if (status !== undefined) push(status, 'status');
    if (vehicle_id !== undefined) push(vehicle_id, 'vehicle_id');
    if (campaign_id !== undefined) push(campaign_id, 'campaign_id');
    if (crop_id !== undefined) push(crop_id, 'crop_id');

    if (sets.length > 0) {
      vals.push(id, company_id);
      const updateSql = `
        UPDATE planning
        SET ${sets.join(', ')}
        WHERE id = $${vals.length - 1} AND company_id = $${vals.length};
      `;
      await client.query(updateSql, vals);
    }

    // Lotes
    if (shouldUpdateLots && relationChanged) {
      await client.query('DELETE FROM planning_lots WHERE planning_id = $1', [id]);
      await insertPlanningLots(client, id, resolvedSelections);
    }

    // Productos
    if (Array.isArray(products)) {
      await client.query('DELETE FROM planning_products WHERE planning_id = $1', [id]);
      if (products.length) {
        const tuples = products
          .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
          .join(',');
        const params = [id];
        products.forEach(p => {
          params.push(p.product_id, p.amount ?? null, p.unit ?? null);
        });
        await client.query(
          `INSERT INTO planning_products(planning_id, product_id, amount, unit) VALUES ${tuples}`,
          params
        );
      }
    }

    await client.query('COMMIT');

    // [NOTIFICACIÓN] Cambio de estado
    if (status) {
      let targetUser = responsible_user;
      if (!targetUser) {
        const { rows: current } = await client.query(
          'SELECT responsible_user, title FROM planning WHERE id = $1',
          [id]
        );
        targetUser = current[0]?.responsible_user;
      }

      if (targetUser) {
        createNotification(
          targetUser,
          'state_change',
          'low',
          'Cambio de estado en planificación',
          `La planificación cambió a ${planningStatusLabel(status)}.`,
          { planning_id: id, new_status: status },
          company_id
        ).catch(err => console.error('Error enviando notificación:', err));
      }
    }

    client.release();
    res.json({ ok: true });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    client.release();
    next(e);
  }
};

/**
 * DESHABILITAR PLANIFICACIÓN (Soft Delete)
 * Oculta la planificación y la marca como cancelada.
 */
exports.remove = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    if (!company_id) {
      client.release();
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    await client.query('BEGIN');

    // Verificar existencia y compañía
    const checkSql = 'SELECT id, status, enabled FROM planning WHERE id = $1 AND company_id = $2';
    const { rows: checkRows } = await client.query(checkSql, [id, company_id]);
    if (checkRows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ message: 'No encontramos la planificación solicitada.' });
    }

    const current = checkRows[0];
    if (current.status === 'completado') {
      const { rows: productCompletionRows } = await client.query(
        `
        SELECT 1
        FROM planning_product_completions ppc
        WHERE ppc.planning_id = $1
        LIMIT 1;
        `,
        [id]
      );

      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'No se puede cancelar una planificación completada',
        message: productCompletionRows.length
          ? 'Esta planificación ya registró consumos de productos. Corregí los usos asociados antes de cancelarla.'
          : 'Reabrí la planificación antes de cancelarla.',
      });
    }

    if (current.status === 'cancelado' || current.enabled === false) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'La planificación ya está cancelada',
      });
    }

    const updateSql = `
      UPDATE planning
      SET enabled = false, status = 'cancelado'
      WHERE id = $1 AND company_id = $2;
    `;
    await client.query(updateSql, [id, company_id]);

    await client.query('COMMIT');
    client.release();
    res.json({ ok: true });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    client.release();
    next(e);
  }
};

/**
 * LISTAR PLANIFICACIONES DESHABILITADAS
 */
exports.listDisabled = async (req, res, next) => {
  try {
    const {
      page = 1, pageSize = 20,
      status, responsible, lotId, subLotId, cropId, campaignId, search
    } = req.query;

    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }
    await assertCropFilterBelongsToCompany(cropId, company_id);
    await assertCampaignFilterBelongsToCompany(campaignId, company_id);
    await assertLotFilterBelongsToCompany(lotId, company_id);
    await assertSubLotFilterBelongsToCompany(subLotId, company_id);

    let p = [company_id];
    const w = [`p.enabled IS FALSE`, `p.company_id = $1`];

    if (status) {
      p.push(status);
      w.push(`(
        CASE
          WHEN p.status NOT IN ('completado', 'cancelado') AND now() > p.end_at
          THEN 'en_demora'
          ELSE p.status
        END
      ) = $${p.length}`);
    }

    if (responsible) {
      p.push(responsible);
      w.push(`p.responsible_user = $${p.length}`);
    }

    if (lotId) {
      p.push(lotId);
      w.push(`EXISTS (
        SELECT 1
        FROM planning_lots pl
        WHERE pl.planning_id = p.id AND pl.lot_id = $${p.length}
      )`);
    }

    if (subLotId) {
      p.push(subLotId);
      w.push(`EXISTS (
        SELECT 1
        FROM planning_lots pl
        WHERE pl.planning_id = p.id AND pl.sub_lot_id = $${p.length}
      )`);
    }

    if (cropId) {
      p.push(cropId);
      w.push(`p.crop_id = $${p.length}`);
    }

    if (campaignId) {
      p.push(campaignId);
      w.push(`p.campaign_id = $${p.length}`);
    }

    if (search) {
      p.push(`%${search}%`);
      w.push(`(p.title ILIKE $${p.length} OR p.description ILIKE $${p.length})`);
    }

    const whereSql = `WHERE ${w.join(' AND ')}`;
    const limit = parsePageSize(pageSize, 20, 1000);
    const offset = (parsePage(page, 1) - 1) * limit;

    // COUNT
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM planning p
      JOIN users u ON u.id = p.responsible_user
      ${whereSql};
    `;
    const { rows: countRows } = await pool.query(countSql, p.slice());
    const total = countRows?.[0]?.total ?? 0;

    // DATA
    p.push(limit, offset);
    const dataSql = `
      WITH base AS (
        SELECT p.*,
               CASE
                 WHEN p.status NOT IN ('completado', 'cancelado') AND now() > p.end_at
                 THEN 'en_demora' ELSE p.status
               END AS status_effective,
               u.name AS responsible_name,
               c.name AS crop_name,
               cp.name AS campaign_name
        FROM planning p
        JOIN users u ON u.id = p.responsible_user
        LEFT JOIN crops c ON c.id = p.crop_id AND c.company_id = p.company_id
        LEFT JOIN campaigns cp ON cp.id = p.campaign_id AND cp.company_id = p.company_id
        ${whereSql}
        ORDER BY p.start_at DESC
        LIMIT $${p.length - 1} OFFSET $${p.length}
      )
      SELECT b.*,
             COALESCE((
               ${lotSelectionJsonSql}
             ), '[]') AS lots,
             (${plannedAreaSql}) AS planned_area_ha,
             COALESCE((
               SELECT json_agg(json_build_object('id', pp.id, 'product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit, 'available_quantity', pr.available_quantity))
               FROM planning_products pp
               JOIN products pr ON pr.id = pp.product_id
               WHERE pp.planning_id = b.id
             ), '[]') AS products
      FROM base b;
    `;
    const { rows } = await pool.query(dataSql, p);

    return res.json({
      data: rows,
      page: Number(page),
      pageSize: limit,
      total,
    });
  } catch (e) {
    next(e);
  }
};

/**
 * HABILITAR PLANIFICACIÓN (Restaurar)
 */
exports.enable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    const sql = `
      UPDATE planning
      SET enabled = true,
          status = CASE WHEN status = 'cancelado' THEN 'pendiente' ELSE status END
      WHERE id = $1 AND company_id = $2
      RETURNING id, status;
    `;
    const { rows } = await pool.query(sql, [id, company_id]);

    if (!rows.length) {
      return res.status(404).json({ message: 'No encontramos la planificación solicitada.' });
    }

    return res.status(200).json({
      ok: true,
      id: rows[0].id,
      status: rows[0].status,
    });
  } catch (e) {
    next(e);
  }
};

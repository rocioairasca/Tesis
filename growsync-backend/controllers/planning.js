const { pool } = require('../db/supabaseClient');
const { parsePage, parsePageSize } = require('../utils/pagination');
const { createNotification } = require('./notifications');
const { PERMISSIONS, getEffectivePermissions } = require('../constants/permissions');

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
    SELECT id, name, status, start_date, end_date
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
      SELECT
        (
          ${calendarDateSql(1)} >= $3::date
          AND ${calendarDateSql(2)} <= $4::date
        ) AS matches_campaign,
        (
          SELECT json_build_object('id', id, 'name', name, 'status', status)
          FROM campaigns
          WHERE company_id = $5
            AND ${calendarDateSql(1)} BETWEEN start_date AND end_date
          ORDER BY status = 'active' DESC, start_date DESC
          LIMIT 1
        ) AS suggested_campaign;
      `,
      [startAt, endAt, campaign.start_date, campaign.end_date, companyId]
    );

    if (!dateRows[0]?.matches_campaign) {
      const err = new Error('La fecha seleccionada no corresponde a la campaña elegida.');
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

const getEffectiveSowingDate = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const err = new Error('La fecha de siembra no es válida.');
    err.status = 400;
    throw err;
  }
  return String(value);
};

const assertSowingDateMatchesCampaign = async (client, campaignId, companyId, effectiveDate) => {
  const { rows } = await client.query(
    `
    SELECT id, name, status, start_date, end_date
    FROM campaigns
    WHERE id = $1
      AND company_id = $2
      AND $3::date BETWEEN start_date AND end_date
    LIMIT 1;
    `,
    [campaignId, companyId, effectiveDate]
  );

  if (!rows.length) {
    const err = new Error('La fecha de siembra no corresponde a la campaña seleccionada.');
    err.status = 400;
    throw err;
  }

  return rows[0];
};

const resolveOpenCropAssignmentsForSowing = async (client, selection, companyId, effectiveDate) => {
  const { rows } = await client.query(
    `
    WITH selected_surface AS (
      SELECT
        pl.lot_id,
        pl.sub_lot_id,
        COALESCE(sl.geom, l.geom) AS geom
      FROM planning_lots pl
      JOIN lots l
        ON l.id = pl.lot_id
       AND l.company_id = $2
      LEFT JOIN sub_lots sl
        ON sl.id = pl.sub_lot_id
       AND sl.company_id = $2
      WHERE pl.planning_id = $1
        AND pl.lot_id = $3
        AND (
          (pl.sub_lot_id IS NULL AND $4::uuid IS NULL)
          OR pl.sub_lot_id = $4::uuid
        )
      LIMIT 1
    ),
    open_assignments AS (
      SELECT
        ca.id,
        ca.lot_id,
        ca.sub_lot_id,
        COALESCE(ca_sl.geom, ca_lot.geom) AS geom
      FROM crop_assignments ca
      JOIN lots ca_lot
        ON ca_lot.id = ca.lot_id
       AND ca_lot.company_id = $2
      LEFT JOIN sub_lots ca_sl
        ON ca_sl.id = ca.sub_lot_id
       AND ca_sl.company_id = $2
      WHERE ca.company_id = $2
        AND ca.lot_id = $3
        AND ca.start_date < $5::date
        AND (ca.end_date IS NULL OR ca.end_date >= $5::date)
    ),
    measured AS (
      SELECT
        oa.id,
        oa.sub_lot_id,
        ST_Area(ST_CollectionExtract(ST_MakeValid(oa.geom), 3)::geography) AS assignment_area_m2,
        ST_Area(
          ST_CollectionExtract(
            ST_Intersection(
              ST_CollectionExtract(ST_MakeValid(ss.geom), 3),
              ST_CollectionExtract(ST_MakeValid(oa.geom), 3)
            ),
            3
          )::geography
        ) AS intersection_area_m2
      FROM selected_surface ss
      JOIN open_assignments oa ON ss.geom IS NOT NULL AND oa.geom IS NOT NULL
    )
    SELECT
      id,
      sub_lot_id,
      assignment_area_m2,
      intersection_area_m2,
      (assignment_area_m2 - intersection_area_m2) AS outside_selected_m2
    FROM measured
    WHERE intersection_area_m2 > 1;
    `,
    [selection.planning_id, companyId, selection.lot_id, selection.sub_lot_id, effectiveDate]
  );

  const partial = rows.find(row => Number(row.outside_selected_m2 || 0) > 1);
  if (partial) {
    const err = new Error('El lote tiene un cultivo registrado sobre toda su superficie. Antes de completar esta siembra, actualizá el estado productivo para reflejar la nueva división.');
    err.status = 409;
    err.details = { open_assignment_id: partial.id };
    throw err;
  }

  return rows.map(row => row.id);
};

const assertNoRemainingSowingConflicts = async (client, selections, companyId, effectiveDate) => {
  const lotIds = selections.map(selection => selection.lot_id);
  const subLotIds = selections.map(selection => selection.sub_lot_id);

  const { rows } = await client.query(
    `
    WITH requested AS (
      SELECT lot_id, sub_lot_id
      FROM unnest($1::uuid[], $2::uuid[]) AS r(lot_id, sub_lot_id)
    ),
    requested_geom AS (
      SELECT
        r.lot_id,
        r.sub_lot_id,
        COALESCE(sl.geom, l.geom) AS geom
      FROM requested r
      JOIN lots l
        ON l.id = r.lot_id
       AND l.company_id = $3
      LEFT JOIN sub_lots sl
        ON sl.id = r.sub_lot_id
       AND sl.company_id = $3
    ),
    conflicts AS (
      SELECT ca.id
      FROM requested_geom rg
      JOIN crop_assignments ca
        ON ca.company_id = $3
       AND ca.lot_id = rg.lot_id
       AND daterange(ca.start_date, COALESCE(ca.end_date, 'infinity'::date), '[]')
         && daterange($4::date, 'infinity'::date, '[]')
      JOIN lots ca_lot
        ON ca_lot.id = ca.lot_id
       AND ca_lot.company_id = $3
      LEFT JOIN sub_lots ca_sl
        ON ca_sl.id = ca.sub_lot_id
       AND ca_sl.company_id = $3
      WHERE rg.geom IS NOT NULL
        AND COALESCE(ca_sl.geom, ca_lot.geom) IS NOT NULL
        AND ST_Area(
          ST_CollectionExtract(
            ST_Intersection(
              ST_CollectionExtract(ST_MakeValid(rg.geom), 3),
              ST_CollectionExtract(ST_MakeValid(COALESCE(ca_sl.geom, ca_lot.geom)), 3)
            ),
            3
          )::geography
        ) > 1
      LIMIT 1
    )
    SELECT id FROM conflicts;
    `,
    [lotIds, subLotIds, companyId, effectiveDate]
  );

  if (rows.length) {
    const err = new Error('No se pudo registrar el cultivo porque existe un ciclo productivo superpuesto en esa superficie.');
    err.status = 409;
    throw err;
  }
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
               SELECT json_agg(json_build_object('product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit))
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
               SELECT json_agg(json_build_object('product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit))
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
exports.create = async (req, res, next) => {
  const client = await pool.connect();
  try {
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
      created_by, // opcional, si no va el user de req
    } = req.body;

    const { company_id, id: userId } = req.user;
    if (!company_id) {
      client.release();
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    const creator = created_by || userId || null;

    await client.query('BEGIN');

    await resolveCampaign(client, campaign_id, company_id, {
      startAt: start_at,
      endAt: end_at,
      allowClosedHistorical: hasEffectivePermission(req.user, PERMISSIONS.PLANNING_EDIT),
    });
    validateRequiredCrop(activity_type, crop_id);
    assertSowingUsesCompletionEndpoint(activity_type, status);
    const resolvedCrop = await resolveCrop(client, crop_id, company_id);

    const requestedSelections = normalizeLotSelections(lot_ids, lot_selections);
    const resolvedSelections = await resolveLotSelections(client, requestedSelections, company_id);

    // Revalidar conflictos de lotes
    if (resolvedSelections.length && start_at && end_at) {
      const conflicts = await checkLotScheduleConflicts(client, resolvedSelections, start_at, end_at, company_id);
      if (conflicts.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: 'Ya existe una planificación para ese lote o sublote en el mismo período.',
        });
      }
    }

    // Revalidar conflictos de vehículo
    if (vehicle_id && start_at && end_at) {
      const q = `
        SELECT 1
        FROM planning p
        WHERE p.vehicle_id = $1
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]')
          AND p.company_id = $4
        LIMIT 1;
      `;
      const { rows } = await client.query(q, [vehicle_id, start_at, end_at, company_id]);
      if (rows.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: 'El vehículo ya está asignado en ese período.',
        });
      }
    }

    // Insert planning
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
      status,
      vehicle_id ?? null,
      creator,
      company_id,
    ]);
    const id = newPlan[0].id;

    // Insert lotes
    await insertPlanningLots(client, id, resolvedSelections);

    // Insert productos
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

    await client.query('COMMIT');

    // [NOTIFICACIÓN] Nueva asignación
    if (responsible_user) {
      createNotification(
        responsible_user,
        'planning_assigned',
        'low',
        'Nueva planificación asignada',
        `Se te asignó una planificación de ${activityLabel(activity_type)}${resolvedCrop?.name ? ` para ${resolvedCrop.name}` : ''}.`,
        { planning_id: id, activity_type },
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

exports.completeSowing = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    const effectiveDate = getEffectiveSowingDate(req.body.effective_date);

    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    await client.query('BEGIN');

    const { rows: planningRows } = await client.query(
      `
      SELECT
        p.id,
        p.activity_type,
        p.status,
        p.enabled,
        p.campaign_id,
        p.crop_id,
        p.responsible_user,
        c.name AS crop_name,
        cp.name AS campaign_name
      FROM planning p
      LEFT JOIN crops c
        ON c.id = p.crop_id
       AND c.company_id = p.company_id
      LEFT JOIN campaigns cp
        ON cp.id = p.campaign_id
       AND cp.company_id = p.company_id
      WHERE p.id = $1
        AND p.company_id = $2
      FOR UPDATE OF p
      LIMIT 1;
      `,
      [id, company_id]
    );

    if (!planningRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No encontramos la planificación solicitada.' });
    }

    const planning = planningRows[0];

    const { rows: existingSourceRows } = await client.query(
      `
      SELECT id
      FROM crop_assignments
      WHERE source_planning_id = $1
        AND company_id = $2
      LIMIT 1;
      `,
      [id, company_id]
    );

    if (existingSourceRows.length) {
      await client.query('COMMIT');
      return res.status(200).json({
        ok: true,
        already_applied: true,
        message: 'Esta siembra ya fue registrada en el estado productivo.',
      });
    }

    if (planning.activity_type !== 'siembra') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Esta acción sólo está disponible para planificaciones de siembra.' });
    }

    if (planning.status === 'cancelado' || planning.enabled === false) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede completar una planificación cancelada.' });
    }

    if (planning.status === 'completado') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Esta siembra ya está completada. Registrá el cultivo manualmente si corresponde corregir el historial.',
      });
    }

    if (!planning.crop_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La siembra debe tener un cultivo seleccionado.' });
    }

    if (!planning.campaign_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La siembra debe tener una campaña seleccionada.' });
    }

    await resolveCrop(client, planning.crop_id, company_id);
    await assertSowingDateMatchesCampaign(client, planning.campaign_id, company_id, effectiveDate);

    const { rows: selections } = await client.query(
      `
      SELECT
        pl.planning_id,
        pl.lot_id,
        pl.sub_lot_id,
        pl.area_ha,
        l.name AS lot_name,
        sl.name AS sub_lot_name
      FROM planning_lots pl
      JOIN lots l
        ON l.id = pl.lot_id
       AND l.company_id = $2
      LEFT JOIN sub_lots sl
        ON sl.id = pl.sub_lot_id
       AND sl.company_id = $2
      WHERE pl.planning_id = $1
      ORDER BY l.name, sl.sort_order NULLS FIRST, sl.code NULLS FIRST;
      `,
      [id, company_id]
    );

    if (!selections.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La siembra debe tener al menos un lote o sublote seleccionado.' });
    }

    const { rows: previousEndDateRows } = await client.query(
      `SELECT ($1::date - INTERVAL '1 day')::date AS previous_end_date;`,
      [effectiveDate]
    );
    const previousEndDate = previousEndDateRows[0].previous_end_date;
    const closeIds = new Set();

    for (const selection of selections) {
      const idsToClose = await resolveOpenCropAssignmentsForSowing(
        client,
        selection,
        company_id,
        effectiveDate
      );
      idsToClose.forEach(closeId => closeIds.add(closeId));
    }

    if (closeIds.size) {
      await client.query(
        `
        UPDATE crop_assignments
        SET end_date = $1
        WHERE company_id = $2
          AND id = ANY($3::uuid[]);
        `,
        [previousEndDate, company_id, Array.from(closeIds)]
      );
    }

    await assertNoRemainingSowingConflicts(client, selections, company_id, effectiveDate);

    const params = [company_id, planning.campaign_id, planning.crop_id, effectiveDate, id];
    const values = selections.map((selection, index) => {
      const base = index * 3 + 6;
      params.push(selection.lot_id, selection.sub_lot_id, selection.area_ha);
      return `($1, $2, $${base}, $${base + 1}, $3, $4, NULL, $${base + 2}, $5)`;
    });

    const { rows: assignmentRows } = await client.query(
      `
      INSERT INTO crop_assignments (
        company_id, campaign_id, lot_id, sub_lot_id, crop_id, start_date, end_date, area_ha, source_planning_id
      )
      VALUES ${values.join(', ')}
      RETURNING id, lot_id, sub_lot_id;
      `,
      params
    );

    if (assignmentRows.length !== selections.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Esta siembra ya fue registrada en el estado productivo.' });
    }

    await client.query(
      `
      UPDATE planning
      SET status = 'completado'
      WHERE id = $1
        AND company_id = $2;
      `,
      [id, company_id]
    );

    await client.query('COMMIT');

    if (planning.responsible_user) {
      const locationText = selections
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
      message: 'La siembra fue completada y el cultivo quedó registrado.',
      assignments_created: assignmentRows.length,
      closed_previous_cycles: closeIds.size,
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

    if (status !== undefined) {
      assertPlanningStatusTransition(checkRows[0].status, status);
      assertSowingUsesCompletionEndpoint(activity_type ?? checkRows[0].activity_type, status);

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
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'No se puede cancelar una planificación completada',
        message: 'Reabrí la planificación antes de cancelarla.',
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
               SELECT json_agg(json_build_object('product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit))
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

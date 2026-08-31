const { pool } = require('../db/supabaseClient');
const { PERMISSIONS, getEffectivePermissions } = require('../constants/permissions');

const assignmentSelect = `
  ca.id,
  ca.campaign_id,
  ca.lot_id,
  ca.sub_lot_id,
  ca.crop_id,
  ca.start_date,
  ca.end_date,
  ca.area_ha,
  ca.source_planning_id,
  ca.created_at,
  ca.updated_at,
  c.name AS campaign_name,
  l.name AS lot_name,
  sl.name AS sub_lot_name,
  cr.name AS crop_name
`;

const hasEffectivePermission = (user, permission) => {
  const permissions = getEffectivePermissions(user || {});
  return permissions.includes('all') || permissions.includes(permission);
};

const toDateKey = (value) => {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

const assertAssignmentDates = (startDate, endDate = null) => {
  if (!startDate) {
    const err = new Error('Seleccioná la fecha de inicio del ciclo.');
    err.status = 400;
    throw err;
  }

  if (endDate && toDateKey(startDate) > toDateKey(endDate)) {
    const err = new Error('La fecha de inicio no puede ser posterior a la fecha de finalización');
    err.status = 400;
    throw err;
  }
};

const resolveAssignmentTarget = async (
  client,
  { campaign_id, lot_id, sub_lot_id, crop_id, start_date, end_date = null },
  companyId,
  options = {}
) => {
  assertAssignmentDates(start_date, end_date);

  const { rows } = await client.query(
    `
    SELECT
      cp.id AS campaign_id,
      cp.status AS campaign_status,
      cp.start_date AS campaign_start_date,
      cp.end_date AS campaign_end_date,
      l.id AS lot_id,
      COALESCE(l.area_ha, NULLIF(l.area, 0)::NUMERIC) AS lot_area_ha,
      sl.id AS sub_lot_id,
      sl.area_ha AS sub_lot_area_ha,
      ll.status AS layout_status,
      cr.id AS crop_id,
      cr.enabled AS crop_enabled
    FROM (SELECT $1::uuid AS campaign_id, $2::uuid AS lot_id, $3::uuid AS sub_lot_id, $4::uuid AS crop_id) requested
    LEFT JOIN campaigns cp
      ON cp.id = requested.campaign_id
     AND cp.company_id = $5
    LEFT JOIN lots l
      ON l.id = requested.lot_id
     AND l.company_id = $5
     AND COALESCE(l.enabled, TRUE) IS TRUE
    LEFT JOIN sub_lots sl
      ON sl.id = requested.sub_lot_id
     AND sl.lot_id = requested.lot_id
     AND sl.company_id = $5
     AND COALESCE(sl.enabled, TRUE) IS TRUE
    LEFT JOIN lot_layouts ll
      ON ll.id = sl.layout_id
     AND ll.company_id = $5
    LEFT JOIN crops cr
      ON cr.id = requested.crop_id
     AND cr.company_id = $5
    LIMIT 1;
    `,
    [campaign_id, lot_id, sub_lot_id || null, crop_id, companyId]
  );

  const row = rows[0];
  const { allowClosedHistorical = false, allowHistoricalSubLot = false } = options;
  if (!row?.campaign_id) {
    const err = new Error('Campaña no encontrada');
    err.status = 400;
    throw err;
  }
  if (row.campaign_status !== 'active' && !allowClosedHistorical) {
    const err = new Error('La campaña está cerrada');
    err.status = 400;
    throw err;
  }
  if (!row.lot_id) {
    const err = new Error('Lote no encontrado');
    err.status = 400;
    throw err;
  }
  if (sub_lot_id && !row.sub_lot_id) {
    const err = new Error('Sublote no encontrado');
    err.status = 400;
    throw err;
  }
  if (sub_lot_id && row.layout_status !== 'active' && !allowHistoricalSubLot) {
    const err = new Error('El sublote seleccionado ya no corresponde a la división vigente del lote.');
    err.status = 400;
    throw err;
  }
  if (!row.crop_id || !row.crop_enabled) {
    const err = new Error('Cultivo no disponible');
    err.status = 400;
    throw err;
  }
  const { rows: dateRows } = await client.query(
    `
    SELECT (
      $1::date >= $3::date
      AND ($4::date IS NULL OR $2::date IS NULL OR $2::date <= $4::date)
    ) AS matches_campaign;
    `,
    [start_date, end_date, row.campaign_start_date, row.campaign_end_date]
  );

  if (!dateRows[0]?.matches_campaign) {
    const err = new Error('La fecha seleccionada no corresponde a la campaña elegida.');
    err.status = 400;
    throw err;
  }

  const areaHa = sub_lot_id ? row.sub_lot_area_ha : row.lot_area_ha;
  if (areaHa === null || Number(areaHa) <= 0) {
    const err = new Error('No se pudo determinar la superficie');
    err.status = 400;
    throw err;
  }

  return {
    campaign_id,
    lot_id,
    sub_lot_id: sub_lot_id || null,
    crop_id,
    start_date,
    end_date: end_date || null,
    area_ha: areaHa,
  };
};

const validateTemporalSurfaceConflict = async (client, assignment, companyId, excludeId = null) => {
  const params = [
    assignment.campaign_id,
    assignment.lot_id,
    companyId,
    assignment.sub_lot_id,
    assignment.start_date,
    assignment.end_date,
  ];
  let excludeSql = '';
  if (excludeId) {
    params.push(excludeId);
    excludeSql = `AND id <> $${params.length}`;
  }

  const { rows } = await client.query(
    `
    SELECT id, sub_lot_id
    FROM crop_assignments
    WHERE campaign_id = $1
      AND lot_id = $2
      AND company_id = $3
      ${excludeSql}
      AND (
        $4::uuid IS NULL
        OR sub_lot_id IS NULL
        OR sub_lot_id = $4::uuid
      )
      AND daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]')
        && daterange($5::date, COALESCE($6::date, 'infinity'::date), '[]')
    LIMIT 1;
    `,
    params
  );

  if (rows.length) {
    const err = new Error('Ya existe un cultivo asignado para esa superficie en ese período.');
    err.status = 409;
    throw err;
  }
};

const assertCampaignAllowsDates = async (
  client,
  campaignId,
  companyId,
  startDate,
  endDate,
  allowClosedHistorical
) => {
  assertAssignmentDates(startDate, endDate);

  const { rows } = await client.query(
    `
    SELECT id, status, start_date, end_date
    FROM campaigns
    WHERE id = $1
      AND company_id = $2
    LIMIT 1;
    `,
    [campaignId, companyId]
  );

  if (!rows.length) {
    const err = new Error('Campaña no encontrada');
    err.status = 400;
    throw err;
  }

  const campaign = rows[0];
  if (campaign.status !== 'active' && !allowClosedHistorical) {
    const err = new Error('La campaña está cerrada');
    err.status = 400;
    throw err;
  }

  const { rows: dateRows } = await client.query(
    `
    SELECT (
      $1::date >= $3::date
      AND ($4::date IS NULL OR $2::date IS NULL OR $2::date <= $4::date)
    ) AS matches_campaign;
    `,
    [startDate, endDate, campaign.start_date, campaign.end_date]
  );

  if (!dateRows[0]?.matches_campaign) {
    const err = new Error('La fecha seleccionada no corresponde a la campaña elegida.');
    err.status = 400;
    throw err;
  }
};

const assertCropAvailable = async (client, cropId, companyId) => {
  const { rows } = await client.query(
    'SELECT id FROM crops WHERE id = $1 AND company_id = $2 AND enabled IS TRUE',
    [cropId, companyId]
  );

  if (!rows.length) {
    const err = new Error('Cultivo no disponible');
    err.status = 400;
    throw err;
  }
};

exports.list = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { campaignId, lotId, subLotId } = req.query;
    const params = [company_id];
    const where = ['ca.company_id = $1'];

    if (campaignId) {
      params.push(campaignId);
      where.push(`ca.campaign_id = $${params.length}`);
    }
    if (lotId) {
      params.push(lotId);
      where.push(`ca.lot_id = $${params.length}`);
    }
    if (subLotId) {
      params.push(subLotId);
      where.push(`ca.sub_lot_id = $${params.length}`);
    }

    const { rows } = await pool.query(
      `
      SELECT ${assignmentSelect}
      FROM crop_assignments ca
      JOIN campaigns c ON c.id = ca.campaign_id
      JOIN lots l ON l.id = ca.lot_id
      LEFT JOIN sub_lots sl ON sl.id = ca.sub_lot_id
      JOIN crops cr ON cr.id = ca.crop_id
      WHERE ${where.join(' AND ')}
      ORDER BY ca.start_date ASC, COALESCE(ca.end_date, 'infinity'::date) ASC, l.name ASC, sl.sort_order NULLS FIRST, sl.code NULLS FIRST;
      `,
      params
    );

    return res.json(rows);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { company_id } = req.user;
    const allowClosedHistorical = hasEffectivePermission(req.user, PERMISSIONS.PLANNING_EDIT);

    await client.query('BEGIN');
    const assignment = await resolveAssignmentTarget(client, req.body, company_id, {
      allowClosedHistorical,
    });
    await validateTemporalSurfaceConflict(client, assignment, company_id);

    const { rows } = await client.query(
      `
      INSERT INTO crop_assignments (
        company_id, campaign_id, lot_id, sub_lot_id, crop_id, start_date, end_date, area_ha
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
      `,
      [
        company_id,
        assignment.campaign_id,
        assignment.lot_id,
        assignment.sub_lot_id,
        assignment.crop_id,
        assignment.start_date,
        assignment.end_date,
        assignment.area_ha,
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Ya existe una asignación para esa superficie en la campaña.',
      });
    }
    next(err);
  } finally {
    client.release();
  }
};

exports.update = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    const allowClosedHistorical = hasEffectivePermission(req.user, PERMISSIONS.PLANNING_EDIT);

    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      `
      SELECT id, campaign_id, lot_id, sub_lot_id, crop_id, start_date, end_date, area_ha
      FROM crop_assignments
      WHERE id = $1
        AND company_id = $2
      LIMIT 1;
      `,
      [id, company_id]
    );

    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'NotFound', message: 'Asignación no encontrada' });
    }

    const current = currentRows[0];
    const requested = {
      campaign_id: req.body.campaign_id ?? current.campaign_id,
      lot_id: req.body.lot_id ?? current.lot_id,
      sub_lot_id: req.body.sub_lot_id !== undefined ? req.body.sub_lot_id : current.sub_lot_id,
      crop_id: req.body.crop_id ?? current.crop_id,
      start_date: req.body.start_date ?? toDateKey(current.start_date),
      end_date: req.body.end_date !== undefined ? req.body.end_date : toDateKey(current.end_date),
    };

    const changedSurface =
      requested.lot_id !== current.lot_id
      || (requested.sub_lot_id || null) !== (current.sub_lot_id || null);

    const nextAssignment = await resolveAssignmentTarget(client, requested, company_id, {
      allowClosedHistorical,
      allowHistoricalSubLot: !changedSurface,
    });
    await validateTemporalSurfaceConflict(client, nextAssignment, company_id, id);

    const sets = [];
    const params = [];
    const push = (value, column) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.campaign_id !== undefined) push(nextAssignment.campaign_id, 'campaign_id');
    if (req.body.lot_id !== undefined) push(nextAssignment.lot_id, 'lot_id');
    if (req.body.sub_lot_id !== undefined) push(nextAssignment.sub_lot_id, 'sub_lot_id');
    if (req.body.crop_id !== undefined) push(nextAssignment.crop_id, 'crop_id');
    if (req.body.start_date !== undefined) push(nextAssignment.start_date, 'start_date');
    if (req.body.end_date !== undefined) push(nextAssignment.end_date, 'end_date');
    if (changedSurface) push(nextAssignment.area_ha, 'area_ha');

    if (!sets.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'BadRequest', message: 'No hay cambios para guardar' });
    }

    params.push(id, company_id);
    const { rows } = await client.query(
      `
      UPDATE crop_assignments
      SET ${sets.join(', ')}
      WHERE id = $${params.length - 1}
        AND company_id = $${params.length}
      RETURNING *;
      `,
      params
    );

    await client.query('COMMIT');
    return res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};

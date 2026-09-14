const { pool } = require('../db/supabaseClient');
const requirePermission = require('../middleware/requirePermission');
const { PERMISSIONS } = require('../constants/permissions');
const { areaCents, areaValue, fail, dateKey, cycleBalance, validateManualClosure } = require('../services/harvestAreas');
const { lockAssignments, ledger, balances, allocate, recalculate, assertNoReopeningConflict } = require('../services/harvestCycles');

const { validateRegistration, validateEffectiveDate } = require('../services/harvestRegistration');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCrop(value) {
  return String(value || '').trim().toLowerCase();
}

function sameId(a, b) {
  return String(a || '') === String(b || '');
}

function optionalId(value) {
  return value || null;
}

function toDateKey(value) {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function legacyCampaignFromDates(startDate, endDate) {
  const startYear = toDateKey(startDate)?.slice(0, 4);
  const endYear = toDateKey(endDate)?.slice(0, 4);
  return validateLegacyCampaign(`${startYear}-${endYear || startYear}`);
}

function validateLegacyCampaign(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{4}$/.test(value)) {
    const err = new Error('La campaña legacy debe tener formato YYYY-YYYY.');
    err.status = 400;
    throw err;
  }
  return value;
}

function toNumber(value, label, { min = 0, inclusive = true } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (inclusive ? parsed < min : parsed <= min)) {
    const err = new Error(label);
    err.status = 400;
    throw err;
  }
  return parsed;
}

function assertDate(value) {
  if (!value || !DATE_RE.test(String(value))) {
    const err = new Error('La fecha de cosecha debe tener formato YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
}

const HARVEST_UNITS = {
  kg: { divisor: 1, label: 'kg', yieldLabel: 'kg/ha' },
  tn: { divisor: 1000, label: 'tn', yieldLabel: 'tn/ha' },
  qq: { divisor: 100, label: 'qq', yieldLabel: 'qq/ha' },
};

function getHarvestUnitConfig(req, res) {
  const unit = req.query.unit || 'kg';
  const config = HARVEST_UNITS[unit];

  if (!config) {
    res.status(400).json({
      error: 'InvalidHarvestUnit',
      message: 'Unidad invalida. Valores permitidos: kg, tn, qq',
      allowedUnits: Object.keys(HARVEST_UNITS),
    });
    return null;
  }

  return { unit, ...config };
}

const harvestSelect = `
  hr.id,
  hr.company_id,
  hr.lot_id,
  hr.sub_lot_id,
  l.name AS lot_name,
  sl.name AS sub_lot_name,
  hr.crop_id,
  c.name AS crop_name,
  hr.crop,
  hr.campaign_id,
  cp.name AS campaign_name,
  cp.start_date AS campaign_start_date,
  cp.end_date AS campaign_end_date,
  hr.campaign,
  hr.harvest_date,
  hr.production_kg,
  hr.harvested_area_ha,
  hr.yield_kg_ha,
  hr.notes,
  hr.created_by,
  hr.registered_retroactively, hr.retroactive_reason, hr.retroactive_notes, hr.registration_timezone,
  hr.enabled,
  hr.created_at,
  hr.updated_at,
  EXISTS (SELECT 1 FROM harvest_crop_assignments hca WHERE hca.harvest_id = hr.id) AS has_productive_cycle,
  EXISTS (
    SELECT 1
    FROM harvest_crop_assignments hca
    JOIN crop_assignments ca ON ca.id = hca.crop_assignment_id
    WHERE hca.harvest_id = hr.id AND ca.end_date = hr.harvest_date
      AND ca.harvest_closure_source IN ('automatic', 'legacy') AND hr.enabled
  ) AS closes_productive_cycle
`;

async function fetchHarvestById(client, id, companyId) {
  const { rows } = await client.query(
    `
    SELECT ${harvestSelect}
    FROM harvest_records hr
    JOIN lots l
      ON l.id = hr.lot_id
     AND l.company_id = hr.company_id
    LEFT JOIN sub_lots sl
      ON sl.id = hr.sub_lot_id
     AND sl.company_id = hr.company_id
    LEFT JOIN crops c
      ON c.id = hr.crop_id
     AND c.company_id = hr.company_id
    LEFT JOIN campaigns cp
      ON cp.id = hr.campaign_id
     AND cp.company_id = hr.company_id
    WHERE hr.id = $1
      AND hr.company_id = $2
    LIMIT 1
    `,
    [id, companyId]
  );

  return rows[0] || null;
}

async function resolveHarvestTarget(client, companyId, lotId, subLotId) {
  const { rows } = await client.query(
    `
    SELECT
      l.id AS lot_id,
      l.name AS lot_name,
      l.enabled AS lot_enabled,
      COALESCE(l.area_ha, NULLIF(l.area, 0)::numeric) AS lot_area_ha,
      ST_CollectionExtract(ST_MakeValid(l.geom), 3) AS lot_geom,
      sl.id AS sub_lot_id,
      sl.name AS sub_lot_name,
      sl.area_ha AS sub_lot_area_ha,
      ST_CollectionExtract(ST_MakeValid(sl.geom), 3) AS sub_lot_geom,
      ll.status AS layout_status,
      (
        SELECT COUNT(*)::int
        FROM lot_layouts active_ll
        JOIN sub_lots active_sl
          ON active_sl.layout_id = active_ll.id
         AND active_sl.company_id = active_ll.company_id
         AND COALESCE(active_sl.enabled, TRUE) IS TRUE
        WHERE active_ll.lot_id = l.id
          AND active_ll.company_id = l.company_id
          AND active_ll.status = 'active'
      ) AS active_sub_lots_count
    FROM lots l
    LEFT JOIN sub_lots sl
      ON sl.id = $3::uuid
     AND sl.lot_id = l.id
     AND sl.company_id = l.company_id
     AND COALESCE(sl.enabled, TRUE) IS TRUE
    LEFT JOIN lot_layouts ll
      ON ll.id = sl.layout_id
     AND ll.company_id = l.company_id
    WHERE l.id = $1
      AND l.company_id = $2
    LIMIT 1
    `,
    [lotId, companyId, optionalId(subLotId)]
  );

  const target = rows[0];
  if (!target) {
    const err = new Error('Lote no encontrado para esta empresa');
    err.status = 404;
    throw err;
  }
  if (!target.lot_enabled) {
    const err = new Error('No se puede registrar cosecha en un lote deshabilitado');
    err.status = 400;
    throw err;
  }
  if (subLotId && !target.sub_lot_id) {
    const err = new Error('Sublote no encontrado para esta empresa');
    err.status = 404;
    throw err;
  }
  if (subLotId && target.layout_status !== 'active') {
    const err = new Error('El sublote seleccionado ya no corresponde a la división vigente del lote.');
    err.status = 400;
    throw err;
  }

  const areaHa = subLotId ? Number(target.sub_lot_area_ha) : Number(target.lot_area_ha);
  if (Number.isNaN(areaHa) || areaHa <= 0) {
    const err = new Error('No se pudo determinar la superficie de cosecha.');
    err.status = 400;
    throw err;
  }

  return { ...target, selected_area_ha: areaHa };
}

async function resolveCrop(client, companyId, cropId) {
  const { rows } = await client.query(
    `
    SELECT id, name, enabled
    FROM crops
    WHERE id = $1
      AND company_id = $2
    LIMIT 1
    `,
    [cropId, companyId]
  );

  if (!rows.length || !rows[0].enabled) {
    const err = new Error('Cultivo no disponible');
    err.status = 400;
    throw err;
  }

  return rows[0];
}

async function loadCurrentAssignments(client, companyId, target, harvestDate, lock = true) {
  const selectedGeomSql = target.sub_lot_id ? 'target.sub_lot_geom' : 'target.lot_geom';

  const { rows } = await client.query(
    `
    WITH target AS (
      SELECT
        l.id AS lot_id,
        sl.id AS sub_lot_id,
        ST_CollectionExtract(ST_MakeValid(sl.geom), 3) AS sub_lot_geom,
        ST_CollectionExtract(ST_MakeValid(l.geom), 3) AS lot_geom
      FROM lots l
      LEFT JOIN sub_lots sl
        ON sl.id = $3::uuid
       AND sl.lot_id = l.id
       AND sl.company_id = l.company_id
      WHERE l.id = $2
        AND l.company_id = $1
    )
    SELECT
      ca.id,
      ca.campaign_id,
      ca.lot_id,
      ca.sub_lot_id,
      ca.crop_id,
      ca.start_date,
      ca.end_date,
      ca.area_ha,
      ca.harvest_closure_source,
      cr.name AS crop_name,
      cp.name AS campaign_name,
      cp.start_date AS campaign_start_date,
      cp.end_date AS campaign_end_date,
      cp.status AS campaign_status,
      ST_Area(
        ST_CollectionExtract(
          ST_Intersection(
            ${selectedGeomSql},
            ST_CollectionExtract(ST_MakeValid(COALESCE(sl.geom, l.geom)), 3)
          ),
          3
        )::geography
      ) AS intersection_m2,
      ST_Area(
        ST_CollectionExtract(
          ST_Difference(
            ST_CollectionExtract(ST_MakeValid(COALESCE(sl.geom, l.geom)), 3),
            ${selectedGeomSql}
          ),
          3
        )::geography
      ) AS assignment_outside_selected_m2
    FROM target
    JOIN crop_assignments ca
      ON ca.lot_id = target.lot_id
     AND ca.company_id = $1
     AND ca.start_date <= $4::date
     AND (ca.end_date IS NULL OR ca.end_date >= $4::date)
    JOIN crops cr
      ON cr.id = ca.crop_id
     AND cr.company_id = $1
    JOIN campaigns cp
      ON cp.id = ca.campaign_id
     AND cp.company_id = $1
    JOIN lots l
      ON l.id = ca.lot_id
     AND l.company_id = $1
    LEFT JOIN sub_lots sl
      ON sl.id = ca.sub_lot_id
     AND sl.company_id = $1
    WHERE ST_Area(
      ST_CollectionExtract(
        ST_Intersection(
          ${selectedGeomSql},
          ST_CollectionExtract(ST_MakeValid(COALESCE(sl.geom, l.geom)), 3)
        ),
        3
      )::geography
    ) > 1
    ORDER BY ca.id
    ${lock ? 'FOR UPDATE OF ca' : ''}
    `,
    [companyId, target.lot_id, optionalId(target.sub_lot_id), harvestDate]
  );

  return rows;
}

async function assertFutureCropStart(client, companyId, target, cropId, harvestDate) {
  const selectedGeomSql = target.sub_lot_id ? 'target.sub_lot_geom' : 'target.lot_geom';

  const { rows } = await client.query(
    `
    WITH target AS (
      SELECT
        l.id AS lot_id,
        sl.id AS sub_lot_id,
        ST_CollectionExtract(ST_MakeValid(sl.geom), 3) AS sub_lot_geom,
        ST_CollectionExtract(ST_MakeValid(l.geom), 3) AS lot_geom
      FROM lots l
      LEFT JOIN sub_lots sl
        ON sl.id = $3::uuid
       AND sl.lot_id = l.id
       AND sl.company_id = l.company_id
      WHERE l.id = $2
        AND l.company_id = $1
    )
    SELECT ca.id
    FROM target
    JOIN crop_assignments ca
      ON ca.lot_id = target.lot_id
     AND ca.company_id = $1
     AND ca.crop_id = $4
     AND ca.start_date > $5::date
    JOIN lots l
      ON l.id = ca.lot_id
     AND l.company_id = $1
    LEFT JOIN sub_lots sl
      ON sl.id = ca.sub_lot_id
     AND sl.company_id = $1
    WHERE ST_Area(
      ST_CollectionExtract(
        ST_Intersection(
          ${selectedGeomSql},
          ST_CollectionExtract(ST_MakeValid(COALESCE(sl.geom, l.geom)), 3)
        ),
        3
      )::geography
    ) > 1
    LIMIT 1
    `,
    [companyId, target.lot_id, optionalId(target.sub_lot_id), cropId, harvestDate]
  );

  if (rows.length) {
    const err = new Error('La fecha de cosecha es anterior al inicio del cultivo registrado.');
    err.status = 400;
    throw err;
  }
}

async function resolveAssignmentsToClose(client, companyId, target, crop, harvestDate, lock = true) {
  const currentAssignments = await loadCurrentAssignments(client, companyId, target, harvestDate, lock);

  if (!currentAssignments.length) {
    await assertFutureCropStart(client, companyId, target, crop.id, harvestDate);
    const err = new Error('No hay un cultivo vigente compatible para esta superficie. Revisá el estado productivo antes de registrar la cosecha.');
    err.status = 409;
    throw err;
  }

  const matchingCrop = currentAssignments.filter((assignment) => sameId(assignment.crop_id, crop.id));
  const differentCrop = currentAssignments.filter((assignment) => !sameId(assignment.crop_id, crop.id));

  if (!target.sub_lot_id && differentCrop.length) {
    const distinctCurrentCrops = new Set(currentAssignments.map((assignment) => String(assignment.crop_id)));
    if (Number(target.active_sub_lots_count || 0) > 0 || distinctCurrentCrops.size > 1) {
      const err = new Error('El lote tiene distintos cultivos por sublote. Seleccioná la superficie que corresponde a esta cosecha.');
      err.status = 409;
      throw err;
    }
  }

  if (!matchingCrop.length && differentCrop.length) {
    const err = new Error('El cultivo seleccionado no coincide con el cultivo registrado actualmente.');
    err.status = 409;
    throw err;
  }

  if (target.sub_lot_id) {
    const exactSubLot = matchingCrop.filter((assignment) => (
      sameId(assignment.sub_lot_id, target.sub_lot_id)
      && Number(assignment.assignment_outside_selected_m2 || 0) <= 1
    ));

    if (exactSubLot.length === 1) return exactSubLot;

    if (matchingCrop.some((assignment) => !assignment.sub_lot_id)) {
      const err = new Error('El cultivo está registrado sobre toda la superficie del lote. Actualizá el estado productivo antes de registrar esta cosecha.');
      err.status = 409;
      throw err;
    }

    const err = new Error('No hay un cultivo vigente compatible para esta superficie. Revisá el estado productivo antes de registrar la cosecha.');
    err.status = 409;
    throw err;
  }

  const closable = matchingCrop.filter((assignment) => (
    Number(assignment.assignment_outside_selected_m2 || 0) <= 1
  ));

  if (!closable.length) {
    const err = new Error('No hay un cultivo vigente compatible para esta superficie. Revisá el estado productivo antes de registrar la cosecha.');
    err.status = 409;
    throw err;
  }

  return closable;
}

function assertSingleCampaign(assignments) {
  const campaignIds = new Set(assignments.map((item) => String(item.campaign_id)));
  if (campaignIds.size > 1) {
    const err = new Error('La cosecha coincide con más de una campaña. Revisá el estado productivo antes de registrar la cosecha.');
    err.status = 409;
    throw err;
  }
}

exports.createHarvestRecord = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { company_id, id: authUserId } = req.user;
    const { lot_id, sub_lot_id, crop_id, harvest_date, production_kg, harvested_area_ha, notes } = req.body;

    if (!company_id) {
      const err = new Error('No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.');
      err.status = 400;
      throw err;
    }
    if (!lot_id || !crop_id) {
      const err = new Error('Seleccioná lote y cultivo.');
      err.status = 400;
      throw err;
    }

    assertDate(harvest_date);
    if (!authUserId) throw fail('No pudimos identificar al usuario.');
    const trace = validateRegistration(req.body);
    const productionKg = toNumber(production_kg, 'production_kg debe ser un número mayor o igual a 0', { min: 0 });
    const harvestedAreaHa = areaValue(areaCents(harvested_area_ha));

    await client.query('BEGIN');

    const target = await resolveHarvestTarget(client, company_id, lot_id, sub_lot_id);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`${company_id}:${target.lot_id}`]);
    const crop = await resolveCrop(client, company_id, crop_id);
    const assignments = await resolveAssignmentsToClose(client, company_id, target, crop, harvest_date);
    assertSingleCampaign(assignments);
    if (areaCents(harvestedAreaHa) > areaCents(target.selected_area_ha)) throw fail('La superficie supera el lote o sublote seleccionado.');
    const allocations = allocate(await balances(client, company_id, assignments), harvestedAreaHa, req.body.allocations);

    const { rows } = await client.query(
      `
      INSERT INTO harvest_records (
        company_id, lot_id, sub_lot_id, crop_id, crop, campaign_id, campaign,
        harvest_date, production_kg, harvested_area_ha, notes, created_by, registered_retroactively, retroactive_reason, retroactive_notes, registration_timezone
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id
      `,
      [
        company_id,
        target.lot_id,
        optionalId(target.sub_lot_id),
        crop.id,
        normalizeCrop(crop.name),
        assignments[0].campaign_id,
        legacyCampaignFromDates(assignments[0].campaign_start_date, assignments[0].campaign_end_date),
        harvest_date,
        productionKg,
        harvestedAreaHa,
        notes || null,
        authUserId, trace.historical, trace.reason, trace.notes, trace.timezone,
      ]
    );

    const harvestId = rows[0].id;
    for (const item of allocations) {
      await client.query(`INSERT INTO harvest_crop_assignments (harvest_id, crop_assignment_id, harvested_area_ha)
        VALUES ($1, $2, $3)`, [harvestId, item.crop_assignment_id, item.harvested_area_ha]);
    }
    await recalculate(client, company_id, assignments.filter((a) => allocations.some((item) => item.crop_assignment_id === a.id)));

    await client.query('COMMIT');

    return res.status(201).json(await fetchHarvestById(pool, harvestId, company_id));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      error.status = 409;
      error.message = 'Este ciclo productivo ya fue cerrado por una cosecha.';
    }
    next(error);
  } finally {
    client.release();
  }
};

exports.listHarvestRecords = async (req, res, next) => {
  try {
    const { company_id } = req.user;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.'
      });
    }

    const {
      campaign,
      crop,
      lot_id,
      from,
      to,
      onlyDisabled = 'false',
      includeDisabled = 'false',
      page = 1,
      pageSize = 10
    } = req.query;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100);
    const offset = (pageNumber - 1) * limit;

    const params = [company_id];
    const where = ['hr.company_id = $1'];

    if (onlyDisabled === 'true') {
      where.push('hr.enabled = FALSE');
    } else if (includeDisabled !== 'true') {
      where.push('hr.enabled = TRUE');
    }

    if (campaign) {
      params.push(campaign);
      where.push(`(hr.campaign = $${params.length} OR cp.name = $${params.length} OR cp.id::text = $${params.length})`);
    }

    if (crop) {
      params.push(normalizeCrop(crop));
      where.push(`(hr.crop = $${params.length} OR lower(c.name) = $${params.length})`);
    }

    if (lot_id) {
      params.push(lot_id);
      where.push(`hr.lot_id = $${params.length}`);
    }

    if (from) {
      params.push(from);
      where.push(`hr.harvest_date >= $${params.length}`);
    }

    if (to) {
      params.push(to);
      where.push(`hr.harvest_date <= $${params.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;

    const countResult = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM harvest_records hr
      LEFT JOIN crops c ON c.id = hr.crop_id AND c.company_id = hr.company_id
      LEFT JOIN campaigns cp ON cp.id = hr.campaign_id AND cp.company_id = hr.company_id
      ${whereClause}
      `,
      params
    );
    const total = Number(countResult.rows[0]?.total || 0);

    params.push(limit, offset);

    const dataResult = await pool.query(
      `
      SELECT ${harvestSelect}
      FROM harvest_records hr
      JOIN lots l ON l.id = hr.lot_id AND l.company_id = hr.company_id
      LEFT JOIN sub_lots sl ON sl.id = hr.sub_lot_id AND sl.company_id = hr.company_id
      LEFT JOIN crops c ON c.id = hr.crop_id AND c.company_id = hr.company_id
      LEFT JOIN campaigns cp ON cp.id = hr.campaign_id AND cp.company_id = hr.company_id
      ${whereClause}
      ORDER BY hr.harvest_date DESC, hr.created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params
    );

    return res.json({
      data: dataResult.rows,
      pagination: {
        total,
        page: pageNumber,
        pageSize: limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getHarvestRecordById = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { id } = req.params;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.'
      });
    }

    const row = await fetchHarvestById(pool, id, company_id);
    if (!row) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Registro de cosecha no encontrado'
      });
    }

    if (row.enabled === false) {
      return requirePermission(PERMISSIONS.HARVEST_VIEW_DISABLED)(req, res, () => res.json(row));
    }
    return res.json(row);
  } catch (error) {
    next(error);
  }
};

// Linked harvest identity is immutable; only quantities and notes are corrected.
async function mutateHarvest(req, res, next, enabled) {
  const client = await pool.connect();
  try {
    const { company_id } = req.user;
    if (!company_id) throw fail('No pudimos identificar tu empresa.');
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM harvest_records WHERE id = $1 AND company_id = $2 FOR UPDATE', [req.params.id, company_id]);
    const current = rows[0];
    if (!current) throw fail('Registro de cosecha no encontrado', 404);
    const { rows: links } = await client.query('SELECT * FROM harvest_crop_assignments WHERE harvest_id = $1 ORDER BY crop_assignment_id', [current.id]);
    const assignments = links.length ? await lockAssignments(client, company_id, links.map((l) => l.crop_assignment_id)) : [];
    const body = req.body || {};
    for (const key of ['registered_retroactively','retroactive_reason','retroactive_notes','registration_timezone','created_by','created_at']) {
      if (Object.hasOwn(body,key)) throw fail('La procedencia y autoría del registro original se conservan.');
    }
    if (body.harvest_date && dateKey(body.harvest_date) !== dateKey(current.harvest_date)) {
      if (current.registered_retroactively != null) throw fail('La fecha efectiva de un registro con procedencia documentada se conserva.');
      validateEffectiveDate(body.harvest_date, body.client_timezone);
    }
    const isStatusChange = enabled !== undefined;
    const nextEnabled = isStatusChange ? enabled : current.enabled;
    if (isStatusChange && nextEnabled === current.enabled) throw fail('El registro ya tiene ese estado.');
    const area = isStatusChange ? String(current.harvested_area_ha) : areaValue(areaCents(body.harvested_area_ha));
    if (areaCents(area) <= 0) throw fail('La superficie debe ser mayor a cero.');
    const changedArea = areaCents(area) !== areaCents(current.harvested_area_ha);
    if (assignments.length && !isStatusChange) {
      if ((body.lot_id !== undefined && !sameId(body.lot_id, current.lot_id))
        || (body.sub_lot_id !== undefined && !sameId(body.sub_lot_id, current.sub_lot_id))
        || (body.crop_id !== undefined && !sameId(body.crop_id, current.crop_id))
        || (body.harvest_date !== undefined && dateKey(body.harvest_date) !== dateKey(current.harvest_date))) {
        throw fail('Esta cosecha está vinculada a un ciclo. No se puede cambiar lote, cultivo o fecha.', 409);
      }
    }
    if ((changedArea || isStatusChange || body.allocations !== undefined)
      && assignments.some((a) => a.harvest_closure_source === 'legacy')) {
      throw fail('Este ciclo tiene un cierre legacy. Requiere conciliación antes de cambiar hectáreas o habilitación.', 409);
    }
    if (assignments.length && (changedArea || body.allocations !== undefined || (isStatusChange && enabled))) {
      const available = await balances(client, company_id, assignments, current.id);
      // Corrections preserve an explicit closure and its original audit snapshot.
      const correctionTargets = available.map((a) => ({ ...a, harvest_closure_source: a.harvest_closure_source === 'manual' ? null : a.harvest_closure_source }));
      const requested = body.allocations || (!changedArea ? links : undefined);
      const allocations = allocate(correctionTargets, area, requested);
      if (allocations.length !== links.length || links.some((l) => !allocations.some((a) => a.crop_assignment_id === l.crop_assignment_id))) {
        throw fail('Una corrección no puede cambiar los ciclos vinculados.');
      }
      for (const item of allocations) {
        await client.query('UPDATE harvest_crop_assignments SET harvested_area_ha = $1 WHERE harvest_id = $2 AND crop_assignment_id = $3', [item.harvested_area_ha, current.id, item.crop_assignment_id]);
      }
    }
    if (isStatusChange) {
      await client.query('UPDATE harvest_records SET enabled = $1 WHERE id = $2 AND company_id = $3', [enabled, current.id, company_id]);
    } else {
      const production = toNumber(body.production_kg, 'La producción debe ser un número mayor o igual a cero.');
      if (!links.length) {
        // Legacy unlinked records stay unlinked: no inferred cycle or closure.
        const lotId = body.lot_id || current.lot_id;
        const subLotId = body.sub_lot_id !== undefined ? optionalId(body.sub_lot_id) : current.sub_lot_id;
        const cropId = body.crop_id || current.crop_id;
        assertDate(body.harvest_date);
        const target = await resolveHarvestTarget(client, company_id, lotId, subLotId);
        if (areaCents(area) > areaCents(target.selected_area_ha)) throw fail('La superficie supera el lote o sublote seleccionado.');
        const crop = cropId ? await resolveCrop(client, company_id, cropId) : null;
        await client.query('UPDATE harvest_records SET lot_id=$1, sub_lot_id=$2, crop_id=$3, crop=$4, harvest_date=$5 WHERE id=$6 AND company_id=$7',
          [lotId, subLotId, cropId, crop ? normalizeCrop(crop.name) : normalizeCrop(body.crop || current.crop), body.harvest_date, current.id, company_id]);
        const { rows: campaignRows } = current.campaign_id
          ? await client.query('SELECT start_date, end_date FROM campaigns WHERE id=$1 AND company_id=$2', [current.campaign_id, company_id])
          : { rows: [] };
        const campaignDates = campaignRows[0];
        const campaignText = campaignDates?.start_date
          ? legacyCampaignFromDates(campaignDates.start_date, campaignDates.end_date)
          : validateLegacyCampaign(body.campaign ?? current.campaign);
        await client.query('UPDATE harvest_records SET campaign=$1 WHERE id=$2 AND company_id=$3', [campaignText, current.id, company_id]);
      }
      await client.query('UPDATE harvest_records SET harvested_area_ha=$1, production_kg=$2, notes=$3 WHERE id=$4 AND company_id=$5',
        [area, production, body.notes || null, current.id, company_id]);
    }
    if (changedArea || isStatusChange || body.allocations !== undefined) await recalculate(client, company_id, assignments);
    await client.query('COMMIT');
    return res.json(await fetchHarvestById(pool, current.id, company_id));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
}

exports.updateHarvestRecord = (req, res, next) => mutateHarvest(req, res, next);
exports.disableHarvestRecord = (req, res, next) => mutateHarvest(req, res, next, false);
exports.enableHarvestRecord = (req, res, next) => mutateHarvest(req, res, next, true);

exports.getHarvestContext = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) throw fail('No pudimos identificar tu empresa.');
    const { lot_id, sub_lot_id, crop_id, harvest_date, harvest_id } = req.query;
    if (harvest_id) {
      const record = await fetchHarvestById(pool, harvest_id, company_id);
      if (!record) throw fail('Cosecha no encontrada.', 404);
      const { rows } = await pool.query('SELECT ca.*, cr.name AS crop_name, cp.name AS campaign_name, hca.harvested_area_ha AS this_harvest_area_ha FROM crop_assignments ca JOIN crops cr ON cr.id=ca.crop_id AND cr.company_id=ca.company_id JOIN campaigns cp ON cp.id=ca.campaign_id AND cp.company_id=ca.company_id JOIN harvest_crop_assignments hca ON hca.crop_assignment_id=ca.id WHERE hca.harvest_id=$1 AND ca.company_id=$2 ORDER BY ca.id', [harvest_id, company_id]);
      return res.json({ assignments: await balances(pool, company_id, rows), editable_assignments: await balances(pool, company_id, rows, harvest_id) });
    }
    assertDate(harvest_date);
    const target = await resolveHarvestTarget(pool, company_id, lot_id, sub_lot_id);
    const crop = await resolveCrop(pool, company_id, crop_id);
    const assignments = await resolveAssignmentsToClose(pool, company_id, target, crop, harvest_date, false);
    assertSingleCampaign(assignments);
    return res.json({ assignments: await balances(pool, company_id, assignments) });
  } catch (error) { next(error); }
};

exports.finalizeHarvestCycle = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { company_id, id: userId } = req.user;
    if (!company_id || !userId) throw fail('No pudimos identificar tu empresa o usuario.');
    const { finalized_date, reason, notes } = req.body;
    assertDate(finalized_date);
    validateEffectiveDate(finalized_date, req.body.client_timezone);
    validateManualClosure(reason, notes);
    await client.query('BEGIN');
    const [assignment] = await lockAssignments(client, company_id, [req.params.assignmentId]);
    if (assignment.end_date || assignment.harvest_closure_source) throw fail('El ciclo ya está cerrado. No se modifica su cierre existente.', 409);
    const entries = await ledger(client, company_id, assignment.id);
    const balance = cycleBalance(assignment.area_ha, entries);
    if (balance.remaining <= 0) throw fail('No hay superficie pendiente para finalizar explícitamente.', 409);
    if (finalized_date < dateKey(assignment.start_date) || entries.some((entry) => entry.enabled && dateKey(entry.harvest_date) > finalized_date)) {
      throw fail('La finalización no puede ser anterior al inicio del ciclo ni a sus jornadas de cosecha.');
    }
    await assertNoReopeningConflict(client, company_id, assignment, finalized_date);
    const { rows } = await client.query('INSERT INTO harvest_cycle_closures (company_id,crop_assignment_id,finalized_date,reason,notes,created_by,total_area_ha,harvested_area_ha,remaining_area_ha) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [company_id, assignment.id, finalized_date, reason, notes?.trim() || null, userId, areaValue(balance.total), areaValue(balance.harvested), areaValue(balance.remaining)]);
    await client.query("SELECT set_config('growsync.harvest_cycle_write', 'on', true)");
    await client.query("UPDATE crop_assignments SET end_date=$1, harvest_closure_source='manual' WHERE id=$2 AND company_id=$3", [finalized_date, assignment.id, company_id]);
    await client.query('COMMIT');
    return res.status(201).json(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
};

exports.getHarvestSummary = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { campaign, crop } = req.query;
    const unitConfig = getHarvestUnitConfig(req, res);

    if (!unitConfig) return;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.'
      });
    }

    const normalizedCrop = crop ? normalizeCrop(crop) : null;

    const result = await pool.query(
      `
      SELECT
        COUNT(*) AS total_records,
        ROUND(COALESCE(SUM(hr.production_kg), 0) / $4::numeric, 2) AS total_production_kg,
        COALESCE(SUM(hr.harvested_area_ha), 0) AS total_area_ha,
        CASE
          WHEN COALESCE(SUM(hr.harvested_area_ha), 0) = 0 THEN 0
          ELSE ROUND((SUM(hr.production_kg) / $4::numeric) / SUM(hr.harvested_area_ha), 2)
        END AS avg_yield_kg_ha
      FROM harvest_records hr
      LEFT JOIN crops c ON c.id = hr.crop_id AND c.company_id = hr.company_id
      LEFT JOIN campaigns cp ON cp.id = hr.campaign_id AND cp.company_id = hr.company_id
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND ($2::text IS NULL OR hr.campaign = $2 OR cp.name = $2 OR cp.id::text = $2)
        AND ($3::text IS NULL OR hr.crop = $3 OR lower(c.name) = $3)
      `,
      [company_id, campaign || null, normalizedCrop, unitConfig.divisor]
    );

    return res.json({
      ...result.rows[0],
      unit: unitConfig.unit,
      unit_label: unitConfig.label,
      yield_unit_label: unitConfig.yieldLabel,
    });
  } catch (error) {
    next(error);
  }
};

exports.getHarvestStatsByCrop = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { campaign } = req.query;
    const unitConfig = getHarvestUnitConfig(req, res);

    if (!unitConfig) return;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.'
      });
    }

    const result = await pool.query(
      `
      SELECT
        COALESCE(c.name, hr.crop) AS crop,
        ROUND(SUM(hr.production_kg) / $2::numeric, 2) AS production_kg,
        ROUND(SUM(hr.harvested_area_ha), 2) AS area_ha,
        CASE
          WHEN SUM(hr.harvested_area_ha) = 0 THEN 0
          ELSE ROUND((SUM(hr.production_kg) / $2::numeric) / SUM(hr.harvested_area_ha), 2)
        END AS yield_kg_ha
      FROM harvest_records hr
      LEFT JOIN crops c ON c.id = hr.crop_id AND c.company_id = hr.company_id
      LEFT JOIN campaigns cp ON cp.id = hr.campaign_id AND cp.company_id = hr.company_id
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND ($3::text IS NULL OR hr.campaign = $3 OR cp.name = $3 OR cp.id::text = $3)
      GROUP BY COALESCE(c.name, hr.crop)
      ORDER BY COALESCE(c.name, hr.crop) ASC
      `,
      [company_id, unitConfig.divisor, campaign || null]
    );

    return res.json(result.rows.map((row) => ({
      ...row,
      unit: unitConfig.unit,
      unit_label: unitConfig.label,
      yield_unit_label: unitConfig.yieldLabel,
    })));
  } catch (error) {
    next(error);
  }
};

exports.getHarvestStatsByCampaign = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { crop } = req.query;
    const unitConfig = getHarvestUnitConfig(req, res);

    if (!unitConfig) return;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.'
      });
    }

    const normalizedCrop = crop ? normalizeCrop(crop) : null;

    const result = await pool.query(
      `
      SELECT
        COALESCE(CASE WHEN NULLIF(btrim(cp.name), '') IS NOT NULL THEN cp.name END, CASE WHEN cp.start_date IS NOT NULL THEN to_char(cp.start_date, 'YYYY') || CASE WHEN cp.end_date IS NOT NULL AND extract(year FROM cp.end_date) <> extract(year FROM cp.start_date) THEN '/' || to_char(cp.end_date, 'YY') ELSE '' END END, CASE WHEN cp.id IS NULL THEN hr.campaign END) AS campaign,
        cp.id AS campaign_id, cp.name AS campaign_name, cp.start_date AS campaign_start_date, cp.end_date AS campaign_end_date,
        ROUND(SUM(hr.production_kg) / $3::numeric, 2) AS production_kg,
        ROUND(SUM(hr.harvested_area_ha), 2) AS area_ha,
        CASE
          WHEN SUM(hr.harvested_area_ha) = 0 THEN 0
          ELSE ROUND((SUM(hr.production_kg) / $3::numeric) / SUM(hr.harvested_area_ha), 2)
        END AS yield_kg_ha
      FROM harvest_records hr
      LEFT JOIN crops c ON c.id = hr.crop_id AND c.company_id = hr.company_id
      LEFT JOIN campaigns cp ON cp.id = hr.campaign_id AND cp.company_id = hr.company_id
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND ($2::text IS NULL OR hr.crop = $2 OR lower(c.name) = $2)
      GROUP BY cp.id, cp.name, cp.start_date, cp.end_date, CASE WHEN cp.id IS NULL THEN hr.campaign END
      ORDER BY cp.start_date ASC NULLS LAST, cp.id ASC
      `,
      [company_id, normalizedCrop, unitConfig.divisor]
    );

    return res.json(result.rows.map((row) => ({
      ...row,
      unit: unitConfig.unit,
      unit_label: unitConfig.label,
      yield_unit_label: unitConfig.yieldLabel,
    })));
  } catch (error) {
    next(error);
  }
};

exports.getHarvestStatsFilters = async (req, res, next) => {
  try {
    const { company_id } = req.user;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.'
      });
    }

    const campaignsResult = await pool.query(
      `
      SELECT DISTINCT COALESCE(CASE WHEN NULLIF(btrim(cp.name), '') IS NOT NULL THEN cp.name END, CASE WHEN cp.start_date IS NOT NULL THEN to_char(cp.start_date, 'YYYY') || CASE WHEN cp.end_date IS NOT NULL AND extract(year FROM cp.end_date) <> extract(year FROM cp.start_date) THEN '/' || to_char(cp.end_date, 'YY') ELSE '' END END, hr.campaign) AS campaign, cp.id AS campaign_id, cp.name AS campaign_name, cp.start_date AS campaign_start_date, cp.end_date AS campaign_end_date
      FROM harvest_records hr
      LEFT JOIN campaigns cp ON cp.id = hr.campaign_id AND cp.company_id = hr.company_id
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND COALESCE(cp.name, hr.campaign) IS NOT NULL
      ORDER BY campaign_start_date DESC NULLS LAST, campaign_id ASC
      `,
      [company_id]
    );

    const cropsResult = await pool.query(
      `
      SELECT DISTINCT COALESCE(c.name, hr.crop) AS crop
      FROM harvest_records hr
      LEFT JOIN crops c ON c.id = hr.crop_id AND c.company_id = hr.company_id
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND COALESCE(c.name, hr.crop) IS NOT NULL
      ORDER BY COALESCE(c.name, hr.crop) ASC
      `,
      [company_id]
    );

    return res.json({
      campaigns: campaignsResult.rows.map((row) => row.campaign),
      campaign_details: campaignsResult.rows,
      crops: cropsResult.rows.map((row) => row.crop)
    });
  } catch (error) {
    next(error);
  }
};

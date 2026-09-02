const { pool } = require('../db/supabaseClient');

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
  if (!startYear) return null;
  return endYear ? `${startYear}-${endYear}` : `${startYear}-en curso`;
}

function toNumber(value, label, { min = 0, inclusive = true } = {}) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || (inclusive ? parsed < min : parsed <= min)) {
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
  hr.campaign,
  hr.harvest_date,
  hr.production_kg,
  hr.harvested_area_ha,
  hr.yield_kg_ha,
  hr.notes,
  hr.created_by,
  hr.enabled,
  hr.created_at,
  hr.updated_at,
  EXISTS (
    SELECT 1
    FROM harvest_crop_assignments hca
    WHERE hca.harvest_id = hr.id
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

async function loadCurrentAssignments(client, companyId, target, harvestDate) {
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
    ORDER BY ca.sub_lot_id NULLS FIRST, ca.start_date DESC
    FOR UPDATE OF ca
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

async function resolveAssignmentsToClose(client, companyId, target, crop, harvestDate) {
  const currentAssignments = await loadCurrentAssignments(client, companyId, target, harvestDate);

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

  if (Number(target.active_sub_lots_count || 0) > 0 && !closable.some((assignment) => !assignment.sub_lot_id)) {
    const coveredSubLots = new Set(closable.map((assignment) => String(assignment.sub_lot_id)).filter(Boolean));
    if (coveredSubLots.size < Number(target.active_sub_lots_count || 0)) {
      const err = new Error('No hay un cultivo vigente compatible para esta superficie. Revisá el estado productivo antes de registrar la cosecha.');
      err.status = 409;
      throw err;
    }
  }

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
    const productionKg = toNumber(production_kg, 'production_kg debe ser un número mayor o igual a 0', { min: 0 });
    const harvestedAreaHa = toNumber(harvested_area_ha, 'harvested_area_ha debe ser un número mayor a 0', { min: 0, inclusive: false });

    await client.query('BEGIN');

    const target = await resolveHarvestTarget(client, company_id, lot_id, sub_lot_id);
    const crop = await resolveCrop(client, company_id, crop_id);
    const assignments = await resolveAssignmentsToClose(client, company_id, target, crop, harvest_date);
    assertSingleCampaign(assignments);

    const { rows } = await client.query(
      `
      INSERT INTO harvest_records (
        company_id, lot_id, sub_lot_id, crop_id, crop, campaign_id, campaign,
        harvest_date, production_kg, harvested_area_ha, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        authUserId || null,
      ]
    );

    const harvestId = rows[0].id;
    const assignmentIds = assignments.map((assignment) => assignment.id);

    await client.query(
      `
      UPDATE crop_assignments
      SET end_date = $1
      WHERE id = ANY($2::uuid[])
        AND company_id = $3
      `,
      [harvest_date, assignmentIds, company_id]
    );

    await client.query(
      `
      INSERT INTO harvest_crop_assignments (harvest_id, crop_assignment_id)
      SELECT $1, unnest($2::uuid[])
      `,
      [harvestId, assignmentIds]
    );

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
      where.push(`(hr.campaign = $${params.length} OR cp.name = $${params.length})`);
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

    return res.json(row);
  } catch (error) {
    next(error);
  }
};

exports.updateHarvestRecord = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { company_id } = req.user;
    const { id } = req.params;
    const { lot_id, sub_lot_id, crop_id, crop, campaign, harvest_date, production_kg, harvested_area_ha, notes } = req.body;

    if (!company_id) {
      const err = new Error('No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.');
      err.status = 400;
      throw err;
    }

    assertDate(harvest_date);
    const productionKg = toNumber(production_kg, 'production_kg debe ser un número mayor o igual a 0', { min: 0 });
    const harvestedAreaHa = toNumber(harvested_area_ha, 'harvested_area_ha debe ser un número mayor a 0', { min: 0, inclusive: false });

    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT
        hr.*,
        cp.start_date AS campaign_start_date,
        cp.end_date AS campaign_end_date,
        EXISTS (
        SELECT 1
        FROM harvest_crop_assignments hca
        WHERE hca.harvest_id = hr.id
      ) AS closes_productive_cycle
      FROM harvest_records hr
      LEFT JOIN campaigns cp
        ON cp.id = hr.campaign_id
       AND cp.company_id = hr.company_id
      WHERE hr.id = $1
        AND hr.company_id = $2
      FOR UPDATE
      `,
      [id, company_id]
    );

    if (!rows.length) {
      const err = new Error('Registro de cosecha no encontrado');
      err.status = 404;
      throw err;
    }

    const current = rows[0];
    const requestedLotId = lot_id || current.lot_id;
    const requestedSubLotId = sub_lot_id !== undefined ? optionalId(sub_lot_id) : optionalId(current.sub_lot_id);
    const requestedCropId = crop_id || current.crop_id;

    if (current.closes_productive_cycle) {
      const structuralChanged = (
        !sameId(requestedLotId, current.lot_id)
        || !sameId(requestedSubLotId, current.sub_lot_id)
        || !sameId(requestedCropId, current.crop_id)
        || toDateKey(harvest_date) !== toDateKey(current.harvest_date)
      );

      if (structuralChanged) {
        const err = new Error('Esta cosecha ya cerró un ciclo productivo. Corregí el estado productivo antes de cambiar lote, cultivo o fecha.');
        err.status = 409;
        throw err;
      }

      const updated = await client.query(
        `
        UPDATE harvest_records
        SET production_kg = $1,
            harvested_area_ha = $2,
            notes = $3
        WHERE id = $4
          AND company_id = $5
        RETURNING id
        `,
        [productionKg, harvestedAreaHa, notes || null, id, company_id]
      );

      await client.query('COMMIT');
      return res.json(await fetchHarvestById(pool, updated.rows[0].id, company_id));
    }

    if (!requestedLotId || (!requestedCropId && !crop)) {
      const err = new Error('Seleccioná lote y cultivo.');
      err.status = 400;
      throw err;
    }

    await resolveHarvestTarget(client, company_id, requestedLotId, requestedSubLotId);
    let cropText = normalizeCrop(crop || current.crop);
    if (requestedCropId) {
      const resolvedCrop = await resolveCrop(client, company_id, requestedCropId);
      cropText = normalizeCrop(resolvedCrop.name);
    }
    const campaignText = current.campaign_id && current.campaign_start_date
      ? legacyCampaignFromDates(current.campaign_start_date, current.campaign_end_date)
      : campaign || current.campaign || null;

    const updated = await client.query(
      `
      UPDATE harvest_records
      SET lot_id = $1,
          sub_lot_id = $2,
          crop_id = $3,
          crop = $4,
          campaign = $5,
          harvest_date = $6,
          production_kg = $7,
          harvested_area_ha = $8,
          notes = $9
      WHERE id = $10
        AND company_id = $11
      RETURNING id
      `,
      [
        requestedLotId,
        requestedSubLotId,
        requestedCropId || null,
        cropText,
        campaignText,
        harvest_date,
        productionKg,
        harvestedAreaHa,
        notes || null,
        id,
        company_id,
      ]
    );

    await client.query('COMMIT');
    return res.json(await fetchHarvestById(pool, updated.rows[0].id, company_id));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

exports.disableHarvestRecord = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { id } = req.params;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.'
      });
    }

    const existingResult = await pool.query(
      `
      SELECT hr.id, hr.enabled, EXISTS (
        SELECT 1
        FROM harvest_crop_assignments hca
        WHERE hca.harvest_id = hr.id
      ) AS closes_productive_cycle
      FROM harvest_records hr
      WHERE hr.id = $1
        AND hr.company_id = $2
      LIMIT 1
      `,
      [id, company_id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Registro de cosecha no encontrado'
      });
    }

    const existing = existingResult.rows[0];
    if (existing.enabled === false) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'El registro de cosecha ya está deshabilitado'
      });
    }
    if (existing.closes_productive_cycle) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Esta cosecha ya cerró un ciclo productivo. Corregí el estado productivo antes de deshabilitarla.'
      });
    }

    const result = await pool.query(
      `
      UPDATE harvest_records
      SET enabled = FALSE
      WHERE id = $1
        AND company_id = $2
      RETURNING *
      `,
      [id, company_id]
    );

    return res.json({
      message: 'Registro de cosecha deshabilitado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.enableHarvestRecord = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { id } = req.params;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.'
      });
    }

    const existingResult = await pool.query(
      `
      SELECT id, enabled
      FROM harvest_records
      WHERE id = $1
        AND company_id = $2
      LIMIT 1
      `,
      [id, company_id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Registro de cosecha no encontrado'
      });
    }

    if (existingResult.rows[0].enabled === true) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'El registro de cosecha ya está habilitado'
      });
    }

    const result = await pool.query(
      `
      UPDATE harvest_records
      SET enabled = TRUE
      WHERE id = $1
        AND company_id = $2
      RETURNING *
      `,
      [id, company_id]
    );

    return res.json({
      message: 'Registro de cosecha habilitado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
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
        AND ($2::text IS NULL OR hr.campaign = $2 OR cp.name = $2)
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
        AND ($3::text IS NULL OR hr.campaign = $3 OR cp.name = $3)
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
        COALESCE(cp.name, hr.campaign) AS campaign,
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
      GROUP BY COALESCE(cp.name, hr.campaign)
      ORDER BY COALESCE(cp.name, hr.campaign) ASC
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
      SELECT DISTINCT COALESCE(cp.name, hr.campaign) AS campaign
      FROM harvest_records hr
      LEFT JOIN campaigns cp ON cp.id = hr.campaign_id AND cp.company_id = hr.company_id
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND COALESCE(cp.name, hr.campaign) IS NOT NULL
      ORDER BY COALESCE(cp.name, hr.campaign) DESC
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
      crops: cropsResult.rows.map((row) => row.crop)
    });
  } catch (error) {
    next(error);
  }
};

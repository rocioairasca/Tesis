const { pool } = require('../db/supabaseClient');

function isValidCampaign(campaign) {
    return /^[0-9]{4}-[0-9]{4}/.test(campaign);
}

function normalizeCrop(value) {
  return String(value || '').trim().toLowerCase();
}

exports.createHarvestRecord = async (req, res, next) => {
  try {
    const { company_id, id: authUserId } = req.user;

    const {
      lot_id,
      crop,
      campaign,
      harvest_date,
      production_kg,
      harvested_area_ha,
      notes
    } = req.body;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Falta company_id en el usuario autenticado'
      });
    }

    if (!lot_id || !crop || !campaign || !harvest_date) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'lot_id, crop, campaign y harvest_date son obligatorios'
      });
    }

    const normalizedCrop = normalizeCrop(crop);

    if (!normalizedCrop) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'El cultivo no puede estar vacío'
      });
    }

    if (!isValidCampaign(campaign)) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'La campaña debe tener formato YYYY-YYYY'
      });
    }

    const productionKg = Number(production_kg);
    const harvestedAreaHa = Number(harvested_area_ha);

    if (Number.isNaN(productionKg) || productionKg < 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'production_kg debe ser un número mayor o igual a 0'
      });
    }

    if (Number.isNaN(harvestedAreaHa) || harvestedAreaHa <= 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'harvested_area_ha debe ser un número mayor a 0'
      });
    }

    const lotResult = await pool.query(
      `
      SELECT id, name, area, enabled, company_id
      FROM lots
      WHERE id = $1
        AND company_id = $2
      LIMIT 1
      `,
      [lot_id, company_id]
    );

    if (lotResult.rows.length === 0) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Lote no encontrado para esta empresa'
      });
    }

    const lot = lotResult.rows[0];

    if (!lot.enabled) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No se puede registrar cosecha en un lote deshabilitado'
      });
    }

    const lotArea = Number(lot.area);

    if (Number.isNaN(lotArea) || lotArea <= 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'El lote no tiene una superficie válida configurada'
      });
    }

    const accumulatedResult = await pool.query(
      `
      SELECT COALESCE(SUM(harvested_area_ha), 0) AS harvested_area
      FROM harvest_records
      WHERE company_id = $1
        AND lot_id = $2
        AND crop = $3
        AND campaign = $4
        AND enabled = TRUE
      `,
      [company_id, lot_id, normalizedCrop, campaign]
    );

    const harvestedAreaAccumulated = Number(accumulatedResult.rows[0]?.harvested_area || 0);
    const totalAfterInsert = harvestedAreaAccumulated + harvestedAreaHa;

    if (totalAfterInsert > lotArea) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `La superficie cosechada acumulada (${totalAfterInsert.toFixed(2)} ha) supera la superficie del lote (${lotArea.toFixed(2)} ha)`
      });
    }

    const insertResult = await pool.query(
      `
      INSERT INTO harvest_records (
        company_id,
        lot_id,
        crop,
        campaign,
        harvest_date,
        production_kg,
        harvested_area_ha,
        notes,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        company_id,
        lot_id,
        normalizedCrop,
        campaign,
        harvest_date,
        productionKg,
        harvestedAreaHa,
        notes || null,
        authUserId || null
      ]
    );

    return res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.listHarvestRecords = async (req, res, next) => {
  try {
    const { company_id } = req.user;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Falta company_id en el usuario autenticado'
      });
    }

    const {
      campaign,
      crop,
      lot_id,
      from,
      to,
      includeDisabled = 'false',
      page = 1,
      pageSize = 10
    } = req.query;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100);
    const offset = (pageNumber - 1) * limit;

    const params = [company_id];
    const where = [`hr.company_id = $1`];

    if (includeDisabled !== 'true') {
      where.push(`hr.enabled = TRUE`);
    }

    if (campaign) {
      params.push(campaign);
      where.push(`hr.campaign = $${params.length}`);
    }

    if (crop) {
      params.push(normalizeCrop(crop));
      where.push(`hr.crop = $${params.length}`);
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

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM harvest_records hr
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, params);
    const total = Number(countResult.rows[0]?.total || 0);

    params.push(limit);
    params.push(offset);

    const dataQuery = `
      SELECT
        hr.id,
        hr.company_id,
        hr.lot_id,
        l.name AS lot_name,
        hr.crop,
        hr.campaign,
        hr.harvest_date,
        hr.production_kg,
        hr.harvested_area_ha,
        hr.yield_kg_ha,
        hr.notes,
        hr.created_by,
        hr.enabled,
        hr.created_at,
        hr.updated_at
      FROM harvest_records hr
      JOIN lots l ON l.id = hr.lot_id
      ${whereClause}
      ORDER BY hr.harvest_date DESC, hr.created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const dataResult = await pool.query(dataQuery, params);

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
        message: 'Falta company_id en el usuario autenticado'
      });
    }

    const result = await pool.query(
      `
      SELECT
        hr.id,
        hr.company_id,
        hr.lot_id,
        l.name AS lot_name,
        hr.crop,
        hr.campaign,
        hr.harvest_date,
        hr.production_kg,
        hr.harvested_area_ha,
        hr.yield_kg_ha,
        hr.notes,
        hr.created_by,
        hr.enabled,
        hr.created_at,
        hr.updated_at
      FROM harvest_records hr
      JOIN lots l ON l.id = hr.lot_id
      WHERE hr.id = $1
        AND hr.company_id = $2
      LIMIT 1
      `,
      [id, company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Registro de cosecha no encontrado'
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.updateHarvestRecord = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { id } = req.params;

    const {
      lot_id,
      crop,
      campaign,
      harvest_date,
      production_kg,
      harvested_area_ha,
      notes
    } = req.body;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Falta company_id en el usuario autenticado'
      });
    }

    if (!lot_id || !crop || !campaign || !harvest_date) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'lot_id, crop, campaign y harvest_date son obligatorios'
      });
    }

    const normalizedCrop = normalizeCrop(crop);

    if (!normalizedCrop) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'El cultivo no puede estar vacío'
      });
    }

    if (!isValidCampaign(campaign)) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'La campaña debe tener formato YYYY-YYYY'
      });
    }

    const productionKg = Number(production_kg);
    const harvestedAreaHa = Number(harvested_area_ha);

    if (Number.isNaN(productionKg) || productionKg < 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'production_kg debe ser un número mayor o igual a 0'
      });
    }

    if (Number.isNaN(harvestedAreaHa) || harvestedAreaHa <= 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'harvested_area_ha debe ser un número mayor a 0'
      });
    }

    const existingResult = await pool.query(
      `
      SELECT *
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

    const lotResult = await pool.query(
      `
      SELECT id, name, area, enabled, company_id
      FROM lots
      WHERE id = $1
        AND company_id = $2
      LIMIT 1
      `,
      [lot_id, company_id]
    );

    if (lotResult.rows.length === 0) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Lote no encontrado para esta empresa'
      });
    }

    const lot = lotResult.rows[0];

    if (!lot.enabled) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No se puede registrar cosecha en un lote deshabilitado'
      });
    }

    const lotArea = Number(lot.area);

    if (Number.isNaN(lotArea) || lotArea <= 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'El lote no tiene una superficie válida configurada'
      });
    }

    const accumulatedResult = await pool.query(
      `
      SELECT COALESCE(SUM(harvested_area_ha), 0) AS harvested_area
      FROM harvest_records
      WHERE company_id = $1
        AND lot_id = $2
        AND crop = $3
        AND campaign = $4
        AND enabled = TRUE
        AND id <> $5
      `,
      [company_id, lot_id, normalizedCrop, campaign, id]
    );

    const harvestedAreaAccumulated = Number(accumulatedResult.rows[0]?.harvested_area || 0);
    const totalAfterUpdate = harvestedAreaAccumulated + harvestedAreaHa;

    if (totalAfterUpdate > lotArea) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `La superficie cosechada acumulada (${totalAfterUpdate.toFixed(2)} ha) supera la superficie del lote (${lotArea.toFixed(2)} ha)`
      });
    }

    const updateResult = await pool.query(
      `
      UPDATE harvest_records
      SET
        lot_id = $1,
        crop = $2,
        campaign = $3,
        harvest_date = $4,
        production_kg = $5,
        harvested_area_ha = $6,
        notes = $7
      WHERE id = $8
        AND company_id = $9
      RETURNING *
      `,
      [
        lot_id,
        normalizedCrop,
        campaign,
        harvest_date,
        productionKg,
        harvestedAreaHa,
        notes || null,
        id,
        company_id
      ]
    );

    return res.json(updateResult.rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.disableHarvestRecord = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { id } = req.params;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Falta company_id en el usuario autenticado'
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

    if (existingResult.rows[0].enabled === false) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'El registro de cosecha ya está deshabilitado'
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
        message: 'Falta company_id en el usuario autenticado'
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

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Falta company_id en el usuario autenticado'
      });
    }

    const normalizedCrop = crop ? normalizeCrop(crop) : null;

    const result = await pool.query(
      `
      SELECT
        COUNT(*) AS total_records,
        COALESCE(SUM(hr.production_kg), 0) AS total_production_kg,
        COALESCE(SUM(hr.harvested_area_ha), 0) AS total_area_ha,
        CASE
          WHEN COALESCE(SUM(hr.harvested_area_ha), 0) = 0 THEN 0
          ELSE ROUND(SUM(hr.production_kg) / SUM(hr.harvested_area_ha), 2)
        END AS avg_yield_kg_ha
      FROM harvest_records hr
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND ($2::text IS NULL OR hr.campaign = $2)
        AND ($3::text IS NULL OR hr.crop = $3)
      `,
      [company_id, campaign || null, normalizedCrop]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.getHarvestStatsByCrop = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { campaign } = req.query;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Falta company_id en el usuario autenticado'
      });
    }

    const result = await pool.query(
      `
      SELECT
        hr.crop,
        ROUND(SUM(hr.production_kg), 2) AS production_kg,
        ROUND(SUM(hr.harvested_area_ha), 2) AS area_ha,
        CASE
          WHEN SUM(hr.harvested_area_ha) = 0 THEN 0
          ELSE ROUND(SUM(hr.production_kg) / SUM(hr.harvested_area_ha), 2)
        END AS yield_kg_ha
      FROM harvest_records hr
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND ($2::text IS NULL OR hr.campaign = $2)
      GROUP BY hr.crop
      ORDER BY hr.crop ASC
      `,
      [company_id, campaign || null]
    );

    return res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

exports.getHarvestStatsByCampaign = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { crop } = req.query;

    if (!company_id) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Falta company_id en el usuario autenticado'
      });
    }

    const normalizedCrop = crop ? normalizeCrop(crop) : null;

    const result = await pool.query(
      `
      SELECT
        hr.campaign,
        ROUND(SUM(hr.production_kg), 2) AS production_kg,
        ROUND(SUM(hr.harvested_area_ha), 2) AS area_ha,
        CASE
          WHEN SUM(hr.harvested_area_ha) = 0 THEN 0
          ELSE ROUND(SUM(hr.production_kg) / SUM(hr.harvested_area_ha), 2)
        END AS yield_kg_ha
      FROM harvest_records hr
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
        AND ($2::text IS NULL OR hr.crop = $2)
      GROUP BY hr.campaign
      ORDER BY hr.campaign ASC
      `,
      [company_id, normalizedCrop]
    );

    return res.json(result.rows);
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
        message: 'Falta company_id en el usuario autenticado'
      });
    }

    const campaignsResult = await pool.query(
      `
      SELECT DISTINCT hr.campaign
      FROM harvest_records hr
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
      ORDER BY hr.campaign DESC
      `,
      [company_id]
    );

    const cropsResult = await pool.query(
      `
      SELECT DISTINCT hr.crop
      FROM harvest_records hr
      WHERE hr.company_id = $1
        AND hr.enabled = TRUE
      ORDER BY hr.crop ASC
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
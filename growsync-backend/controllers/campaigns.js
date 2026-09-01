const { pool } = require('../db/supabaseClient');

const fields = 'id, name, work_start_date, start_date, end_date, status, created_at, updated_at';
const CAMPAIGN_IN_USE_MESSAGE = 'Esta campaña tiene información asociada y no puede eliminarse.';
const CAMPAIGN_DATES_OUTSIDE_REFERENCES_MESSAGE = 'No se pueden guardar estas fechas porque existen registros asociados fuera del período seleccionado.';
const CAMPAIGN_NAME_UNIQUE_INDEX = 'campaigns_company_name_ci_unique';
const LEGACY_ONE_ACTIVE_INDEX = 'campaigns_one_active_per_company';

const isDevelopment = () => process.env.NODE_ENV !== 'production';

function logCampaignCreate(stage, payload) {
  if (isDevelopment()) {
    console.log(`[CAMPAIGN CREATE ${stage}]`, payload);
  }
}

function logCampaignDbError(stage, err) {
  if (isDevelopment()) {
    console.error(`[CAMPAIGN ${stage} ERROR]`, {
      code: err.code,
      constraint: err.constraint,
      detail: err.detail,
    });
  }
}

function isUniqueViolation(err, constraintName) {
  return err.code === '23505'
    && (
      err.constraint === constraintName
      || String(err.detail || '').includes(constraintName)
      || String(err.message || '').includes(constraintName)
    );
}

const getCampaignReferenceCounts = async (client, companyId, campaignId) => {
  const { rows } = await client.query(
    `
    WITH refs AS (
      SELECT 'planning' AS table_name, COUNT(*)::int AS count
      FROM planning
      WHERE company_id = $1
        AND campaign_id = $2
      UNION ALL
      SELECT 'crop_assignments' AS table_name, COUNT(*)::int AS count
      FROM crop_assignments
      WHERE company_id = $1
        AND campaign_id = $2
      UNION ALL
      SELECT 'harvest_records' AS table_name, COUNT(*)::int AS count
      FROM harvest_records
      WHERE company_id = $1
        AND campaign_id = $2
    )
    SELECT table_name, count
    FROM refs
    WHERE count > 0
    ORDER BY table_name;
    `,
    [companyId, campaignId]
  );

  return rows;
};

const assertCampaignDatesContainReferences = async (client, companyId, campaignId, workStartDate, startDate, endDate) => {
  const effectiveWorkStartDate = workStartDate || startDate;
  const { rows } = await client.query(
    `
    WITH referenced_dates AS (
      SELECT start_at::date AS date_value
      FROM planning
      WHERE company_id = $1
        AND campaign_id = $2
        AND start_at IS NOT NULL
      UNION ALL
      SELECT end_at::date AS date_value
      FROM planning
      WHERE company_id = $1
        AND campaign_id = $2
        AND end_at IS NOT NULL
      UNION ALL
      SELECT start_date AS date_value
      FROM crop_assignments
      WHERE company_id = $1
        AND campaign_id = $2
      UNION ALL
      SELECT end_date AS date_value
      FROM crop_assignments
      WHERE company_id = $1
        AND campaign_id = $2
        AND end_date IS NOT NULL
      UNION ALL
      SELECT harvest_date AS date_value
      FROM harvest_records
      WHERE company_id = $1
        AND campaign_id = $2
        AND harvest_date IS NOT NULL
    )
    SELECT
      MIN(date_value) AS min_date,
      MAX(date_value) AS max_date,
      COUNT(*)::int AS out_of_range_count
    FROM referenced_dates
    WHERE date_value < $3::date
       OR ($4::date IS NOT NULL AND date_value > $4::date);
    `,
    [companyId, campaignId, effectiveWorkStartDate, endDate]
  );

  const outOfRangeCount = Number(rows[0]?.out_of_range_count || 0);
  if (outOfRangeCount > 0) {
    const err = new Error(CAMPAIGN_DATES_OUTSIDE_REFERENCES_MESSAGE);
    err.status = 409;
    err.details = {
      min_date: rows[0]?.min_date,
      max_date: rows[0]?.max_date,
      out_of_range_count: outOfRangeCount,
    };
    throw err;
  }
};

exports.list = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { includeClosed = false, status } = req.query;
    const params = [company_id];
    const where = ['c.company_id = $1'];

    if (status) {
      params.push(status);
      where.push(`c.status = $${params.length}`);
    } else if (!includeClosed) {
      where.push(`c.status = 'active'`);
    }

    const { rows } = await pool.query(
      `
      SELECT
        c.${fields.replaceAll(', ', ', c.')},
        COALESCE(refs.references_count, 0)::int AS references_count,
        COALESCE(refs.references_count, 0)::int = 0 AS can_delete
      FROM campaigns c
      LEFT JOIN LATERAL (
        SELECT
          (
            SELECT COUNT(*) FROM planning p
            WHERE p.company_id = c.company_id AND p.campaign_id = c.id
          )
          + (
            SELECT COUNT(*) FROM crop_assignments ca
            WHERE ca.company_id = c.company_id AND ca.campaign_id = c.id
          )
          + (
            SELECT COUNT(*) FROM harvest_records hr
            WHERE hr.company_id = c.company_id AND hr.campaign_id = c.id
          ) AS references_count
      ) refs ON TRUE
      WHERE ${where.join(' AND ')}
      ORDER BY c.status ASC, c.start_date DESC, c.name ASC;
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
    const { name, work_start_date = null, start_date, end_date } = req.body;

    logCampaignCreate('REQUEST', {
      name,
      company_id,
      work_start_date: work_start_date || null,
      start_date,
      end_date: end_date || null,
    });

    await client.query('BEGIN');
    const status = req.body.status || 'active';
    const insertName = name.trim();

    logCampaignCreate('INSERT', {
      name: insertName,
      company_id,
      work_start_date: work_start_date || null,
      start_date,
      end_date: end_date || null,
      status,
    });

    const { rows } = await client.query(
      `
      INSERT INTO campaigns (company_id, name, work_start_date, start_date, end_date, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${fields};
      `,
      [company_id, insertName, work_start_date || null, start_date, end_date || null, status]
    );

    await client.query('COMMIT');
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logCampaignDbError('CREATE', err);
    if (isUniqueViolation(err, CAMPAIGN_NAME_UNIQUE_INDEX)) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Ya existe una campaña con ese nombre.',
      });
    }
    if (isUniqueViolation(err, LEGACY_ONE_ACTIVE_INDEX)) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'La base de datos todavía no permite varias campañas activas. Aplicá las migraciones pendientes e intentá nuevamente.',
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

    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      'SELECT id, work_start_date, start_date, end_date, status FROM campaigns WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [id, company_id]
    );

    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'NotFound', message: 'Campaña no encontrada' });
    }

    const nextWorkStart = req.body.work_start_date !== undefined
      ? req.body.work_start_date
      : currentRows[0].work_start_date;
    const nextStart = req.body.start_date ?? currentRows[0].start_date;
    const nextEnd = req.body.end_date !== undefined ? req.body.end_date : currentRows[0].end_date;
    const { rows: dateOrderRows } = await client.query(
      `
      SELECT
        ($1::date IS NULL OR $1::date <= $2::date) AS valid_work_start,
        ($3::date IS NULL OR $2::date <= $3::date) AS valid_date_order;
      `,
      [nextWorkStart, nextStart, nextEnd]
    );
    if (!dateOrderRows[0]?.valid_work_start) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'BadRequest',
        message: 'La fecha "Trabajos desde" no puede ser posterior a la fecha de inicio.',
      });
    }
    if (!dateOrderRows[0]?.valid_date_order) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'BadRequest',
        message: 'La fecha de finalización no puede ser anterior a la fecha de inicio.',
      });
    }

    await assertCampaignDatesContainReferences(client, company_id, id, nextWorkStart, nextStart, nextEnd);

    const nextStatus = req.body.status;

    const sets = [];
    const params = [];
    const push = (value, column) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.name !== undefined) push(req.body.name.trim(), 'name');
    if (req.body.work_start_date !== undefined) push(req.body.work_start_date, 'work_start_date');
    if (req.body.start_date !== undefined) push(req.body.start_date, 'start_date');
    if (req.body.end_date !== undefined) push(req.body.end_date, 'end_date');
    if (nextStatus !== undefined) push(nextStatus, 'status');

    if (!sets.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'BadRequest', message: 'No hay cambios para guardar' });
    }

    params.push(id, company_id);
    const { rows } = await client.query(
      `
      UPDATE campaigns
      SET ${sets.join(', ')}
      WHERE id = $${params.length - 1}
        AND company_id = $${params.length}
      RETURNING ${fields};
      `,
      params
    );

    await client.query('COMMIT');
    return res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logCampaignDbError('UPDATE', err);
    if (isUniqueViolation(err, CAMPAIGN_NAME_UNIQUE_INDEX)) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Ya existe una campaña con ese nombre.',
      });
    }
    if (isUniqueViolation(err, LEGACY_ONE_ACTIVE_INDEX)) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'La base de datos todavía no permite varias campañas activas. Aplicá las migraciones pendientes e intentá nuevamente.',
      });
    }
    next(err);
  } finally {
    client.release();
  }
};

exports.remove = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { company_id } = req.user;

    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      'SELECT id FROM campaigns WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [id, company_id]
    );

    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'NotFound', message: 'Campaña no encontrada' });
    }

    const references = await getCampaignReferenceCounts(client, company_id, id);
    if (references.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Conflict',
        message: CAMPAIGN_IN_USE_MESSAGE,
      });
    }

    const { rows } = await client.query(
      `
      DELETE FROM campaigns
      WHERE id = $1
        AND company_id = $2
      RETURNING id;
      `,
      [id, company_id]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'Conflict',
        message: CAMPAIGN_IN_USE_MESSAGE,
      });
    }
    next(err);
  } finally {
    client.release();
  }
};

exports.close = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;

    const { rows } = await pool.query(
      `
      UPDATE campaigns
      SET status = 'closed'
      WHERE id = $1
        AND company_id = $2
      RETURNING ${fields};
      `,
      [id, company_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'Campaña no encontrada' });
    }

    return res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

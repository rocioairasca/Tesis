const { pool } = require('../db/supabaseClient');

const fields = 'id, name, start_date, end_date, status, created_at, updated_at';
const CAMPAIGN_IN_USE_MESSAGE = 'Esta campaña tiene información asociada y no puede eliminarse.';
const CAMPAIGN_DATES_OUTSIDE_REFERENCES_MESSAGE = 'No se pueden guardar estas fechas porque existen registros asociados fuera del período seleccionado.';

const assertNoCampaignDateOverlap = async (client, companyId, startDate, endDate, excludeId = null) => {
  const { rows } = await client.query(
    `
    SELECT id, name
    FROM campaigns
    WHERE company_id = $1
      AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
      AND ($4::uuid IS NULL OR id <> $4)
    LIMIT 1;
    `,
    [companyId, startDate, endDate, excludeId]
  );

  if (rows.length) {
    const err = new Error('El período se superpone con otra campaña existente.');
    err.status = 409;
    throw err;
  }
};

const resolveCampaignStatusForDates = async (client, startDate, endDate) => {
  const { rows } = await client.query(
    `
    SELECT CASE
      WHEN $1::date <= CURRENT_DATE AND $2::date >= CURRENT_DATE THEN 'active'
      ELSE 'closed'
    END AS status;
    `,
    [startDate, endDate]
  );

  return rows[0]?.status || 'closed';
};

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

const assertCampaignDatesContainReferences = async (client, companyId, campaignId, startDate, endDate) => {
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
       OR date_value > $4::date;
    `,
    [companyId, campaignId, startDate, endDate]
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
    const { name, start_date, end_date } = req.body;

    await client.query('BEGIN');
    await assertNoCampaignDateOverlap(client, company_id, start_date, end_date);
    const status = await resolveCampaignStatusForDates(client, start_date, end_date);

    if (status === 'active') {
      await client.query(
        `
        UPDATE campaigns
        SET status = 'closed'
        WHERE company_id = $1
          AND status = 'active';
        `,
        [company_id]
      );
    }

    const { rows } = await client.query(
      `
      INSERT INTO campaigns (company_id, name, start_date, end_date, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${fields};
      `,
      [company_id, name.trim(), start_date, end_date, status]
    );

    await client.query('COMMIT');
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Ya existe una campaña con ese nombre.',
      });
    }
    if (err.code === '23P01') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'El período se superpone con otra campaña existente.',
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
      'SELECT id, start_date, end_date, status FROM campaigns WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [id, company_id]
    );

    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'NotFound', message: 'Campaña no encontrada' });
    }

    const nextStart = req.body.start_date ?? currentRows[0].start_date;
    const nextEnd = req.body.end_date ?? currentRows[0].end_date;
    const { rows: dateOrderRows } = await client.query(
      'SELECT $1::date <= $2::date AS valid_date_order',
      [nextStart, nextEnd]
    );
    if (!dateOrderRows[0]?.valid_date_order) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'BadRequest',
        message: 'La fecha de inicio no puede ser posterior a la fecha de finalización',
      });
    }

    await assertNoCampaignDateOverlap(client, company_id, nextStart, nextEnd, id);
    await assertCampaignDatesContainReferences(client, company_id, id, nextStart, nextEnd);

    const nextStatus = req.body.status;

    if (nextStatus === 'active') {
      await client.query(
        `
        UPDATE campaigns
        SET status = 'closed'
        WHERE company_id = $1
          AND status = 'active'
          AND id <> $2;
        `,
        [company_id, id]
      );
    }

    const sets = [];
    const params = [];
    const push = (value, column) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.name !== undefined) push(req.body.name.trim(), 'name');
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
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Ya existe una campaña con ese nombre.',
      });
    }
    if (err.code === '23P01') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'El período se superpone con otra campaña existente.',
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

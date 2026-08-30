const { pool } = require('../db/supabaseClient');

const fields = 'id, name, start_date, end_date, status, created_at, updated_at';

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

exports.list = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { includeClosed = false, status } = req.query;
    const params = [company_id];
    const where = ['company_id = $1'];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    } else if (!includeClosed) {
      where.push(`status = 'active'`);
    }

    const { rows } = await pool.query(
      `
      SELECT ${fields}
      FROM campaigns
      WHERE ${where.join(' AND ')}
      ORDER BY status ASC, start_date DESC, name ASC;
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
      'SELECT id, start_date, end_date FROM campaigns WHERE id = $1 AND company_id = $2',
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

    let nextStatus = req.body.status;
    if (req.body.status === 'active' || req.body.start_date !== undefined || req.body.end_date !== undefined) {
      nextStatus = await resolveCampaignStatusForDates(client, nextStart, nextEnd);
    }

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

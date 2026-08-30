const axios = require('axios');
const { pool } = require('../db/supabaseClient');

function ensureTenant(req, res) {
  const { company_id } = req.user || {};

  if (!company_id) {
    res.status(400).json({
      error: 'BadRequest',
      message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.',
    });
    return null;
  }

  return company_id;
}

function todayInArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function findActiveByDate(companyId, date, excludeId = null) {
  const params = [companyId, date];
  let excludeClause = '';

  if (excludeId) {
    params.push(excludeId);
    excludeClause = `AND id <> $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT *
    FROM rain_records
    WHERE company_id = $1
      AND date = $2
      AND enabled = TRUE
      ${excludeClause}
    LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchOpenMeteoDailyRain(latitude, longitude) {
  const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude,
      longitude,
      daily: 'precipitation_sum',
      forecast_days: 1,
      timezone: 'auto',
    },
    timeout: 10000,
  });

  const date = data?.daily?.time?.[0] || todayInArgentina();
  const rainMm = Number(data?.daily?.precipitation_sum?.[0] || 0);

  if (!Number.isFinite(rainMm) || rainMm < 0) {
    throw new Error('Open-Meteo no devolvio precipitation_sum valido');
  }

  return {
    date,
    rain_mm: rainMm,
  };
}

exports.listRainRecords = async (req, res, next) => {
  try {
    const companyId = ensureTenant(req, res);
    if (!companyId) return;

    const {
      from,
      to,
      source,
      includeDisabled = false,
      onlyDisabled = false,
      page = 1,
      pageSize = 10,
    } = req.query;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 1000);
    const offset = (pageNumber - 1) * limit;

    const params = [companyId];
    const where = ['company_id = $1'];

    if (onlyDisabled === true || onlyDisabled === 'true') {
      where.push('enabled = FALSE');
    } else if (!(includeDisabled === true || includeDisabled === 'true')) {
      where.push('enabled = TRUE');
    }

    if (from) {
      params.push(from);
      where.push(`date >= $${params.length}`);
    }

    if (to) {
      params.push(to);
      where.push(`date <= $${params.length}`);
    }

    if (source) {
      params.push(source);
      where.push(`source = $${params.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM rain_records ${whereClause}`,
      params
    );

    const total = Number(countResult.rows[0]?.total || 0);

    params.push(limit, offset);
    const dataResult = await pool.query(
      `
      SELECT *
      FROM rain_records
      ${whereClause}
      ORDER BY date DESC, created_at DESC
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
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getRainRecordById = async (req, res, next) => {
  try {
    const companyId = ensureTenant(req, res);
    if (!companyId) return;

    const result = await pool.query(
      `
      SELECT *
      FROM rain_records
      WHERE id = $1
        AND company_id = $2
      LIMIT 1
      `,
      [req.params.id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: 'Registro de lluvia no encontrado' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.createRainRecord = async (req, res, next) => {
  try {
    const companyId = ensureTenant(req, res);
    if (!companyId) return;

    const { date, rain_mm, source = 'manual', notes } = req.body;
    const duplicate = await findActiveByDate(companyId, date);

    if (duplicate) {
      return res.status(409).json({
        error: 'DuplicateRainRecord',
        message: 'Ya existe un registro activo de lluvia para esa fecha',
      });
    }

    const result = await pool.query(
      `
      INSERT INTO rain_records (date, rain_mm, source, notes, company_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [date, Number(rain_mm), source, notes || null, companyId, req.user.id || null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.updateRainRecord = async (req, res, next) => {
  try {
    const companyId = ensureTenant(req, res);
    if (!companyId) return;

    const { id } = req.params;
    const { date, rain_mm, notes } = req.body;

    const existingResult = await pool.query(
      `
      SELECT *
      FROM rain_records
      WHERE id = $1
        AND company_id = $2
      LIMIT 1
      `,
      [id, companyId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: 'Registro de lluvia no encontrado' });
    }

    const duplicate = await findActiveByDate(companyId, date, id);
    if (duplicate) {
      return res.status(409).json({
        error: 'DuplicateRainRecord',
        message: 'Ya existe un registro activo de lluvia para esa fecha',
      });
    }

    const current = existingResult.rows[0];
    const nextSource = current.source === 'api' ? 'edited_api' : current.source;

    const result = await pool.query(
      `
      UPDATE rain_records
      SET date = $1,
          rain_mm = $2,
          notes = $3,
          source = $4
      WHERE id = $5
        AND company_id = $6
      RETURNING *
      `,
      [date, Number(rain_mm), notes || null, nextSource, id, companyId]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.disableRainRecord = async (req, res, next) => {
  try {
    const companyId = ensureTenant(req, res);
    if (!companyId) return;

    const result = await pool.query(
      `
      UPDATE rain_records
      SET enabled = FALSE
      WHERE id = $1
        AND company_id = $2
        AND enabled = TRUE
      RETURNING *
      `,
      [req.params.id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: 'Registro no encontrado o ya deshabilitado' });
    }

    return res.json({ message: 'Registro de lluvia deshabilitado correctamente', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.enableRainRecord = async (req, res, next) => {
  try {
    const companyId = ensureTenant(req, res);
    if (!companyId) return;

    const currentResult = await pool.query(
      `
      SELECT *
      FROM rain_records
      WHERE id = $1
        AND company_id = $2
      LIMIT 1
      `,
      [req.params.id, companyId]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: 'Registro de lluvia no encontrado' });
    }

    const current = currentResult.rows[0];
    const duplicate = await findActiveByDate(companyId, current.date, current.id);
    if (duplicate) {
      return res.status(409).json({
        error: 'DuplicateRainRecord',
        message: 'Ya existe un registro activo de lluvia para esa fecha',
      });
    }

    const result = await pool.query(
      `
      UPDATE rain_records
      SET enabled = TRUE
      WHERE id = $1
        AND company_id = $2
      RETURNING *
      `,
      [req.params.id, companyId]
    );

    return res.json({ message: 'Registro de lluvia habilitado correctamente', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.syncTodayRain = async (req, res, next) => {
  try {
    const companyId = ensureTenant(req, res);
    if (!companyId) return;

    const { latitude, longitude } = req.body;
    const synced = await fetchOpenMeteoDailyRain(Number(latitude), Number(longitude));
    const existing = await findActiveByDate(companyId, synced.date);

    if (existing && ['manual', 'edited_api'].includes(existing.source)) {
      return res.status(200).json({
        skipped: true,
        message: 'Ya existe un registro manual o corregido para hoy. No se sobrescribio.',
        data: existing,
      });
    }

    if (existing?.source === 'api') {
      const result = await pool.query(
        `
        UPDATE rain_records
        SET rain_mm = $1,
            notes = $2
        WHERE id = $3
          AND company_id = $4
        RETURNING *
        `,
        [synced.rain_mm, 'Sincronizado desde Open-Meteo', existing.id, companyId]
      );

      return res.json({
        skipped: false,
        updated: true,
        message: 'Lluvia de hoy actualizada desde Open-Meteo',
        data: result.rows[0],
      });
    }

    const result = await pool.query(
      `
      INSERT INTO rain_records (date, rain_mm, source, notes, company_id, created_by)
      VALUES ($1, $2, 'api', $3, $4, $5)
      RETURNING *
      `,
      [synced.date, synced.rain_mm, 'Sincronizado desde Open-Meteo', companyId, req.user.id || null]
    );

    return res.status(201).json({
      skipped: false,
      created: true,
      message: 'Lluvia de hoy sincronizada desde Open-Meteo',
      data: result.rows[0],
    });
  } catch (error) {
    if (error.response || error.message?.includes('Open-Meteo')) {
      return res.status(502).json({
        error: 'FetchRainError',
        message: 'Error al obtener precipitacion desde Open-Meteo',
      });
    }
    next(error);
  }
};

exports.getMonthlyRainStats = async (req, res, next) => {
  try {
    const companyId = ensureTenant(req, res);
    if (!companyId) return;

    const result = await pool.query(
      `
      SELECT
        to_char(date_trunc('month', date), 'YYYY-MM') AS month,
        ROUND(SUM(rain_mm), 2) AS rain_mm
      FROM rain_records
      WHERE company_id = $1
        AND enabled = TRUE
      GROUP BY date_trunc('month', date)
      ORDER BY month ASC
      `,
      [companyId]
    );

    return res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const { pool } = require('../db/supabaseClient');

const cropFields = 'id, name, enabled, created_at, updated_at';

exports.list = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    const { rows } = await pool.query(
      `
      SELECT ${cropFields}
      FROM crops
      WHERE company_id = $1
        AND enabled IS TRUE
      ORDER BY name ASC;
      `,
      [company_id]
    );

    return res.json(rows);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    const name = req.body.name.trim();

    const { rows } = await pool.query(
      `
      INSERT INTO crops (company_id, name)
      VALUES ($1, $2)
      RETURNING ${cropFields};
      `,
      [company_id, name]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'El cultivo ya existe.',
      });
    }

    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    const sets = [];
    const params = [];
    const push = (value, column) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.name !== undefined) push(req.body.name.trim(), 'name');
    if (req.body.enabled !== undefined) push(req.body.enabled, 'enabled');

    if (!sets.length) {
      return res.status(400).json({ error: 'BadRequest', message: 'No hay cambios para guardar' });
    }

    params.push(id, company_id);

    const { rows } = await pool.query(
      `
      UPDATE crops
      SET ${sets.join(', ')}
      WHERE id = $${params.length - 1}
        AND company_id = $${params.length}
      RETURNING ${cropFields};
      `,
      params
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'Cultivo no encontrado' });
    }

    return res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'El cultivo ya existe.',
      });
    }

    next(err);
  }
};

exports.disable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    const { rows } = await pool.query(
      `
      UPDATE crops
      SET enabled = FALSE
      WHERE id = $1
        AND company_id = $2
      RETURNING id;
      `,
      [id, company_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'Cultivo no encontrado' });
    }

    return res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    next(err);
  }
};

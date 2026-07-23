const { pool } = require('../db/supabaseClient');

const SELECT_COLUMNS = `
  id, vehicle_id, company_id, fuel_type, liters, current_fuel,
  fuel_after_load, unit_price, total_cost, odometer, supplier,
  loaded_at, notes, created_by, created_at, updated_at
`;

const getUserId = (user) => user?.id || user?.sub || user?.user_id || null;

const ensureVehicleBelongsToCompany = async (vehicleId, companyId) => {
  const { rows } = await pool.query(
    `SELECT id, name FROM vehicles WHERE id = $1 AND company_id = $2 AND enabled IS TRUE`,
    [vehicleId, companyId]
  );
  return rows[0] || null;
};

exports.listByVehicle = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { vehicleId } = req.params;

    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    const vehicle = await ensureVehicleBelongsToCompany(vehicleId, company_id);
    if (!vehicle) {
      return res.status(404).json({ error: 'NotFound', message: 'Vehiculo no encontrado' });
    }

    const { rows } = await pool.query(
      `SELECT ${SELECT_COLUMNS}
       FROM vehicle_fuel_records
       WHERE vehicle_id = $1 AND company_id = $2
       ORDER BY loaded_at DESC, created_at DESC`,
      [vehicleId, company_id]
    );

    const { rows: summaryRows } = await pool.query(
      `SELECT
         COALESCE(SUM(liters), 0)::float AS total_liters,
         COALESCE(SUM(total_cost), 0)::float AS total_cost,
         COUNT(*)::int AS records_count,
         MAX(odometer)::float AS last_odometer,
         (
           SELECT current_fuel::float
           FROM vehicle_fuel_records latest
           WHERE latest.vehicle_id = $1 AND latest.company_id = $2
           ORDER BY latest.loaded_at DESC, latest.created_at DESC
           LIMIT 1
         ) AS current_fuel,
         (
           SELECT fuel_after_load::float
           FROM vehicle_fuel_records latest
           WHERE latest.vehicle_id = $1 AND latest.company_id = $2
           ORDER BY latest.loaded_at DESC, latest.created_at DESC
           LIMIT 1
         ) AS fuel_after_load,
         (
           SELECT loaded_at
           FROM vehicle_fuel_records latest
           WHERE latest.vehicle_id = $1 AND latest.company_id = $2
           ORDER BY latest.loaded_at DESC, latest.created_at DESC
           LIMIT 1
         ) AS last_loaded_at
       FROM vehicle_fuel_records
       WHERE vehicle_id = $1 AND company_id = $2`,
      [vehicleId, company_id]
    );

    res.json({
      data: rows,
      vehicle,
      summary: summaryRows[0] || {
        total_liters: 0,
        total_cost: 0,
        records_count: 0,
        last_odometer: null,
        current_fuel: null,
        fuel_after_load: null,
        last_loaded_at: null,
      },
    });
  } catch (e) {
    next(e);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { vehicleId } = req.params;

    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    const vehicle = await ensureVehicleBelongsToCompany(vehicleId, company_id);
    if (!vehicle) {
      return res.status(404).json({ error: 'NotFound', message: 'Vehiculo no encontrado' });
    }

    const {
      fuel_type = 'diesel',
      liters,
      current_fuel,
      fuel_after_load,
      unit_price = null,
      odometer = null,
      supplier = null,
      loaded_at = new Date(),
      notes = null,
    } = req.body;

    const fuelAfterLoad = fuel_after_load ?? (Number(current_fuel) + Number(liters));

    const { rows } = await pool.query(
      `INSERT INTO vehicle_fuel_records (
         vehicle_id, company_id, fuel_type, liters, current_fuel,
         fuel_after_load, unit_price, odometer, supplier, loaded_at,
         notes, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${SELECT_COLUMNS}`,
      [
        vehicleId,
        company_id,
        fuel_type,
        liters,
        current_fuel,
        fuelAfterLoad,
        unit_price,
        odometer,
        supplier || null,
        loaded_at,
        notes || null,
        getUserId(req.user),
      ]
    );

    res.status(201).json({ record: rows[0] });
  } catch (e) {
    next(e);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { vehicleId, recordId } = req.params;

    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    const { rows } = await pool.query(
      `DELETE FROM vehicle_fuel_records
       WHERE id = $1 AND vehicle_id = $2 AND company_id = $3
       RETURNING id`,
      [recordId, vehicleId, company_id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'NotFound', message: 'Carga de combustible no encontrada' });
    }

    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    next(e);
  }
};

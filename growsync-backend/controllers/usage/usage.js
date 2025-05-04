// IMPORTACION DE POOL DE BD
const db = require("../../db/connection");

// DECLARAMOS FUNCIONES PARA OBTENER, CREAR, EDITAR, DESHABILITAR, OBTENER LOS DESHABILITADOS Y HABILITAR LOS DISTINTOS RDU

// LISTAR RDUs HABILITADOS - Obtiene de la BD todos los RDU habilitados, ordenados por ID
const listUsages = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM usage_records WHERE enabled = TRUE ORDER BY date DESC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al listar registros de uso', error });
  }
};

// CREAR UN RDU - Obtiene informacion del front para crear una nueva entrada en la BD con informacion del RDU
const createUsage = async (req, res) => {
  try {
    const { product_id, amount_used, unit, lot_ids, total_area, previous_crop, current_crop, user_id, date } = req.body;

    // AÑADE UNA NUEVA ENTRADA DE RDU A LA BD
    await db.query(`
      INSERT INTO usage_records (product_id, amount_used, unit, lot_ids, total_area, previous_crop, current_crop, user_id, date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [product_id, amount_used, unit, lot_ids, total_area, previous_crop, current_crop, user_id, date]);

    // DESCUENTA DEL STOCK DISPONIBLE
    await db.query(`
      UPDATE products
      SET available_quantity = available_quantity - $1
      WHERE id = $2
    `, [amount_used, product_id]);

    res.status(201).json({ message: 'Registro de uso creado exitosamente.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al crear registro de uso', error });
  }
};

// EDITAR UN RDU - Se vale del ID para editar los datos de la entrada de la BD que coincida con dicha ID
const editUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const { product_id, amount_used, unit, lot_ids, total_area, previous_crop, current_crop, user_id, date } = req.body;

    await db.query(`
      UPDATE usage_records
      SET product_id = $1, amount_used = $2, unit = $3, lot_ids = $4, total_area = $5, previous_crop = $6, current_crop = $7, user_id = $8, date = $9
      WHERE id = $10
    `, [product_id, amount_used, unit, lot_ids, total_area, previous_crop, current_crop, user_id, date, id]);

    res.status(200).json({ message: 'Registro de uso actualizado exitosamente.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al actualizar registro de uso', error });
  }
};

// DESHABILITAR UN RDU - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const disableUsage = async (req, res) => {
  const { id } = req.params;
  
  try {
    // 1. Busca el registro de uso
    const { rows } = await db.query('SELECT product_id, amount_used FROM usage_records WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Registro de uso no encontrado' });
    }
    const usage = rows[0];

    // 2. Reintegra la cantidad al inventario
    await db.query(`
      UPDATE products
      SET available_quantity = available_quantity + $1
      WHERE id = $2
    `, [usage.amount_used, usage.product_id]);

    // 3. Deshabilita el registro
    await db.query(`
      UPDATE usage_records
      SET enabled = false
      WHERE id = $1
    `, [id]);

    res.status(200).json({ message: 'Registro de uso deshabilitado exitosamente.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al deshabilitar registro de uso', error });
  }
};

// LISTAR RDUs DESHABILITADOS - Obtiene de la BD todos los RDU deshabilitados, ordenados por ID
const listDisabledUsages = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM usage_records WHERE enabled = FALSE ORDER BY date DESC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al listar registros deshabilitados', error });
  }
};

// HABILITAR UN RDU - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const enableUsage = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query('UPDATE usage_records SET enabled = TRUE WHERE id = $1', [id]);
    res.status(200).json({ message: 'Registro de uso habilitado exitosamente.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al habilitar registro de uso', error });
  }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/usage.js)
module.exports = {
  listUsages,
  createUsage,
  editUsage,
  disableUsage,
  listDisabledUsages,
  enableUsage,
};

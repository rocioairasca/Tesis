// IMPORTACION DE POOL DE BD
const db = require('../db/connection'); 

// DECLARAMOS FUNCIONES PARA OBTENER, CREAR, EDITAR Y DESHABILITAR

// LISTAR VEHICULOS - Obtiene de la BD todos los vehiculos habilitados, ordenados por ID
const listVehicles = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM vehicles WHERE enabled = TRUE ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Error al listar vehiculos', error });
  }
};

// CREAR VEHICULOS  - Obtiene informacion del front para crear una nueva entrada en la BD con informacion del vehiculo
const addVehicle = async (req, res) => {
  try {
    const { marca, modelo, tipo, anio, patente } = req.body;
    console.log("datos: ", req.body);
    const result = await db.query(
      `INSERT INTO vehicles (marca, modelo, tipo, anio, patente)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [marca, modelo, tipo, anio, patente]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear vehiculo', error });
  }
};

// EDITAR VEHICULOS - Se vale del ID para editar los datos de la entrada de la BD que coincida con dicha ID
const editVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { marca, modelo, tipo, anio, patente } = req.body;
    const result = await db.query(
      `UPDATE vehicles
       SET marca=$1, modelo=$2, tipo=$3, anio=$4, patente=$5
       WHERE id=$6 RETURNING *`,
      [marca, modelo, tipo, anio, patente, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error al editar vehiculo', error });
  }
};

// DESHABILITAR VEHICULOS - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const disableVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE vehicles SET enabled = FALSE WHERE id = $1', [id]);
    res.status(200).json({ message: 'Vehiculo deshabilitado exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al deshabilitar vehiculo', error });
  }
};

// LISTAR VEHICULOS DESHABILITADOS - Obtiene de la BD todos los vehiculos deshabilitados, ordenados por ID
const listDisabledVehicles = async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM vehicles WHERE enabled = FALSE ORDER BY id');
      res.json(result.rows);
    } catch (error) {
        console.error(error);
      res.status(500).json({ message: 'Error al listar vehiculos deshabilitados', error });
    }
};
  
// HABILITAR VEHICULOS - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const enableVehicle = async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE vehicles SET enabled = TRUE WHERE id = $1', [id]);
      res.status(200).json({ message: 'Vehiculo habilitado exitosamente.' });
    } catch (error) {
        console.error(error);
      res.status(500).json({ message: 'Error al habilitar vehiculo', error });
    }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/products.js)
module.exports = {
  listVehicles,
  addVehicle,
  editVehicle,
  disableVehicle,
  listDisabledVehicles,
  enableVehicle
};

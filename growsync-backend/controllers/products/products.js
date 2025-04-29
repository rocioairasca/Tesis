const db = require('../../db/connection'); 

// LISTAR PRODUCTOS
const listProducts = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products WHERE enabled = TRUE ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Error al listar productos', error });
  }
};

// CREAR PRODUCTO
const addProduct = async (req, res) => {
  try {
    const { name, type, total_quantity, available_quantity, unit, price, acquisition_date } = req.body;
    console.log("datos: ", req.body);
    const result = await db.query(
      `INSERT INTO products (name, type, total_quantity, available_quantity, unit, price, acquisition_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, type, total_quantity, available_quantity, unit, price, acquisition_date]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear producto', error });
  }
};

// EDITAR PRODUCTO
const editProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, total_quantity, available_quantity, unit, price, acquisition_date } = req.body;
    const result = await db.query(
      `UPDATE products
       SET name=$1, type=$2, total_quantity=$3, available_quantity=$4, unit=$5, price=$6, acquisition_date=$7
       WHERE id=$8 RETURNING *`,
      [name, type, total_quantity, available_quantity, unit, price, acquisition_date, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error al editar producto', error });
  }
};

// DESHABILITAR PRODUCTO
const disableProduct = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE products SET enabled = FALSE WHERE id = $1', [id]);
    res.status(200).json({ message: 'Producto deshabilitado exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al deshabilitar producto', error });
  }
};

module.exports = {
  listProducts,
  addProduct,
  editProduct,
  disableProduct
};

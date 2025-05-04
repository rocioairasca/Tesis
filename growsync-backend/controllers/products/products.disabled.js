// IMPORTACION DE POOL DE BD
const db = require('../../db/connection'); 

// DECLARAMOS FUNCIONES PARA OBTENER Y HABILITAR PRODUCTOS

// LISTAR PRODUCTOS DESHABILITADOS - Obtiene de la BD todos los productos deshabilitados, ordenados por ID
const listDisabledProducts = async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM products WHERE enabled = FALSE ORDER BY id');
      res.json(result.rows);
    } catch (error) {
        console.error(error);
      res.status(500).json({ message: 'Error al listar productos deshabilitados', error });
    }
};
  
// HABILITAR PRODUCTOS - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const enableProduct = async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE products SET enabled = TRUE WHERE id = $1', [id]);
      res.status(200).json({ message: 'Producto habilitado exitosamente.' });
    } catch (error) {
        console.error(error);
      res.status(500).json({ message: 'Error al habilitar producto', error });
    }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/products.js)
module.exports = {
    listDisabledProducts, 
    enableProduct          
};
  
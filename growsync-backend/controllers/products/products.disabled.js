const db = require('../../db/connection'); 

// LISTAR PRODUCTOS DESHABILITADOS
const listDisabledProducts = async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM products WHERE enabled = FALSE ORDER BY id');
      res.json(result.rows);
    } catch (error) {
        console.error(error);
      res.status(500).json({ message: 'Error al listar productos deshabilitados', error });
    }
};
  
// HABILITAR PRODUCTO
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
  
module.exports = {
    listDisabledProducts, 
    enableProduct          
};
  
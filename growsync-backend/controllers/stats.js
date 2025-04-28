const db = require('../db/connection');

const getStats = async (req, res) => {
  try {
    const [users, products, lots, usages] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) FROM products WHERE enabled = true'),
      db.query('SELECT COUNT(*) FROM lots WHERE enabled = true'),
      db.query('SELECT COUNT(*) FROM usage_records WHERE enabled = true')
    ]);

    res.json({
      users: parseInt(users.rows[0].count),
      products: parseInt(products.rows[0].count),
      lots: parseInt(lots.rows[0].count),
      usages: parseInt(usages.rows[0].count)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener estadísticas', error });
  }
};

module.exports = { getStats };

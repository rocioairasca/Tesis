const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

pool.connect()
    .then(() => console.log("🟢 Conectado a PostgreSQL"))
    .catch(err => console.error("🔴 Error de conexión a PostgreSQL", err));

module.exports = pool;
// IMPORTACION DE CLASES Y VARIABLES DE ENTORNO
const { Pool } = require('pg');
require('dotenv').config();

// CREAMOS UNA INSTANCIA DE POOL PARA CONECTARNOS A LA BD
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

// INTENTAMOS USAR POOL PARA CONECTARNOS A LA BD
pool.connect()
    .then(() => console.log("🟢 Conectado a PostgreSQL"))
    .catch(err => console.error("🔴 Error de conexión a PostgreSQL", err));

// EXPORTAMOS EL POOL PARA USARLO EN EL PROYECTO Y REALIZAR CONSULTAS A LA BD
module.exports = pool;
// db/supabaseClient.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const postgres = require('postgres');
const calendarDateTypes = require('./calendarDateType');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Usa SUPABASE_DB_URL (o DATABASE_URL). Para pooler agrega sslmode=require en la URL.
let connStr = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '').trim();
if (!connStr) console.warn('⚠️ Falta SUPABASE_DB_URL/DATABASE_URL');
if (/supabase\.(co|net)/i.test(connStr) && !/sslmode=/i.test(connStr)) {
  connStr += (connStr.includes('?') ? '&' : '?') + 'sslmode=require';
}

let sql = null;
let pool = null;

if (connStr) {
  sql = postgres(connStr, { max: 10, types: calendarDateTypes }); // DATE stays YYYY-MM-DD

  // Adaptador compatible con pg.Pool
  pool = {
    // pool.query(text, params)
    query: async (text, params) => {
      const values = Array.isArray(params) ? params : [];
      const rows = await sql.unsafe(text, values);
      return { rows };
    },

    // pool.connect() → client { query, release }
    connect: async () => {
      const reserved = await sql.reserve(); // misma conexión para toda la transacción
      return {
        query: async (text, params) => {
          const values = Array.isArray(params) ? params : [];
          const rows = await reserved.unsafe(text, values);
          return { rows };
        },
        release: () => reserved.release(),
      };
    },

    end: (opts) => sql.end(opts),
  };

  try {
    const { hostname } = new URL(connStr);
    console.log('🟢 postgres.js conectado a', hostname);
  } catch (e) {
    console.log('🟢 postgres.js inicializado');
  }
}

module.exports = supabase;
module.exports.pool = pool;

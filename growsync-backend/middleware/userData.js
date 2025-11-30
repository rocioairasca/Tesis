// IMPORTACION DE CLIENTE SUPABASE
const supabase = require("../db/supabaseClient");

// Middleware: carga datos del user (id, email, role) en req.user a partir del sub del JWT
// REquiere que checkJwt haya corrido antes y haya dejado el payload en req.auth
module.exports = async function userData(req, res, next) {
  try {
    // 1. Extramos el "sub" del token
    const sub =
      req.auth?.sub ||
      req.auth?.payload?.sub ||
      req.user?.sub ||
      null;

    if (!sub) {
      return res.status(401).json({ message: 'Token invalido: no se encontro el sub' });
    }

    // 2. campos que necesitamos del user
    const selectCols = 'id, email, role, enabled, company_id';

    // Buscamos el usuario en la base de datos
    // Usamos maybeSingle para evitar errores si no se encuentra el usuario
    const fetchMaybeSingle = async (column, value) => {
      if (typeof supabase.from('users').select(selectCols).maybeSingle === "function") {
        return supabase.from('users').select(selectCols).eq(column, value).maybeSingle();
      } else {
        // Si maybeSingle no está disponible, usamos single y manejamos el error
        const r = await supabase.from('users').select(selectCols).eq(column, value).single();
        // same shape
        return r;
      }
    };

    // 3. Buscamos primero por auth0_id, desp por auth0_sub
    let userDb = null;
    let error = null;

    let resp = await fetchMaybeSingle('auth0_id', sub);
    userDb = resp.data; error = resp.error;

    if (!userDb && !error) {
      // Si no se encontró por auth0_id, intentamos con auth0_sub
      console.error("Error al obtener usuario en Supabase:", error);
      return res.status(500).json({ message: "Error al obtener datos de usuario" });
    }

    // 4) Manejo de errores / no encontrado
    if (error && error.code && error.code !== "PGRST116") {
      // error real de Supabase
      console.error("Error al obtener usuario en Supabase:", error);
      return res.status(500).json({ message: "Error al obtener datos de usuario" });
    }

    if (!userDb) {
      // No existe en BD → no está “provisionado”
      return res.status(403).json({ message: "Usuario no registrado en BD" });
    }

    // 5) Usuario deshabilitado (soft delete)
    if (userDb.enabled === false) {
      return res.status(403).json({ message: "Usuario deshabilitado" });
    }

    // 6) Setear req.user para checkRole y controladores
    req.user = {
      id: userDb.id,
      email: userDb.email,
      role: Number(userDb.role) || 0,
      company_id: userDb.company_id,
      sub, // útil para trazas
    };

    return next();

  } catch (err) {
    console.error("Error en userData middleware:", err);
    return res.status(500).json({ message: "Error al obtener datos de usuario" });
  }
};

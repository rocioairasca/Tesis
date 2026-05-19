const supabase = require("../db/supabaseClient");

module.exports = async function userData(req, res, next) {
  try {
    const sub =
      req.auth?.sub ||
      req.auth?.payload?.sub ||
      req.user?.sub ||
      null;

    const email =
      req.auth?.email ||
      req.auth?.payload?.email ||
      req.user?.email ||
      null;

    if (!sub) {
      return res.status(401).json({ message: "Token invalido: no se encontro el sub" });
    }

    const selectCols = "id, email, role, enabled, company_id, auth0_id, auth0_sub, custom_permissions";

    const fetchMaybeSingle = async (column, value) => {
      if (!value) return { data: null, error: null };

      const query = supabase
        .from("users")
        .select(selectCols)
        .eq(column, value);

      if (typeof query.maybeSingle === "function") {
        return query.maybeSingle();
      }

      return query.single();
    };

    let userDb = null;
    let error = null;

    // 1) Buscar por auth0_id
    let resp = await fetchMaybeSingle("auth0_id", sub);
    userDb = resp.data;
    error = resp.error;

    // 2) Si no encontró y no hubo error real, buscar por auth0_sub
    if (!userDb && !error) {
      resp = await fetchMaybeSingle("auth0_sub", sub);
      userDb = resp.data;
      error = resp.error;
    }

    // 3) Si no encontró y no hubo error real, buscar por email
    if (!userDb && !error && email) {
      resp = await fetchMaybeSingle("email", email);
      userDb = resp.data;
      error = resp.error;

      // opcional: si lo encontró por email, sincronizar sub en la BD
      if (userDb) {
        const { error: updateError } = await supabase
          .from("users")
          .update({
            auth0_id: sub,
            auth0_sub: sub,
          })
          .eq("id", userDb.id);

        if (updateError) {
          console.error("No se pudo sincronizar auth0_id/auth0_sub:", updateError);
        } else {
          userDb.auth0_id = sub;
          userDb.auth0_sub = sub;
        }
      }
    }

    // 4) Error real de Supabase
    if (error && error.code && error.code !== "PGRST116") {
      console.error("Error al obtener usuario en Supabase:", error);
      return res.status(500).json({ message: "Error al obtener datos de usuario" });
    }

    // 5) No existe en la BD
    if (!userDb) {
      return res.status(403).json({ message: "Usuario no registrado en BD" });
    }

    if (userDb.enabled === false) {
      return res.status(403).json({ message: "Usuario deshabilitado" });
    }

    if (!userDb.company_id) {
      return res.status(400).json({ message: "Usuario sin empresa asignada" });
    }

    req.user = {
      id: userDb.id,
      email: userDb.email,
      role: Number(userDb.role) || 0,
      company_id: userDb.company_id,
      custom_permissions: userDb.custom_permissions || null,
      sub,
    };

    return next();
  } catch (err) {
    console.error("Error en userData middleware:", err);
    return res.status(500).json({ message: "Error al obtener datos de usuario" });
  }
};
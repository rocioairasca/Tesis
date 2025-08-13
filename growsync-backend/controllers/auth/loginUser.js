// controllers/auth/loginUser.js
// Inicia sesion contra Auth0 usando el Password Realm Grant (ROPG) y entrega un access_token valido

const axios = require("axios");

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  // 1) Validacion rapida de entrada
  if (!email || !password) {
    return res.status(400).json({ error: "BadRequest", message: "Email y contraseña son requeridos" });
  }

  // 2) Variables de entorno (todas necesarias)
  const {
    AUTH0_DOMAIN,           
    AUTH0_API_AUDIENCE,     
    AUTH0_CLIENT_ID,
    AUTH0_CLIENT_SECRET,
    AUTH0_REALM = "Username-Password-Authentication",
  } = process.env;

  if (!AUTH0_DOMAIN || !AUTH0_API_AUDIENCE || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET) {
    return res.status(500).json({ error: "ServerConfig", message: "Faltan variables de entorno de Auth0" });
  }

  try {
    // 3) Construir request a Auth0
    const url = `https://${AUTH0_DOMAIN}/oauth/token`;
    const payload = {
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      username: email,
      password,
      audience: AUTH0_API_AUDIENCE,       // <- clave para obtener access_token RS256 de tu API
      client_id: AUTH0_CLIENT_ID,
      client_secret: AUTH0_CLIENT_SECRET, // <- se mantiene en backend, nunca en el front
      scope: "openid profile email",      // (NO mandamos offline_access para no emitir refresh_token)
      realm: AUTH0_REALM,                 // conexion de base de datos de Auth0
    };

    const { data } = await axios.post(url, payload, {
      timeout: 10000,                     // 10s de timeout
      headers: { "Content-Type": "application/json" },
    });

    if (!data?.access_token) {
      // Algo anduvo mal del lado de Auth0
      return res.status(502).json({ error: "Auth0Response", message: "Auth0 no devolvió access_token" });
    }

    // 4) Responder: el front debe usar el access_token en Authorization: Bearer <token>
    return res.status(200).json({
      access_token: data.access_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      // id_token es util en el cliente para claims de perfil, pero NO sirve para autorizar la API.
      id_token: data.id_token, 
    });

  } catch (err) {
    // 5) Manejo fino de errores de Auth0
    const ax = err.response?.data || {};
    const code = ax.error || err.code;
    const description = ax.error_description || err.message;

    // Casos comunes
    if (code === "invalid_grant") {
      return res.status(401).json({ error: "invalid_grant", message: "Email o contraseña incorrectos" });
    }
    if (code === "mfa_required") {
      // Flujo de MFA: el cliente necesitara usar mfa_token en el siguiente paso de verificacion MFA
      return res.status(403).json({
        error: "mfa_required",
        message: "Se requiere MFA",
        mfa_token: ax.mfa_token,
      });
    }
    if (code === "too_many_requests" || err.response?.status === 429) {
      return res.status(429).json({ error: "too_many_requests", message: "Demasiados intentos, intenta más tarde" });
    }
    if (code === "access_denied") {
      return res.status(403).json({ error: "access_denied", message: "Acceso denegado por el proveedor de identidad" });
    }

    // Log minimal (sin credenciales)
    console.error("Login error:", { status: err.response?.status, code, description });
    return res.status(500).json({ error: "AuthError", message: "No se pudo iniciar sesión", details: description });
  }
};

module.exports = loginUser;

// controllers/auth/registerUser.js
// Crea un usuario en Auth0 (Management API) y lo persiste en Supabase.
// Si falla la persistencia en BD, elimina el usuario recien creado en Auth0 (rollback).

const axios = require('axios');
const supabase = require('../../db/supabaseClient');

module.exports = async function registerUser(req, res) {
  const { email, password, username } = req.body;

  // 1) Validacion basica
  if (!email || !password) {
    return res.status(400).json({ error: 'BadRequest', message: 'Email y contraseña son requeridos' });
  }

  const {
    AUTH0_DOMAIN,               
    AUTH0_M2M_CLIENT_ID,
    AUTH0_M2M_CLIENT_SECRET        
  } = process.env;

  if (!AUTH0_DOMAIN || !AUTH0_M2M_CLIENT_ID || !AUTH0_M2M_CLIENT_SECRET) {
    return res.status(500).json({ error: 'ServerConfig', message: 'Faltan variables de entorno Auth0 M2M' });
  }

  // Audience por defecto (Management API)
  const MGMT_AUDIENCE = `https://${AUTH0_DOMAIN}/api/v2/`;

  let mgmtToken;
  let createdAuth0UserId; // para rollback

  try {
    // 2) Pre-chequeo en BD para evitar usuarios duplicados
    const pre = await supabase
      .from('users')
      .select('id, enabled')
      .eq('email', email)
      .maybeSingle();

    if (pre.error && pre.error.code && pre.error.code !== 'PGRST116') {
      console.error('Supabase pre-check error:', pre.error);
      return res.status(500).json({ error: 'DbError', message: 'Error verificando email' });
    }
    if (pre.data) {
      return res.status(409).json({
        error: 'Conflict',
        message: pre.data.enabled === false
          ? 'El usuario existe pero está deshabilitado'
          : 'El email ya está registrado',
      });
    }

    // 3) Obtener token de Management API (Client Credentials)
    const tokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
    const tokenPayload = {
      grant_type: 'client_credentials',
      client_id: AUTH0_M2M_CLIENT_ID,
      client_secret: AUTH0_M2M_CLIENT_SECRET,
      audience: MGMT_AUDIENCE,
    };
    const tokenRes = await axios.post(tokenUrl, tokenPayload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
    mgmtToken = tokenRes.data?.access_token;
    if (!mgmtToken) {
      return res.status(502).json({ error: 'Auth0Response', message: 'Auth0 no devolvió access_token de Management' });
    }

    // 4) Crear usuario en Auth0 (Base DB connection)
    const createUrl = `https://${AUTH0_DOMAIN}/api/v2/users`;
    const createPayload = {
      email,
      password,
      connection: 'Username-Password-Authentication',
      user_metadata: { username: username || null },
      email_verified: false, 
      verify_email: true,    
    };
    const createRes = await axios.post(createUrl, createPayload, {
      timeout: 10000,
      headers: { Authorization: `Bearer ${mgmtToken}` },
    });

    createdAuth0UserId = createRes.data?.user_id; 
    const nickname = createRes.data?.nickname || null;
    const picture  = createRes.data?.picture  || null;
    const name     = createRes.data?.name     || null;

    if (!createdAuth0UserId) {
      return res.status(502).json({ error: 'Auth0Response', message: 'Auth0 no devolvió user_id' });
    }

    // 5) Insert en Supabase
    const { data, error } = await supabase
      .from('users')
      .insert([{
        auth0_id: createdAuth0UserId, 
        email,
        username: username || null,
        role: 0,          // rol por defecto
        nickname,
        picture,
        name,
        enabled: true,    // por defecto habilitado
      }])
      .select()
      .single();

    if (error) {
      // 6) Rollback en Auth0 si falla BD
      try {
        await axios.delete(
          `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(createdAuth0UserId)}`,
          { headers: { Authorization: `Bearer ${mgmtToken}` }, timeout: 10000 }
        );
      } catch (delErr) {
        console.error('⚠️ Falló el rollback en Auth0:', delErr.response?.data || delErr.message);
      }
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al guardar el usuario en la base de datos' });
    }

    // 7) OK
    return res.status(201).json({
      message: 'Usuario creado correctamente',
      user: data,
    });

  } catch (err) {
    // Mapeo fino de errores de Auth0
    const ax = err.response?.data || {};
    const code = ax.error || err.code;
    const description = ax.error_description || err.message;

    // Usuario ya existe en Auth0
    if (code === 'invalid_request' && /The user already exists/i.test(description)) {
      return res.status(409).json({ error: 'Conflict', message: 'El usuario ya existe en Auth0' });
    }

    console.error('Register error:', { status: err.response?.status, code, description });
    return res.status(500).json({
      error: 'RegisterError',
      message: 'No se pudo crear el usuario',
      details: description,
    });
  }
};

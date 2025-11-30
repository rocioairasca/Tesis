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
    // 2) Validar Token de Invitacion (Restricted Access)
    const { token } = req.body;
    if (!token) {
      return res.status(403).json({ error: 'Forbidden', message: 'El registro requiere una invitación válida' });
    }

    // Buscar invitacion valida
    const { data: invite, error: inviteError } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (inviteError || !invite) {
      return res.status(403).json({ error: 'InvalidToken', message: 'Invitación inválida o expirada' });
    }

    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ error: 'BadRequest', message: 'El email no coincide con la invitación' });
    }

    // 3) Pre-chequeo en BD para evitar usuarios duplicados
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

    // 4) Obtener token de Management API (Client Credentials)
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

    // 5) Crear usuario en Auth0 (Base DB connection)
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
    const picture = createRes.data?.picture || null;
    const name = createRes.data?.name || null;

    if (!createdAuth0UserId) {
      return res.status(502).json({ error: 'Auth0Response', message: 'Auth0 no devolvió user_id' });
    }

    // 6) Insert en Supabase (Usando datos de la invitacion)
    const { data, error } = await supabase
      .from('users')
      .insert([{
        auth0_id: createdAuth0UserId,
        email,
        username: username || null,
        role: invite.role,          // Rol desde la invitacion
        company_id: invite.company_id, // Company desde la invitacion
        nickname,
        picture,
        name,
        enabled: true,
      }])
      .select()
      .single();

    if (error) {
      // 7) Rollback en Auth0 si falla BD
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

    // 8) Marcar invitacion como usada
    await supabase
      .from('invitations')
      .update({ used: true })
      .eq('id', invite.id);

    // [NOTIFICACIÓN] Nuevo usuario
    // Notificar a administradores (role 1 o 2) DE LA MISMA EMPRESA
    const { data: admins } = await supabase
      .from('users')
      .select('id')
      .eq('company_id', invite.company_id) // Solo admins de esa empresa
      .in('role', [1, 2]);

    if (admins && admins.length) {
      const { createNotification } = require('../../controllers/notifications'); // Ajuste de path si es necesario
      for (const admin of admins) {
        createNotification(
          admin.id,
          'new_user',
          'medium',
          'Nuevo usuario registrado',
          `Se ha registrado el usuario: ${email}`,
          { user_id: data.id, email },
          invite.company_id // Pasar company_id a la notificacion
        ).catch(e => console.error('Error notificando admin:', e));
      }
    }

    // 9) OK
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

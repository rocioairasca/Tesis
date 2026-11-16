const { pool } = require("../db/supabaseClient");
const axios = require("axios");
const { Payment } = require("mercadopago");
const mercadoPagoClient = require("../src/config/mercadoPago");
const registrationPayments = require("../services/registrationPayments");
const { seedDefaultCrops } = require("../services/defaultCrops");

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_M2M_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_M2M_CLIENT_SECRET;
const mercadoPagoPaymentClient = new Payment(mercadoPagoClient);

const getAuth0ManagementToken = async () => {
  const { data } = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
    client_id: AUTH0_CLIENT_ID,
    client_secret: AUTH0_CLIENT_SECRET,
    audience: `https://${AUTH0_DOMAIN}/api/v2/`,
    grant_type: "client_credentials",
  }, { timeout: 10000 });

  return data.access_token;
};

exports.registerCompany = async (req, res) => {
  let client;
  try {
    const { companyName, adminName, email, password, paymentId, mercadoPagoExternalReference } = req.body || {};
    if ([companyName, adminName, email, password].some(value => typeof value !== 'string' || !value.trim())) {
      return res.status(400).json({ error: 'BadRequest', message: 'Faltan datos obligatorios' });
    }
    const registrationToken = req.get('X-Registration-Token');
    res.set('Cache-Control', 'no-store');
    const payment = await registrationPayments.verify(pool, mercadoPagoPaymentClient,
      { paymentId, mercadoPagoExternalReference, registrationToken });
    const normalizedEmail = email.toLowerCase().trim();
    client = await pool.connect();
    await client.query('BEGIN');
    await registrationPayments.claim(client, payment, registrationToken);

    const existing = await client.query('SELECT id FROM users WHERE email=$1', [normalizedEmail]);
    if (existing.rows.length) throw Object.assign(new Error('Ya existe un usuario con ese email'), { status: 409 });

    const { rows: [company] } = await client.query('INSERT INTO companies(name) VALUES($1) RETURNING *', [companyName.trim()]);
    await seedDefaultCrops(client, company.id);
    const managementToken = await getAuth0ManagementToken();
    const { data: auth0User } = await axios.post(`https://${AUTH0_DOMAIN}/api/v2/users`, {
      email: normalizedEmail,
      password,
      name: adminName,
      connection: 'Username-Password-Authentication',
      email_verified: false,
    }, { headers: { Authorization: `Bearer ${managementToken}` }, timeout: 10000 });

    await client.query(`INSERT INTO users(email,full_name,role,enabled,company_id,auth0_id)
      VALUES($1,$2,3,true,$3,$4)`, [normalizedEmail, adminName.trim(), company.id, auth0User.user_id]);
    await client.query(`UPDATE public.company_registration_payments SET company_id=$3,consumed_at=now()
      WHERE provider=$1 AND reference=$2`, [payment.provider, payment.reference, company.id]);
    await client.query('COMMIT');
    return res.status(201).json({ message: 'Empresa y administrador creados correctamente', company });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    const status = error.code === '23505' ? 409 : error.status || 500;
    // Never log the Axios request, password, tokens or provider response bodies.
    console.error('Error registerCompany:', { status, code: error.code });
    return res.status(status).json({
      error: status === 409 ? 'Conflict' : status === 402 ? 'PaymentRequired' : status === 403 ? 'Forbidden' : 'InternalServerError',
      message: error.code === '23505' ? 'El pago o usuario ya fue registrado' :
        [402,403,409,503].includes(status) ? error.message : 'No se pudo registrar la empresa',
    });
  } finally {
    client?.release();
  }
};

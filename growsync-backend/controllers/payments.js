const crypto = require('node:crypto');
const { pool } = require('../db/supabaseClient');
const { PLAN_CONFIG } = require('../services/registrationPayments');
const { requireSimulation } = require('../services/simulatedPayments');
const intents = require('../services/registrationIntents');

function generateTransactionNumber() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `GS-${timestamp}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function mapPayment(row) {
  if (!row) return null;
  const { id, plan, amount, payment_method, transaction_number, status, created_at } = row;
  return { id, plan, amount, payment_method, transaction_number, status, created_at,
    plan_label: PLAN_CONFIG[plan]?.label || plan };
}
function respondError(res, error) {
  console.error('Simulated payment failed:', { status: error.status, code: error.code });
  const status = [403,409,503].includes(error.status) ? error.status : 500;
  return res.status(status).json({ message: status === 500 ? 'No se pudo procesar el pago simulado' : error.message });
}

exports.createSimulatedPayment = async (req, res) => {
  if (requireSimulation(req, res, () => true) !== true) return;
  res.set('Cache-Control', 'no-store');
  let client;
  try {
    const { plan, payment_method } = req.body;
    const config = Object.hasOwn(PLAN_CONFIG, plan) ? PLAN_CONFIG[plan] : null;
    if (!config) return res.status(400).json({ error: 'InvalidPlan', message: 'Plan invalido' });
    if (!pool) throw Object.assign(new Error('El registro no está disponible temporalmente'), { status: 503 });
    const { registrationToken, registrationTokenHash } = intents.issue();
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: [payment] } = await client.query(`INSERT INTO payments(plan,amount,payment_method,transaction_number,status)
      VALUES($1,$2,$3,$4,'pending') RETURNING *`, [plan, config.amount, payment_method, generateTransactionNumber()]);
    await client.query(`INSERT INTO public.company_registration_payments
      (provider,reference,plan,amount,currency,registration_token_hash)
      VALUES('simulated',$1,$2,$3,'ARS',$4)`, [payment.id,plan,config.amount,registrationTokenHash]);
    await client.query('COMMIT');
    return res.status(201).json({ message: 'Pago simulado creado', payment: mapPayment(payment), registrationToken });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return respondError(res,error);
  } finally { client?.release(); }
};

exports.confirmSimulatedPayment = async (req, res) => {
  if (requireSimulation(req, res, () => true) !== true) return;
  res.set('Cache-Control', 'no-store');
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await intents.validate(client, { provider: 'simulated', reference: req.params.id,
      registrationToken: req.get('X-Registration-Token') }, { lock: true });
    const { rows: [payment] } = await client.query("UPDATE payments SET status='approved' WHERE id=$1 RETURNING *",[req.params.id]);
    if (!payment) throw intents.denied();
    await client.query('COMMIT');
    return res.json({ message: 'Pago aprobado', payment: mapPayment(payment) });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return respondError(res,error);
  } finally { client?.release(); }
};

exports.getSimulatedPaymentById = async (req, res) => {
  if (requireSimulation(req, res, () => true) !== true) return;
  res.set('Cache-Control', 'no-store');
  try {
    await intents.validate(pool, { provider: 'simulated', reference: req.params.id,
      registrationToken: req.get('X-Registration-Token') });
    const { rows: [payment] } = await pool.query('SELECT * FROM payments WHERE id=$1',[req.params.id]);
    if (!payment) throw intents.denied();
    return res.json({ payment: mapPayment(payment) });
  } catch (error) { return respondError(res,error); }
};

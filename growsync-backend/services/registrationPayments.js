const intents = require('./registrationIntents');
const simulation = require('./simulatedPayments');
const PLAN_CONFIG = {
  basic: { label: 'Basico', amount: 20000 },
  professional: { label: 'Profesional', amount: 45000 },
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const required = () => fail(402, 'Debes confirmar un pago válido antes de registrar la empresa');
const consumed = () => fail(409, 'Este pago ya fue utilizado para registrar una empresa');

async function verify(pool, paymentClient, { paymentId, mercadoPagoExternalReference, registrationToken }) {
  if (paymentId && !simulation.enabled()) throw fail(403, 'Los pagos simulados no están habilitados.');
  if (Boolean(paymentId) === Boolean(mercadoPagoExternalReference)) throw required();
  const reference = paymentId || mercadoPagoExternalReference;
  const provider = paymentId ? 'simulated' : 'mercadopago';
  const intent = await intents.validate(pool, { provider, reference, registrationToken });

  if (paymentId) {
    const { rows: [payment] } = await pool.query('SELECT id, status, plan, amount FROM payments WHERE id=$1', [reference]);
    const plan = payment && PLAN_CONFIG[payment.plan];
    if (!plan || payment.status !== 'approved' || payment.plan !== intent.plan ||
        Number(payment.amount) !== Number(intent.amount) || Number(payment.amount) !== plan.amount) throw required();
    return { provider: 'simulated', reference: payment.id, paymentId: payment.id,
      plan: payment.plan, amount: payment.amount, currency: 'ARS' };
  }

  const search = await paymentClient.search({ options: { external_reference: intent.reference } });
  const candidates = (search.results || []).filter(payment =>
    payment.status === 'approved' && payment.external_reference === intent.reference && payment.id);
  for (const candidate of candidates) {
    // Re-read the payment itself: search results and browser redirect fields are not approval evidence.
    const payment = await paymentClient.get({ id: candidate.id });
    if (String(payment.id) !== String(candidate.id) ||
        payment.status !== 'approved' || payment.live_mode !== true ||
        payment.external_reference !== intent.reference || payment.metadata?.plan !== intent.plan ||
        Number(payment.transaction_amount) !== Number(intent.amount) || payment.currency_id !== intent.currency ||
        Number(payment.transaction_amount_refunded || 0) !== 0) continue;
    return { provider: 'mercadopago', reference: intent.reference, paymentId: String(payment.id),
      plan: intent.plan, amount: intent.amount, currency: intent.currency };
  }
  throw required();
}

// Called inside the same SQL transaction as company/user creation. The lock spans consumption.
async function claim(client, payment, registrationToken) {
  const intent = await intents.validate(client, { ...payment, registrationToken }, { lock: true });
  if (!intent || intent.plan !== payment.plan || Number(intent.amount) !== Number(payment.amount) ||
      intent.currency !== payment.currency) throw required();
  if (intent.company_id) throw consumed();
  // UNIQUE(provider,provider_payment_id) also prevents reuse under another reference.
  await client.query(`UPDATE public.company_registration_payments SET provider_payment_id=$3
    WHERE provider=$1 AND reference=$2`, [payment.provider, payment.reference, payment.paymentId]);
}

module.exports = { PLAN_CONFIG, verify, claim };

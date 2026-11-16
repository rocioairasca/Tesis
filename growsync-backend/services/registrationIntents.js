const crypto = require('node:crypto');
const denied = () => Object.assign(new Error('La intención de registro no es válida.'), { status: 403 });
const tokenPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = token => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

function issue() {
  const registrationToken = crypto.randomBytes(32).toString('hex');
  return { registrationToken, registrationTokenHash: hash(registrationToken) };
}

// Shared by queries, confirmations, verification and the locked consumption transaction.
async function validate(client, { provider, reference, registrationToken }, { lock = false } = {}) {
  if (!['mercadopago','simulated'].includes(provider) || typeof reference !== 'string' ||
      !uuidPattern.test(reference) || typeof registrationToken !== 'string' || !tokenPattern.test(registrationToken)) throw denied();
  if (!client) throw Object.assign(new Error('El registro no está disponible temporalmente'), { status: 503 });
  const { rows: [intent] } = await client.query(`SELECT * FROM public.company_registration_payments
    WHERE provider=$1 AND reference=$2${lock ? ' FOR UPDATE' : ''}`, [provider, reference]);
  const expected = intent?.registration_token_hash;
  // Compare equal-size digests; neither raw token nor hash is returned to the browser.
  const matches = crypto.timingSafeEqual(Buffer.from(hash(registrationToken), 'hex'),
    Buffer.from(typeof expected === 'string' && tokenPattern.test(expected) ? expected : '0'.repeat(64), 'hex'));
  if (!intent || !matches) throw denied();
  if (intent.company_id || intent.consumed_at) throw Object.assign(
    new Error('Este pago ya fue utilizado para registrar una empresa'), { status: 409 });
  return intent;
}

module.exports = { issue, validate, denied };

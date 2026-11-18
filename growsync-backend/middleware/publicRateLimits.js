const { createHash } = require('node:crypto');
const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const MINUTE = 60_000;
const POLICIES = Object.freeze({
  loginIp: { limit: 50, windowMs: 15 * MINUTE },
  loginIdentity: { limit: 5, windowMs: 15 * MINUTE },
  register: { limit: 10, windowMs: 60 * MINUTE },
  invitation: { limit: 60, windowMs: 15 * MINUTE },
  companyRegister: { limit: 5, windowMs: 60 * MINUTE },
  paymentsRead: { limit: 120, windowMs: 5 * MINUTE },
  paymentsWrite: { limit: 10, windowMs: 15 * MINUTE },
  mercadoPagoRead: { limit: 120, windowMs: 5 * MINUTE },
  mercadoPagoWrite: { limit: 10, windowMs: 15 * MINUTE },
  adminInvitations: { limit: 10, windowMs: 60 * MINUTE },
});
const LIMITED_RESPONSE = Object.freeze({
  error: 'too_many_requests',
  message: 'Demasiados intentos. Intentá nuevamente más tarde.',
});

function loginKey(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  // Never retain the email, password, tokens or the rest of the body in the key.
  const identity = createHash('sha256').update(email).digest('hex');
  return `${ipKeyGenerator(req.ip)}:${identity}`;
}

// Each factory owns independent stores. Overrides allow deterministic threshold tests.
function createPublicRateLimits({ policies = {}, storeFactory } = {}) {
  const limits = Object.fromEntries(Object.entries(POLICIES).map(([name, defaults]) => {
    const policy = { ...defaults, ...policies[name] };
    return [name, rateLimit({
      ...policy,
      ...(storeFactory ? { store: storeFactory(name) } : {}),
      ...(name === 'loginIdentity' ? { keyGenerator: loginKey } : {}),
      legacyHeaders: false,
      standardHeaders: false,
      skip: req => req.method === 'OPTIONS',
      handler(req, res) {
        const reset = req.rateLimit?.resetTime?.getTime();
        const seconds = reset ? Math.ceil((reset - Date.now()) / 1000) : Math.ceil(policy.windowMs / 1000);
        res.set('Retry-After', String(Math.max(1, seconds)));
        res.set('Cache-Control', 'no-store');
        return res.status(429).json(LIMITED_RESPONSE);
      },
    })];
  }));
  const router = Router();
  router.post('/api/login', limits.loginIp, limits.loginIdentity);
  router.post('/api/register', limits.register);
  router.get('/api/invitations/:token', limits.invitation);
  router.post('/api/public/register-company', limits.companyRegister);
  router.use('/api/admin/company-invitations', limits.adminInvitations);
  // One shared bucket per provider/method group, not per guessable payment ID.
  const payments = Router();
  const selectPaymentLimit = (read, write) => (req, res, next) => (
    (req.method === 'GET' || req.method === 'HEAD' ? read : write)(req, res, next)
  );
  payments.use('/mercadopago', selectPaymentLimit(limits.mercadoPagoRead, limits.mercadoPagoWrite),
    (_req, _res, next) => next('router'));
  payments.use(selectPaymentLimit(limits.paymentsRead, limits.paymentsWrite));
  router.use('/api/public/payments', payments);
  return router;
}

module.exports = { createPublicRateLimits, POLICIES, LIMITED_RESPONSE, loginKey };

const { Router } = require('express');
const cors = require('cors');
const helmet = require('helmet');

function productionEnvironment(env) {
  return env.NODE_ENV === 'production' || env.RENDER === 'true';
}

function trustProxySetting(env) {
  // Explicit hop count only. Never trust arbitrary client-supplied forwarding chains.
  const value = env.TRUST_PROXY_HOPS || '0';
  if (env.RENDER === 'true' && value === '0') {
    throw new Error('Configurar TRUST_PROXY_HOPS con los saltos verificados de Render antes de iniciar');
  }
  if (!/^[0-5]$/.test(value)) throw new Error('TRUST_PROXY_HOPS debe ser un entero entre 0 y 5');
  return Number(value) || false;
}

function allowedOrigins(env) {
  const explicit = [env.FRONTEND_URL, ...(env.CORS_ALLOWED_ORIGINS || '').split(',')]
    .map(value => value?.trim()).filter(Boolean);
  for (const origin of explicit) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS requiere origins exactos http/https, sin rutas ni comodines');
    }
  }
  if (!productionEnvironment(env)) explicit.push('http://localhost:3000', 'http://localhost:5173');
  return [...new Set(explicit)];
}

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function configureHttpSecurity(app, env = process.env) {
  app.set('trust proxy', trustProxySetting(env));
  app.use(helmet({
    contentSecurityPolicy: false, // This API cannot set the CSP of Vercel's HTML.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // API used by a separate frontend origin.
    strictTransportSecurity: productionEnvironment(env) ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));
  const sensitive = Router();
  sensitive.use([
    '/api/login', '/api/register', '/api/invitations',
    '/api/admin/company-invitations', '/api/public/register-company',
    '/api/public/payments', '/api/users/invite',
  ], noStore);
  app.use(sensitive); // Includes validation, CORS, authentication and rate-limit errors.
  const origins = allowedOrigins(env);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      const error = new Error('Origen no permitido');
      error.status = 403;
      return callback(error);
    },
    credentials: true,
  }));
}

module.exports = { configureHttpSecurity, allowedOrigins, trustProxySetting };

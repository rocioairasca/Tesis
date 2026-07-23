// ---------------------------------------------------
// Core & Setup
// ---------------------------------------------------
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ---------------------------------------------------
// Conexión a la base de datos Supabase
// ---------------------------------------------------
const supabase = require('./db/supabaseClient');
(async () => {
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) {
    console.error("🔴 Error al conectar a Supabase:", error.message);
  } else {
    console.log("🟢 Conectado correctamente a Supabase");
  }
})();

// ---------------------------------------------------
// Middleware
// ---------------------------------------------------
const allowedOrigins = [
  "https://tesis-seven-phi.vercel.app",
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:5173",
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("No permitido por CORS: " + origin));
  },
  credentials: true,
}));

app.use(express.json());

// ---------------------------------------------------
// Rutas publicas (no usan token)
// ---------------------------------------------------
app.get('/', (_req, res) => res.send('GrowSync Backend funcionando'));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const publicRoutes = require('./routes/public.routes');
app.use('/api/public', publicRoutes);

const mercadoPagoRoutes = require('./routes/mercadoPagoRoutes');
console.log("MercadoPago router montado en /api/public/payments/mercadopago");
app.use('/api/public/payments/mercadopago', mercadoPagoRoutes);

// Auth publica (login/register)
const authRoutes = require('./routes/auth');
app.use('/api', authRoutes);

// ---------------------------------------------------
// Protección para rutas privadas
// ---------------------------------------------------
const checkJwt = require('./middleware/checkJwt');
const userData = require('./middleware/userData');
const requireTenant = require('./middleware/requireTenant');

const privateMiddlewares = [
  checkJwt,
  userData,
  requireTenant,
];

// ---------------------------------------------------
// Rutas privadas (requieren token y usuario cargado)
// ---------------------------------------------------
const userRoutes = require('./routes/userRoutes');
const lotRoutes = require('./routes/lot');
const productRoutes = require('./routes/products');
const usageRoutes = require('./routes/usage');
const statsRoutes = require('./routes/stats');
const weatherRoutes = require('./routes/weather');
const planningRoutes = require('./routes/planning');
const vehicleRoutes = require('./routes/vehicle');
const notificationsRoutes = require('./routes/notifications');
const harvestRecordsRoutes = require('./routes/harvestRecords');
const rainRecordsRoutes = require('./routes/rainRecords');

app.get(
  "/api/debug/me",
  ...privateMiddlewares,
  (req, res) => {
    res.json({
      message: "Usuario autenticado correctamente",
      user: req.user,
      tenant: req.tenant,
    });
  }
);

app.use('/api/users', ...privateMiddlewares, userRoutes);
app.use('/api/lots', ...privateMiddlewares, lotRoutes);
app.use('/api/products', ...privateMiddlewares, productRoutes);
app.use('/api/usages', ...privateMiddlewares, usageRoutes);
app.use('/api/stats', ...privateMiddlewares, statsRoutes);
app.use('/api/weather', ...privateMiddlewares, weatherRoutes);
app.use('/api/planning', ...privateMiddlewares, planningRoutes);
app.use('/api/vehicles', ...privateMiddlewares, vehicleRoutes);
app.use('/api/notifications', ...privateMiddlewares, notificationsRoutes);
app.use('/api/harvest-records', ...privateMiddlewares, harvestRecordsRoutes);
app.use('/api/rain-records', ...privateMiddlewares, rainRecordsRoutes);

// ---------------------------------------------------
// Manejo de errores
// ---------------------------------------------------
app.use((req, res, next) => {
  if (res.headersSent) return next();
  console.log("[404 Express]", req.method, req.originalUrl);
  return res.status(404).json({ error: 'Not Found' });
});

const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// ---------------------------------------------------
// Arranque del servidor
// ---------------------------------------------------
// Inicializar Cron Jobs
require('./cron/scheduler')();

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => console.log(`🔵 Servidor corriendo en el puerto ${PORT}`));

// Inicializar Socket.io
const socket = require('./socket');
socket.init(server);

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
app.use(cors({
  origin: ["http://localhost:3000"],
  credentials: true
}));
app.use(express.json());

// ---------------------------------------------------
// Rutas publicas (no usan token)
// ---------------------------------------------------
app.get('/', (_req, res) => res.send('GrowSync Backend funcionando'));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Auth publica (login/register)
const authRoutes = require('./routes/auth');
app.use('/api', authRoutes);

// ---------------------------------------------------
// Proteccion con token + carga d usuario/rol
// 1. checkJwt: valida Authorizarion: Bearer <access_token>
// 2. userData: busca en bd al user por sub/email y setea req.user = { id, email, role }
// ---------------------------------------------------
const checkJwt = require('./middleware/checkJwt');
const userData = require('./middleware/userData');

app.use(checkJwt);
app.use(userData);

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

app.use('/api/users', userRoutes);
app.use('/api/lots', lotRoutes);
app.use('/api/products', productRoutes);
app.use('/api/usages', usageRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/planning', planningRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/notifications', notificationsRoutes);

// ---------------------------------------------------
// Manejo de errores
// ---------------------------------------------------
app.use((req, res, next) => {
  if (res.headersSent) return next();
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

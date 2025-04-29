const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const pool = require('./db/connection');

// PERMITIR SOLICITUDES CORS
app.use(cors({
    origin: "http://localhost:3000",
    credentials: true
}));
app.use(express.json());

// ENDPOINT PARA TESTEAR SI EL SERVICIO ESTA EN LINEA
app.get("/", (req, res) => {
    res.send("GrowSync Backend funcionando");
});

// IMPORTAR MODULOS DE RUTAS
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/userRoutes");
const lotRoutes = require("./routes/lot");
const productRoutes = require('./routes/products');
const usageRoutes = require('./routes/usage');
const statsRoutes = require('./routes/stats');
const plantingRoutes = require('./routes/plantings');

// Uso de rutas públicas (register y login)
app.use('/api', authRoutes);

// Uso de rutas privadas con protección (getAllUsers, getUserByEmail y updateUserRole)
app.use('/api/users', userRoutes);
app.use('/api/lots', lotRoutes);
app.use('/api/products', productRoutes);
app.use('/api/usages', usageRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/plantings', plantingRoutes);

// ARRANQUE DEL SERVIDOR EN PUERTO (PORT=4000)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🔵 Servidor corriendo en el puerto ${PORT}`);
});

if (process.env.NODE_ENV === "development") {
    const consoleWarn = console.warn;
    console.warn = (...args) => {
      if (
        args[0].includes("-ms-high-contrast") ||
        args[0].includes("Tracking Prevention") ||
        args[0].includes("[antd]") 
      ) {
        return;
      }
      consoleWarn(...args);
    };
}
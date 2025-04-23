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

// Rutas públicas
app.use('/api', authRoutes);

// Rutas privadas con protección
app.use('/api/users', userRoutes);


const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🔵 Servidor corriendo en el puerto ${PORT}`);
});
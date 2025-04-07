const express = require('express');
const app = express();
require('dotenv').config();
const pool = require('./db/connection');

app.use(express.json());

app.get("/", (req, res) => {
    res.send("GrowSync Backenf funcionando");
});

//Ruta de prueba para ver si se conecta bien la BD
app.get("/users", async (req, res) => {
    try{
        const result = await pool.query("SELECT * FROM users");
        res.json(result.rows);
    }catch(err){
        console.error("Error al obtener los usuarios", err);
        res.status(500).json({ error: "Error al obtener los usuarios" });
    }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🔵 Servidor corriendo en el puerto ${PORT}`);
});
const express = require("express");
const router = express.Router();
const { fetchWeather, getLatestWeather } = require("../controllers/openWeatherMap");

// Ruta para actualizar el clima desde la API externa y guardarlo en BD
router.get("/update", fetchWeather);

// Ruta para obtener el último clima registrado en BD
router.get("/latest", getLatestWeather);

module.exports = router;

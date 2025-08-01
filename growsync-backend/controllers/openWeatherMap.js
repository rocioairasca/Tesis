require("dotenv").config();
const axios = require("axios");
const supabase = require("../db/supabaseClient");

const API_KEY = process.env.OPENWEATHER_API_KEY;
const UNITS = "metric";

const DEFAULT_LAT = -32.4075;
const DEFAULT_LON = -63.2436;

// Obtener clima actual y guardarlo en BD
const fetchWeather = async (req, res) => {
  try {
    // 1️⃣ Obtener coordenadas desde query o usar ciudad por defecto
    const { lat, lon } = req.query;

    // Usar coordenadas recibidas o las de Villa María por defecto
    const finalLat = lat || DEFAULT_LAT;
    const finalLon = lon || DEFAULT_LON;

    // Construir URL para OpenWeather con coordenadas finales
    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${finalLat}&lon=${finalLon}&units=${UNITS}&appid=${API_KEY}`;

    // 2️⃣ Llamar a OpenWeather
    const { data } = await axios.get(apiUrl);

    // 3️⃣ Procesar datos
    const weatherData = {
      temperature: data.main.temp,
      humidity: data.main.humidity,
      wind_speed: data.wind.speed,
      wind_direction: data.wind.deg?.toString() || null,
      rainfall: data.rain ? data.rain["1h"] : 0,
      date: new Date().toISOString().split("T")[0]
    };

    // 4️⃣ Guardar en BD
    const { error: insertError } = await supabase
      .from("weather")
      .insert([weatherData]);

    if (insertError) throw insertError;

    console.log("✅ Clima guardado:", weatherData);

    res.json(weatherData);
  } catch (error) {
    console.error("❌ Error al obtener clima:", error.message);
    res.status(500).json({ message: "Error al obtener clima", error: error.message });
  }
};

// Obtener último clima registrado
const getLatestWeather = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("weather")
      .select("*")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;

    res.json(data || {});
  } catch (error) {
    console.error("❌ Error al obtener último clima:", error.message);
    res.status(500).json({ message: "Error al obtener último clima", error: error.message });
  }
};

module.exports = { fetchWeather, getLatestWeather };

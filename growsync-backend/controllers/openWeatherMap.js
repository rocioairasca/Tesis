require("dotenv").config();
const axios = require("axios");
const supabase = require("../db/supabaseClient");

const API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_UNITS = "metric";
const DEFAULT_LANG  = 'es';
const DEFAULT_LAT = -32.4075;
const DEFAULT_LON = -63.2436;

// Fecha local en Córdoba (YYYY-MM-DD)
function localISODate(unixSeconds) {
  const timeZone = 'America/Argentina/Cordoba';
  const date = unixSeconds ? new Date(unixSeconds * 1000) : new Date();

  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Obtener clima actual (OpenWeather) y guardarlo en BD
const fetchWeather = async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: 'ConfigError', message: 'Falta OPENWEATHER_API_KEY' });
    }

    // Permitimos pasar params por query o body (POST)
    const src = { ...req.query, ...req.body };
    const units = src.units || DEFAULT_UNITS; // 'metric' | 'imperial' | 'standard'
    const lang  = src.lang  || DEFAULT_LANG;  // 'es', 'en', ...

    // Fuente: city o lat/lon (o defaults)
    const lat = src.lat != null ? Number(src.lat) : undefined;
    const lon = src.lon != null ? Number(src.lon) : undefined;
    const city = (src.city || '').trim();

    let apiUrl;
    if (city) {
      apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=${units}&lang=${lang}&appid=${API_KEY}`;
    } else {
      const finalLat = Number.isFinite(lat) ? lat : DEFAULT_LAT;
      const finalLon = Number.isFinite(lon) ? lon : DEFAULT_LON;
      apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${finalLat}&lon=${finalLon}&units=${units}&lang=${lang}&appid=${API_KEY}`;
    }

    const { data } = await axios.get(apiUrl, { timeout: 10000 });

    // Parse seguro
    const temp = Number(data?.main?.temp);
    const humidity = Number(data?.main?.humidity);
    const windSpeed = Number(data?.wind?.speed);
    const windDeg = Number(data?.wind?.deg);
    const rainfall = data?.rain?.['1h'] ?? data?.rain?.['3h'] ?? 0;
    const when = localISODate(data?.dt);

    const weatherRow = {
      temperature: Number.isFinite(temp) ? temp : null,
      humidity: Number.isFinite(humidity) ? humidity : null,
      wind_speed: Number.isFinite(windSpeed) ? windSpeed : null,
      wind_direction: Number.isFinite(windDeg) ? String(windDeg) : null,
      rainfall: Number(rainfall) || 0,
      date: when, // DATE en zona local
    };

    // Guardar en BD
    const { data: inserted, error: insertError } = await supabase
      .from('weather')
      .insert([weatherRow])
      .select()
      .single();

    if (insertError) {
      console.error('DB insert weather error:', insertError);
      return res.status(500).json({ error: 'DbError', message: 'No se pudo guardar el clima' });
    }

    return res.json(inserted);
  } catch (err) {
    const code = err.response?.status;
    const payload = err.response?.data;
    console.error('OpenWeather error:', { code, payload, msg: err.message });
    // 404 de OpenWeather si la ciudad no existe, etc.
    if (code === 404) {
      return res.status(404).json({ error: 'NotFound', message: 'Ubicación no encontrada en OpenWeather' });
    }
    if (code === 401) {
      return res.status(502).json({ error: 'AuthError', message: 'API key inválida para OpenWeather' });
    }
    return res.status(500).json({ error: 'FetchWeatherError', message: 'Error al obtener clima' });
  }
};

// Obtener ultimo clima registrado en BD
const getLatestWeather = async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('weather')
      .select('*')
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code === 'PGRST116') {
      return res.json({}); // sin registros
    }
    if (error) {
      console.error('DB get latest weather error:', error);
      return res.status(500).json({ error: 'DbError', message: 'No se pudo obtener el último clima' });
    }

    return res.json(data || {});
  } catch (err) {
    console.error('Unexpected latest weather error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al obtener último clima' });
  }
};

module.exports = { fetchWeather, getLatestWeather };

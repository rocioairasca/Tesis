require("dotenv").config();
const axios = require("axios");
const supabase = require("../db/supabaseClient");
const { weatherCache } = require("../services/weatherCache");

const OPEN_METEO_CURRENT_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
].join(",");

const OPEN_METEO_WEATHER_CODES = {
  0: { condition: "Despejado", icon: "sunny" },
  1: { condition: "Mayormente despejado", icon: "partly" },
  2: { condition: "Parcialmente nublado", icon: "partly" },
  3: { condition: "Nublado", icon: "cloud" },
  45: { condition: "Niebla", icon: "fog" },
  48: { condition: "Niebla con escarcha", icon: "fog" },
  51: { condition: "Llovizna leve", icon: "lightRain" },
  53: { condition: "Llovizna moderada", icon: "lightRain" },
  55: { condition: "Llovizna intensa", icon: "midRain" },
  56: { condition: "Llovizna helada leve", icon: "hail" },
  57: { condition: "Llovizna helada intensa", icon: "hail" },
  61: { condition: "Lluvia leve", icon: "lightRain" },
  63: { condition: "Lluvia moderada", icon: "midRain" },
  65: { condition: "Lluvia fuerte", icon: "heavyRain" },
  66: { condition: "Lluvia helada leve", icon: "hail" },
  67: { condition: "Lluvia helada intensa", icon: "hail" },
  71: { condition: "Nevada leve", icon: "snow" },
  73: { condition: "Nevada moderada", icon: "snow" },
  75: { condition: "Nevada fuerte", icon: "snow" },
  77: { condition: "Granizo de nieve", icon: "snow" },
  80: { condition: "Chaparrones leves", icon: "rain" },
  81: { condition: "Chaparrones moderados", icon: "midRain" },
  82: { condition: "Chaparrones fuertes", icon: "heavyRain" },
  85: { condition: "Chaparrones de nieve leves", icon: "snow" },
  86: { condition: "Chaparrones de nieve fuertes", icon: "snow" },
  95: { condition: "Tormenta", icon: "storm" },
  96: { condition: "Tormenta con granizo leve", icon: "stormRain" },
  99: { condition: "Tormenta con granizo fuerte", icon: "stormRain" },
};

// Fecha local en Cordoba (YYYY-MM-DD)
function localISODate(unixSeconds) {
  const timeZone = "America/Argentina/Cordoba";
  const date = unixSeconds != null ? new Date(unixSeconds * 1000) : new Date();

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getWeatherPresentation(weatherCode) {
  return OPEN_METEO_WEATHER_CODES[weatherCode] || {
    condition: "Condicion desconocida",
    icon: "alert",
  };
}

// Obtener clima actual (Open-Meteo) y guardarlo en BD
const fetchWeather = async (req, res) => {
  try {
    // Permitimos pasar params por query o body (POST)
    const src = { ...req.query, ...req.body };
    const numeric = value => !['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const lat = numeric(src.latitude ?? src.lat);
    const lon = numeric(src.longitude ?? src.lon);

    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({
        error: "LocationRequired",
        message: "Se requieren latitude y longitude para obtener el clima actual",
      });
    }

    const result = await weatherCache.getOrLoad(lat, lon, async () => {
      const { data } = await axios.get("https://api.open-meteo.com/v1/forecast", {
        params: {
          latitude: lat,
          longitude: lon,
          current: OPEN_METEO_CURRENT_FIELDS,
          timezone: "auto",
          timeformat: "unixtime",
        },
        timeout: 10000,
      });

      const current = data?.current || {};
      const temp = numeric(current.temperature_2m);
      const humidity = numeric(current.relative_humidity_2m);
      const windSpeed = numeric(current.wind_speed_10m);
      const windDeg = numeric(current.wind_direction_10m);
      const weatherCode = numeric(current.weather_code);
      const observedSeconds = numeric(current.time);
      if ([temp, humidity, windSpeed, windDeg, observedSeconds].some(value => value == null) ||
          humidity < 0 || humidity > 100 || windSpeed < 0 || windDeg < 0 || windDeg > 360 ||
          !Number.isFinite(new Date(observedSeconds * 1000).getTime())) {
        throw Object.assign(new Error('Open-Meteo devolvió una lectura incompleta'), { status: 502, code: 'IncompleteWeather' });
      }
      const observedAt = new Date(observedSeconds * 1000).toISOString();
      const when = localISODate(observedSeconds);
      const presentation = getWeatherPresentation(weatherCode);

      const weatherRow = {
        temperature: Number.isFinite(temp) ? temp : null,
        humidity: Number.isFinite(humidity) ? humidity : null,
        wind_speed: Number.isFinite(windSpeed) ? windSpeed : null,
        wind_direction: Number.isFinite(windDeg) ? String(windDeg) : null,
        rainfall: 0,
        date: when,
      };

      const { data: inserted, error: insertError } = await supabase
        .from("weather")
        .insert([weatherRow])
        .select()
        .single();

      if (insertError) {
        throw Object.assign(new Error("No se pudo guardar el clima"), { status: 500, code: "DbError" });
      }

      return {
        ...(inserted?.id != null ? { id: inserted.id } : {}),
        ...(inserted?.created_at != null ? { created_at: inserted.created_at } : {}),
        ...(inserted?.updated_at != null ? { updated_at: inserted.updated_at } : {}),
        ...weatherRow,
        source: "open-meteo",
        latitude: lat,
        longitude: lon,
        weather_code: Number.isFinite(weatherCode) ? weatherCode : null,
        condition: presentation.condition,
        icon: presentation.icon,
        observed_at: observedAt,
        current_units: data?.current_units || {},
      };
    });
    return res.json(result);
  } catch (err) {
    if (err.code === 'WeatherRateLimited') {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
      return res.status(429).json({
        error: 'WeatherRateLimited',
        message: err.message,
        retry_after_seconds: err.retryAfterSeconds,
      });
    }
    if (['IncompleteWeather', 'DbError'].includes(err.code)) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    // Provider payloads/URLs can contain exact coordinates. Log only the status.
    console.error('Weather request failed', { status: err.response?.status || null });
    return res.status(502).json({
      error: "FetchWeatherError",
      message: "Error al obtener clima en Open-Meteo",
    });
  }
};

// Obtener ultimo clima registrado en BD
const getLatestWeather = async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("weather")
      .select("*")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code === "PGRST116") {
      return res.json({});
    }
    if (error) {
      console.error("DB get latest weather error:", error);
      return res.status(500).json({ error: "DbError", message: "No se pudo obtener el ultimo clima" });
    }

    return res.json(data || {});
  } catch (err) {
    console.error("Unexpected latest weather error:", err);
    return res.status(500).json({ error: "InternalServerError", message: "Error al obtener ultimo clima" });
  }
};

module.exports = { fetchWeather, getLatestWeather };

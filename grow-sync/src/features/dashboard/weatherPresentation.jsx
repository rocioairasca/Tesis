import React from "react";
import { AppIcons } from '../../components/AppIcons';
export function degToCompass(deg) {
  if (deg == null) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
  const ix = Math.round(((deg % 360) / 22.5)) % 16;
  return dirs[ix];
}

const weatherIcons = {
  sunny: AppIcons.sun,
  clearNight: AppIcons.moon,
  cloud: AppIcons.cloud,
  cloudNight: AppIcons.cloudNight,
  partly: AppIcons.partlyCloudy,
  partlyNight: AppIcons.cloudNight,
  lightRain: AppIcons.rain,
  midRain: AppIcons.rain,
  heavyRain: AppIcons.rain,
  rain: AppIcons.rain,
  rainNight: AppIcons.rain,
  storm: AppIcons.storm,
  stormRain: AppIcons.storm,
  stormNight: AppIcons.storm,
  wind: AppIcons.wind,
  windNight: AppIcons.wind,
  snow: AppIcons.snow,
  snowNight: AppIcons.snow,
  hail: AppIcons.snow,
  hailNight: AppIcons.snow,
  fog: AppIcons.fog,
  tornado: AppIcons.tornado,
  hot: AppIcons.temperature,
  cold: AppIcons.temperature,
  uv: AppIcons.sun,
  temperature: AppIcons.temperature,
  alert: AppIcons.alert,
};

const openMeteoWeatherCodes = {
  0: { kind: "sunny", label: "Despejado" },
  1: { kind: "partly", label: "Mayormente despejado" },
  2: { kind: "partly", label: "Parcialmente nublado" },
  3: { kind: "cloud", label: "Nublado" },
  45: { kind: "fog", label: "Niebla" },
  48: { kind: "fog", label: "Niebla con escarcha" },
  51: { kind: "lightRain", label: "Llovizna leve" },
  53: { kind: "lightRain", label: "Llovizna moderada" },
  55: { kind: "midRain", label: "Llovizna intensa" },
  56: { kind: "hail", label: "Llovizna helada leve" },
  57: { kind: "hail", label: "Llovizna helada intensa" },
  61: { kind: "lightRain", label: "Lluvia leve" },
  63: { kind: "midRain", label: "Lluvia moderada" },
  65: { kind: "heavyRain", label: "Lluvia fuerte" },
  66: { kind: "hail", label: "Lluvia helada leve" },
  67: { kind: "hail", label: "Lluvia helada intensa" },
  71: { kind: "snow", label: "Nevada leve" },
  73: { kind: "snow", label: "Nevada moderada" },
  75: { kind: "snow", label: "Nevada fuerte" },
  77: { kind: "snow", label: "Granizo de nieve" },
  80: { kind: "rain", label: "Chaparrones leves" },
  81: { kind: "midRain", label: "Chaparrones moderados" },
  82: { kind: "heavyRain", label: "Chaparrones fuertes" },
  85: { kind: "snow", label: "Chaparrones de nieve leves" },
  86: { kind: "snow", label: "Chaparrones de nieve fuertes" },
  95: { kind: "storm", label: "Tormenta" },
  96: { kind: "stormRain", label: "Tormenta con granizo leve" },
  99: { kind: "stormRain", label: "Tormenta con granizo fuerte" },
};

function withNightIcon(kind, night) {
  if (!night) return kind;
  return ({
    sunny: "clearNight",
    cloud: "cloudNight",
    partly: "partlyNight",
    rain: "rainNight",
    storm: "stormNight",
    snow: "snowNight",
    hail: "hailNight",
    wind: "windNight",
  })[kind] || kind;
}

function valueFrom(d, keys, fallback = null) {
  for (const key of keys) {
    const v = key.split(".").reduce((acc, part) => acc?.[part], d);
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function textFrom(d, keys) {
  for (const key of keys) {
    const v = key.split(".").reduce((acc, part) => acc?.[part], d);
    if (v != null && String(v).trim()) return String(v).toLowerCase();
  }
  return "";
}

function isNightWeather(d) {
  if (typeof d?.is_day === "boolean") return !d.is_day;
  if (d?.is_day === 0 || d?.isDay === 0) return true;
  if (d?.is_day === 1 || d?.isDay === 1) return false;

  const icon = textFrom(d, ["icon", "weather_icon", "weather.0.icon"]);
  if (icon.endsWith("n")) return true;
  if (icon.endsWith("d")) return false;

  const now = valueFrom(d, ["dt", "timestamp"], null);
  const sunrise = valueFrom(d, ["sunrise", "sys.sunrise"], null);
  const sunset = valueFrom(d, ["sunset", "sys.sunset"], null);
  return now != null && sunrise != null && sunset != null ? now < sunrise || now > sunset : false;
}

// ---- Regla simple para elegir icono + label (ES) ----
export function getWeatherPresentation(d) {
  if (!d) return { kind: "alert", label: "Sin datos" };

  const t = valueFrom(d, ["temperature", "temp", "main.temp"], null);
  const h = valueFrom(d, ["humidity", "main.humidity"], 0);
  const r = valueFrom(d, ["rainfall", "rain", "precipitation", "rain.1h", "rain.3h"], 0);
  const snow = valueFrom(d, ["snowfall", "snow", "snow.1h", "snow.3h"], 0);
  const wind = valueFrom(d, ["wind_speed", "windSpeed", "wind.speed"], 0);
  const gust = valueFrom(d, ["wind_gust", "windGust", "wind.gust"], 0);
  const clouds = valueFrom(d, ["cloud_cover", "cloudCover", "clouds", "clouds.all"], null);
  const uv = valueFrom(d, ["uv_index", "uvIndex", "uvi"], null);
  const visibility = valueFrom(d, ["visibility"], null);
  const code = valueFrom(d, ["weather_code", "weatherCode", "weather.0.id"], null);
  const text = textFrom(d, ["condition", "weather", "main", "description", "weather.0.main", "weather.0.description"]);
  const night = isNightWeather(d);
  const openMeteoMatch = openMeteoWeatherCodes[code];

  if (openMeteoMatch) {
    return {
      kind: withNightIcon(openMeteoMatch.kind, night),
      label: openMeteoMatch.label,
    };
  }

  if (code >= 200 && code < 300) return { kind: night ? "stormNight" : r > 0 ? "stormRain" : "storm", label: "Tormenta" };
  if (code >= 300 && code < 400) return { kind: "lightRain", label: "Llovizna" };
  if (code >= 500 && code < 600) {
    if (code >= 502 || r >= 8) return { kind: "heavyRain", label: "Lluvia fuerte" };
    if (code === 501 || r >= 2) return { kind: "midRain", label: "Lluvia moderada" };
    return { kind: night ? "rainNight" : "lightRain", label: "Lluvia leve" };
  }
  if (code >= 600 && code < 700) return { kind: night ? "snowNight" : "snow", label: "Nieve" };
  if (code >= 700 && code < 800) return { kind: "fog", label: "Neblina" };
  if (code === 800) return { kind: night ? "clearNight" : "sunny", label: night ? "Despejado" : "Soleado" };
  if (code > 800 && code < 900) return { kind: night ? "cloudNight" : clouds >= 75 ? "cloud" : "partly", label: clouds >= 75 ? "Nublado" : "Parcialmente nublado" };

  if (text.includes("tornado")) return { kind: "tornado", label: "Tornado" };
  if (text.includes("thunder") || text.includes("storm") || text.includes("tormenta")) return { kind: night ? "stormNight" : r > 0 ? "stormRain" : "storm", label: "Tormenta" };
  if (text.includes("hail") || text.includes("granizo")) return { kind: night ? "hailNight" : "hail", label: "Granizo" };
  if (text.includes("snow") || text.includes("sleet") || text.includes("nieve")) return { kind: night ? "snowNight" : "snow", label: "Nieve" };
  if (text.includes("drizzle") || text.includes("llovizna")) return { kind: "lightRain", label: "Llovizna" };
  if (text.includes("rain") || text.includes("lluvia")) return { kind: night ? "rainNight" : "rain", label: "Lluvioso" };
  if (text.includes("fog") || text.includes("mist") || text.includes("haze") || text.includes("smoke") || text.includes("dust") || text.includes("niebla") || text.includes("neblina")) return { kind: "fog", label: "Neblina" };
  if (text.includes("clear") || text.includes("despejado")) return { kind: night ? "clearNight" : "sunny", label: night ? "Despejado" : "Soleado" };
  if (text.includes("cloud") || text.includes("nube") || text.includes("nublado")) return { kind: night ? "cloudNight" : "cloud", label: "Nublado" };

  if (snow > 0) return { kind: night ? "snowNight" : "snow", label: "Nieve" };
  if (r >= 8) return { kind: "heavyRain", label: "Lluvia fuerte" };
  if (r >= 2) return { kind: "midRain", label: "Lluvia moderada" };
  if (r > 0.2) return { kind: night ? "rainNight" : "lightRain", label: "Lluvia leve" };
  if (gust >= 45 || wind >= 35) return { kind: night ? "windNight" : "wind", label: "Viento fuerte" };
  if (visibility != null && visibility < 2000) return { kind: "fog", label: "Baja visibilidad" };
  if (uv != null && uv >= 8) return { kind: "uv", label: "UV alto" };
  if (t != null && t >= 34) return { kind: "hot", label: "Caluroso" };
  if (t != null && t <= 5) return { kind: "cold", label: "Frio" };
  if (clouds != null && clouds >= 75) return { kind: night ? "cloudNight" : "cloud", label: "Nublado" };
  if (clouds != null && clouds >= 25) return { kind: night ? "partlyNight" : "partly", label: "Parcialmente nublado" };
  if (h >= 80) return { kind: "cloud", label: "Nublado" };
  if (t >= 26 && h < 70) return { kind: "sunny", label: "Soleado" };
  if (wind >= 25 && h < 75) return { kind: night ? "windNight" : "wind", label: "Ventoso" };
  return { kind: night ? "partlyNight" : "partly", label: "Parcialmente nublado" };
}

export function WeatherIcon({ kind, size = 56 }) {
  const Icon = weatherIcons[kind] || AppIcons.partlyCloudy;
  return <Icon size={size} />;
}

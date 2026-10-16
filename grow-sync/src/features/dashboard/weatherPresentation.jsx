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

  const code = valueFrom(d, ['weather_code', 'weatherCode'], null);
  const match = openMeteoWeatherCodes[code];
  return match ? { kind: withNightIcon(match.kind, isNightWeather(d)), label: match.label }
    : { kind: 'temperature', label: 'Condición no informada' };
}

export function WeatherIcon({ kind, size = 56 }) {
  const Icon = weatherIcons[kind] || AppIcons.partlyCloudy;
  return <Icon size={size} />;
}

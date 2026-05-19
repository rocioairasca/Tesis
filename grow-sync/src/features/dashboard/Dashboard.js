import React, { useEffect, useState, useMemo } from "react";
import { Card, Row, Col, Statistic, Progress, Space, Tag, Typography, Tooltip } from "antd";
import {
  UserOutlined,
  InboxOutlined,
  FileTextOutlined,
  EnvironmentOutlined,
  CloudOutlined,
  ArrowUpOutlined,
} from '../../components/AppIcons';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CloudAngledRainIcon,
  CloudAngledRainZapIcon,
  CloudAngledZapIcon,
  CloudBigRainIcon,
  CloudFastWindIcon,
  CloudHailstoneIcon,
  CloudIcon,
  CloudLittleRainIcon,
  CloudMidRainIcon,
  CloudSnowIcon,
  EyeIcon,
  Moon02Icon,
  MoonCloudAngledRainIcon,
  MoonCloudAngledZapIcon,
  MoonCloudFastWindIcon,
  MoonCloudHailstoneIcon,
  MoonCloudIcon,
  MoonCloudSnowIcon,
  Sun03Icon,
  SunCloud02Icon,
  TemperatureIcon,
  ThermometerColdIcon,
  ThermometerWarmIcon,
  Tornado01Icon,
  Uv01Icon,
} from "@hugeicons/core-free-icons";
import api from "../../services/apiClient";

const { Text, Title } = Typography;

// -------- helpers (inline) --------
function toNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function degToCompass(deg) {
  if (deg == null) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
  const ix = Math.round(((deg % 360) / 22.5)) % 16;
  return dirs[ix];
}

const weatherIcons = {
  sunny: Sun03Icon,
  clearNight: Moon02Icon,
  cloud: CloudIcon,
  cloudNight: MoonCloudIcon,
  partly: SunCloud02Icon,
  partlyNight: MoonCloudIcon,
  lightRain: CloudLittleRainIcon,
  midRain: CloudMidRainIcon,
  heavyRain: CloudBigRainIcon,
  rain: CloudAngledRainIcon,
  rainNight: MoonCloudAngledRainIcon,
  storm: CloudAngledZapIcon,
  stormRain: CloudAngledRainZapIcon,
  stormNight: MoonCloudAngledZapIcon,
  wind: CloudFastWindIcon,
  windNight: MoonCloudFastWindIcon,
  snow: CloudSnowIcon,
  snowNight: MoonCloudSnowIcon,
  hail: CloudHailstoneIcon,
  hailNight: MoonCloudHailstoneIcon,
  fog: EyeIcon,
  tornado: Tornado01Icon,
  hot: ThermometerWarmIcon,
  cold: ThermometerColdIcon,
  uv: Uv01Icon,
  temperature: TemperatureIcon,
  alert: AlertCircleIcon,
};

function valueFrom(d, keys, fallback = null) {
  for (const key of keys) {
    const v = key.split(".").reduce((acc, part) => acc?.[part], d);
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
function getWeatherPresentation(d) {
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
  const code = valueFrom(d, ["weather_code", "weatherCode", "weather.0.id", "id"], null);
  const text = textFrom(d, ["condition", "weather", "main", "description", "weather.0.main", "weather.0.description"]);
  const night = isNightWeather(d);

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

function WeatherIcon({ kind, size = 56 }) {
  return (
    <HugeiconsIcon
      icon={weatherIcons[kind] || SunCloud02Icon}
      size={size}
      strokeWidth={1.8}
    />
  );
}

const Dashboard = () => {
  const [stats, setStats] = useState({ users: 0, products: 0, lots: 0, usages: 0 });
  const [weather, setWeather] = useState(null);

  // valores “seguros” para mostrar en UI
  const temp = useMemo(() => {
    const v = weather?.temperature;
    return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : null;
  }, [weather]);
  const humidity = useMemo(() => Math.max(0, Math.min(100, toNumber(weather?.humidity, 0))), [weather]);
  const windSpeed = useMemo(() => {
    const v = toNumber(weather?.wind_speed, null);
    return v == null ? null : v.toFixed(2);
  }, [weather]);
  const windDir = useMemo(() => toNumber(weather?.wind_direction, null), [weather]);
  const rainfall = useMemo(() => toNumber(weather?.rainfall, 0), [weather]);
  const updatedAt = weather?.updated_at || weather?.updatedAt || null;
  const weatherView = useMemo(() => getWeatherPresentation(weather), [weather]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data } = await api.get("/stats", {
          params: { includeDisabled: 1, includeCanceled: 1 } // opcional
        });

        // data = { meta: {...}, kpis: { users, products, lots, usages, planning: {...} } }
        const kpis = data?.kpis || {};

        setStats({
          users: kpis.users ?? 0,
          products: kpis.products ?? 0,
          lots: kpis.lots ?? 0,
          usages: kpis.usages ?? 0,
        });

      } catch (error) {
        console.error(
          "Error al cargar estadísticas:",
          `status=${error?.response?.status ?? "?"}`,
          error?.response?.data || error
        );
      }
    };

    const fetchWeatherFallback = async () => {
      try {
        const { data } = await api.get("/weather/latest"); 
        setWeather(data || null);
      } catch (error) {
        console.error(
          "Error al cargar clima (fallback):",
          `status=${error?.response?.status ?? "?"}`,
          error?.response?.data || error
        );
        setWeather(null);
      }
    };

    const fetchWeatherWithLocation = () => {
      if (!("geolocation" in navigator)) {
        fetchWeatherFallback();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async ({ coords: { latitude: lat, longitude: lon } }) => {
          try {
            const { data } = await api.post("/weather/update", {}, { params: { lat, lon } });
            setWeather(data || null);
          } catch (error) {
            console.error(
              "Error al obtener clima con ubicación:",
              `status=${error?.response?.status ?? "?"}`,
              error?.response?.data || error
            );
            fetchWeatherFallback();
          }
        },
        (err) => {
          console.error("Geo error:", err);
          fetchWeatherFallback();
        }
      );
    };

    fetchStats();
    fetchWeatherWithLocation();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="Usuarios Registrados" value={stats.users} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="Productos en Inventario" value={stats.products} prefix={<InboxOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="Lotes Registrados" value={stats.lots} prefix={<EnvironmentOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="Registros de Uso" value={stats.usages} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
      </Row>

      {/* CLIMA - tarjeta con mejor visual */}
      <Card
        style={{ marginTop: 24, borderRadius: 12, background: "linear-gradient(160deg, #f6ffed 0%, #ffffff 35%, #e6f4ff 100%)" }}
        styles={{ body: { padding: 16 } }}
        title={
          <Space>
            <CloudOutlined />
            <span>Clima Actual</span>
          </Space>
        }
        extra={updatedAt ? <Tag color="default">Actualizado: {new Date(updatedAt).toLocaleString()}</Tag> : null}
      >
        <Row gutter={[16, 16]} align="middle">
          {/* IZQ: Temp + Viento + Lluvia */}
          <Col xs={24} md={9}>
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Title level={1} style={{ margin: 0, lineHeight: 1 }}>
                {temp != null ? `${temp}°C` : "—"}
              </Title>

              <Space size={8} wrap>
                <Text strong>Viento:</Text>
                <Text>
                  {windSpeed != null ? `${windSpeed} km/h` : "—"}
                  {windDir != null && (
                    <Tooltip title={`${degToCompass(windDir)} (${windDir}°)`}>
                      <ArrowUpOutlined
                        style={{ marginLeft: 6, fontSize: 18, transform: `rotate(${windDir}deg)` }}
                      />
                    </Tooltip>
                  )}
                  {windDir != null && (
                    <Text type="secondary" style={{ marginLeft: 6 }}>
                      {degToCompass(windDir)}
                    </Text>
                  )}
                </Text>
              </Space>

              <Space size={8} wrap>
                <Text strong>Lluvia:</Text>
                <Text>{`${rainfall} mm`}</Text>
              </Space>
            </Space>
          </Col>

          {/* CENTRO: Humedad aparte y centrada */}
          <Col xs={12} md={6} style={{ textAlign: "center" }}>
            <Progress type="dashboard" percent={humidity} size={110} />
            <Text type="secondary" style={{ display: "block", marginTop: 6 }}>
              Humedad
            </Text>
          </Col>

          {/* DERECHA: Icono + texto debajo, pegados a la derecha */}
          <Col
            xs={12}
            md={9}
            style={{ display: "flex", justifyContent: "flex-end" }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <WeatherIcon kind={weatherView.kind} size={75} />
              <Text type="secondary" style={{ marginTop: 6 }}>
                {weatherView.label}
              </Text>
            </div>
          </Col>
        </Row>

      </Card>
    </div>
  );
};

export default Dashboard;



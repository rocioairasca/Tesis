import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Alert, Card, Row, Col, Statistic, Progress, Space, Tag, Typography, Tooltip, Select, Button } from "antd";
import { useNavigate } from "react-router-dom";
import {
  UserOutlined,
  InboxOutlined,
  FileTextOutlined,
  EnvironmentOutlined,
  CloudOutlined,
  ArrowUpOutlined,
  CalendarOutlined,
  AlertOutlined,
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
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";
import { getUserFriendlyError } from "../../utils/userFriendlyErrors";

import {
  getHarvestFilters,
  getHarvestSummary,
  getHarvestByCrop,
  getHarvestByCampaign,
} from '../../services/harvestService';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";


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

function WeatherIcon({ kind, size = 56 }) {
  return (
    <HugeiconsIcon
      icon={weatherIcons[kind] || SunCloud02Icon}
      size={size}
      strokeWidth={1.8}
    />
  );
}

const chartColors = {
  primary: "#437118",
  primaryDark: "#36590f",
  secondary: "#1D2A62",
  accent: "#87AECE",
  grid: "#d9d9d9",
  text: "#595959",
  background: "#edf4e4",
};

const cropColors = [
  "#437118", // verde principal
  "#1D2A62", // azul sidebar
  "#87AECE", // azul claro
  "#6b8e23", // oliva
  "#4f6fad", // azul medio
  "#5b8c00", // verde intenso
];

const harvestUnitOptions = [
  { value: "kg", label: "Kilogramos", suffix: "kg", yieldSuffix: "kg/ha" },
  { value: "tn", label: "Toneladas", suffix: "tn", yieldSuffix: "tn/ha" },
  { value: "qq", label: "Quintales", suffix: "qq", yieldSuffix: "qq/ha" },
];

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    products: 0,
    lots: 0,
    usages: 0,
    planningActive: 0,
    planningDelayed: 0,
    planningCompleted: 0,
  });
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState({
    location: "idle",
    weather: "idle",
    locationError: null,
    weatherError: null,
    usingFallback: false,
  });

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
  const isLoadingLocation = weatherStatus.location === "loading";
  const isLoadingWeather = weatherStatus.weather === "loading";

  const [harvestSummary, setHarvestSummary] = useState(null);
  const [harvestByCrop, setHarvestByCrop] = useState([]);
  const [harvestByCampaign, setHarvestByCampaign] = useState([]);

  const [harvestFilters, setHarvestFilters] = useState({
    campaigns: [],
    crops: [],
  });

  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedCrop, setSelectedCrop] = useState(null);
  const [selectedHarvestUnit, setSelectedHarvestUnit] = useState("kg");
  const selectedHarvestUnitMeta = useMemo(
    () => harvestUnitOptions.find((option) => option.value === selectedHarvestUnit) || harvestUnitOptions[0],
    [selectedHarvestUnit]
  );

  const user = JSON.parse(localStorage.getItem("user") || "null");
  const canViewHarvestStats = Number(user?.role) >=1;
  const canViewRainRecords = hasPermission(user, PERMISSIONS.RAIN_RECORDS_VIEW);

  const fetchHarvestStats = useCallback(async (filters = {}) => {
    if (!canViewHarvestStats) return;

    try {
      const unit = filters.unit || selectedHarvestUnit;
      const [summary, byCrop, byCampaign] = await Promise.all([
        getHarvestSummary({ ...filters, unit }),
        getHarvestByCrop({ campaign: filters.campaign || undefined, unit }),
        getHarvestByCampaign({ crop: filters.crop || undefined, unit }),
      ]);

      setHarvestSummary(summary || null);

      setHarvestByCrop(
        (byCrop || []).map((item) => ({
          ...item,
          production_kg: Number(item.production_kg || 0),
          area_ha: Number(item.area_ha || 0),
          yield_kg_ha: Number(item.yield_kg_ha || 0),
        }))
      );

      setHarvestByCampaign(
        (byCampaign || []).map((item) => ({
          ...item,
          production_kg: Number(item.production_kg || 0),
          area_ha: Number(item.area_ha || 0),
          yield_kg_ha: Number(item.yield_kg_ha || 0),
        }))
      );
    } catch (error) {
      console.error(
        "Error al cargar estadísticas de cosecha:",
        error?.response?.data || error
      );
    }
  }, [canViewHarvestStats, selectedHarvestUnit]);

  const handleHarvestUnitChange = (unit) => {
    setSelectedHarvestUnit(unit);
    fetchHarvestStats({
      campaign: selectedCampaign,
      crop: selectedCrop,
      unit,
    });
  };

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data } = await api.get("/stats", {
          params: { includeDisabled: 1, includeCanceled: 1 } // opcional
        });

        // data = { meta: {...}, kpis: { users, products, lots, usages, planning: {...} } }
        const kpis = data?.kpis || {};

        setStats({
          products: kpis.products ?? 0,
          lots: kpis.lots ?? 0,
          usages: kpis.usages ?? 0,
          planningActive: kpis.planning?.active ?? 0,
          planningDelayed: kpis.planning?.delayed ?? 0,
          planningCompleted: kpis.planning?.completed ?? 0,
        });

      } catch (error) {
        console.error(
          "Error al cargar estadísticas:",
          `status=${error?.response?.status ?? "?"}`,
          error?.response?.data || error
        );
      }
    };

    const fetchHarvestFiltersData = async () => {
      if (!canViewHarvestStats) return;

      try {
        const data = await getHarvestFilters();

        setHarvestFilters({
          campaigns: data?.campaigns || [],
          crops: data?.crops || [],
        });
      } catch (error) {
        console.error("Error filtros cosecha:", error?.response?.data || error);
      }
    };

    const updateWeatherStatus = (patch) => {
      setWeatherStatus((current) => ({ ...current, ...patch }));
    };

    const fetchWeatherFallback = async () => {
      updateWeatherStatus({ weather: "loading", usingFallback: true });
      try {
        const { data } = await api.get("/weather/latest"); 
        setWeather(data || null);
        updateWeatherStatus({ weather: "success" });
      } catch (error) {
        console.error(
          "Error al cargar clima (fallback):",
          `status=${error?.response?.status ?? "?"}`,
          error?.response?.data || error
        );
        setWeather(null);
        updateWeatherStatus({
          weather: "error",
          weatherError: "No se pudo obtener el clima actual ni el ultimo registro guardado.",
        });
      }
    };

    const fetchWeatherWithLocation = () => {
      if (!("geolocation" in navigator)) {
        updateWeatherStatus({
          location: "error",
          locationError: "Tu navegador no permite obtener la ubicacion actual.",
        });
        fetchWeatherFallback();
        return;
      }
      updateWeatherStatus({
        location: "loading",
        weather: "idle",
        locationError: null,
        weatherError: null,
        usingFallback: false,
      });
      navigator.geolocation.getCurrentPosition(
        async ({ coords: { latitude, longitude } }) => {
          updateWeatherStatus({ location: "success", weather: "loading" });
          try {
            const { data } = await api.post("/weather/update", {}, { params: { latitude, longitude } });
            setWeather(data || null);
            updateWeatherStatus({ weather: "success" });
          } catch (error) {
            console.error(
              "Error al obtener clima con ubicación:",
              `status=${error?.response?.status ?? "?"}`,
              error?.response?.data || error
            );
            updateWeatherStatus({
              weather: "error",
              weatherError: getUserFriendlyError(error, "No se pudo obtener el clima actual."),
            });
            fetchWeatherFallback();
          }
        },
        (err) => {
          if (import.meta.env.DEV) {
            console.warn("No se pudo obtener la ubicación del navegador:", err?.message || err);
          }
          updateWeatherStatus({
            location: "error",
            locationError: err?.code === 1
              ? "Permiso de ubicacion denegado. Se muestra el ultimo clima guardado."
              : "No se pudo obtener tu ubicacion actual. Se muestra el ultimo clima guardado.",
          });
          fetchWeatherFallback();
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    };

    fetchStats();
    fetchWeatherWithLocation();
    fetchHarvestStats({ unit: selectedHarvestUnit });
    fetchHarvestFiltersData();
  }, [canViewHarvestStats]);

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card>
            <Statistic title="Productos activos" value={stats.products} prefix={<InboxOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card>
            <Statistic title="Lotes activos" value={stats.lots} prefix={<EnvironmentOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card>
            <Statistic title="Registros de uso" value={stats.usages} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card>
            <Statistic title="Planificaciones activas" value={stats.planningActive} prefix={<CalendarOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card>
            <Statistic title="Planificaciones demoradas" value={stats.planningDelayed} prefix={<AlertOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card>
            <Statistic title="Planificaciones completadas" value={stats.planningCompleted} prefix={<UserOutlined />} />
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
        extra={
          <Space wrap>
            {updatedAt ? <Tag color="default">Actualizado: {new Date(updatedAt).toLocaleString()}</Tag> : null}
            {canViewRainRecords && (
              <Button size="small" onClick={() => navigate("/registro-lluvias")}>
                Registro de lluvias
              </Button>
            )}
          </Space>
        }
      >
        <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 12 }}>
          {isLoadingLocation && (
            <Alert type="info" showIcon message="Obteniendo ubicacion actual..." />
          )}
          {isLoadingWeather && (
            <Alert type="info" showIcon message="Cargando clima actual..." />
          )}
          {weatherStatus.locationError && (
            <Alert type="warning" showIcon message={weatherStatus.locationError} />
          )}
          {weatherStatus.weatherError && (
            <Alert type={weather ? "warning" : "error"} showIcon message={weatherStatus.weatherError} />
          )}
          {weatherStatus.usingFallback && weather && (
            <Alert type="info" showIcon message="Mostrando el ultimo clima guardado." />
          )}
        </Space>

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

      {canViewHarvestStats && (
        <Card
          style={{ marginTop: 24, borderRadius: 12 }}
          title="Estadísticas de cosecha"
        >
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} md={6}>
              <Select
                allowClear
                placeholder="Filtrar por campaña"
                style={{ width: "100%" }}
                value={selectedCampaign}
                onChange={(value) => setSelectedCampaign(value)}
                options={harvestFilters.campaigns.map((campaign) => ({
                  label: campaign,
                  value: campaign,
                }))}
              />
            </Col>

            <Col xs={24} md={6}>
              <Select
                allowClear
                placeholder="Filtrar por cultivo"
                style={{ width: "100%" }}
                value={selectedCrop}
                onChange={(value) => setSelectedCrop(value)}
                options={harvestFilters.crops.map((crop) => ({
                  label: crop,
                  value: crop,
                }))}
              />
            </Col>

            <Col xs={24} md={6}>
              <Select
                placeholder="Unidad"
                style={{ width: "100%" }}
                value={selectedHarvestUnit}
                onChange={handleHarvestUnitChange}
                options={harvestUnitOptions.map(({ value, label }) => ({ value, label }))}
              />
            </Col>

            <Col xs={24} md={6}>
              <Space wrap>
                <Button
                  type="primary"
                  onClick={() =>
                    fetchHarvestStats({
                      campaign: selectedCampaign,
                      crop: selectedCrop,
                      unit: selectedHarvestUnit,
                    })
                  }
                >
                  Aplicar filtros
                </Button>

                <Button
                  onClick={() => {
                    setSelectedCampaign(null);
                    setSelectedCrop(null);
                    fetchHarvestStats({ unit: selectedHarvestUnit });
                  }}
                >
                  Limpiar
                </Button>
              </Space>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={6}>
              <Statistic title="Registros" value={harvestSummary?.total_records || 0} />
            </Col>

            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="Producción total"
                value={Number(harvestSummary?.total_production_kg || 0)}
                suffix={selectedHarvestUnitMeta.suffix}
              />
            </Col>

            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="Superficie cosechada"
                value={Number(harvestSummary?.total_area_ha || 0)}
                suffix="ha"
              />
            </Col>

            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="Rendimiento promedio"
                value={Number(harvestSummary?.avg_yield_kg_ha || 0)}
                suffix={selectedHarvestUnitMeta.yieldSuffix}
              />
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
            <Col xs={24} lg={12}>
              <Card title={`Rendimiento por cultivo (${selectedHarvestUnitMeta.yieldSuffix})`}>
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={harvestByCrop}>
                      <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
                      <XAxis dataKey="crop" tickFormatter={(value) => value.charAt(0).toUpperCase() + value.slice(1)} tick={{ fill: chartColors.text }} />
                      <YAxis tick={{ fill: chartColors.text }} />
                      <RechartsTooltip formatter={(value) => [`${Number(value || 0).toFixed(2)} ${selectedHarvestUnitMeta.yieldSuffix}`, "Rendimiento"]} />
                      <Bar
                        dataKey="yield_kg_ha"
                        name={selectedHarvestUnitMeta.yieldSuffix}
                        radius={[8, 8, 0, 0]}
                      >
                        {harvestByCrop.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={cropColors[index % cropColors.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title={`Rendimiento por campaña (${selectedHarvestUnitMeta.yieldSuffix})`}>
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={harvestByCampaign}>
                      <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
                      <XAxis dataKey="campaign" tick={{ fill: chartColors.text }} />
                      <YAxis tick={{ fill: chartColors.text }} />
                      <RechartsTooltip formatter={(value) => [`${Number(value || 0).toFixed(2)} ${selectedHarvestUnitMeta.yieldSuffix}`, "Rendimiento"]} />
                      <Line
                        type="monotone"
                        dataKey="yield_kg_ha"
                        name={selectedHarvestUnitMeta.yieldSuffix}
                        stroke={chartColors.secondary}
                        strokeWidth={3}
                        dot={{ r: 4, fill: chartColors.secondary }}
                        activeDot={{ r: 7, fill: chartColors.accent }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </Col>
          </Row>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;



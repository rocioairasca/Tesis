import React, { useEffect, useState, useMemo } from "react";
import { Card, Row, Col, Statistic, Progress, Space, Tag, Typography, Tooltip } from "antd";
import {
  UserOutlined,
  InboxOutlined,
  FileTextOutlined,
  EnvironmentOutlined,
  CloudOutlined,
  ArrowUpOutlined,
  SunOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import api from "../services/apiClient";

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

// ---- Weather icon SVGs (simple y lindos) ----
const Svg = ({ children, size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const IconSunny = ({ size }) => (
  <Svg size={size}>
    <circle cx="32" cy="32" r="10" fill="currentColor" opacity="0.1" />
    <circle cx="32" cy="32" r="10" />
    {Array.from({ length: 8 }).map((_, i) => {
      const a = (i * Math.PI) / 4;
      const x1 = 32 + Math.cos(a) * 16, y1 = 32 + Math.sin(a) * 16;
      const x2 = 32 + Math.cos(a) * 22, y2 = 32 + Math.sin(a) * 22;
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
    })}
  </Svg>
);

const IconCloud = ({ size }) => (
  <Svg size={size}>
    <path d="M20 40h24a10 10 0 0 0 0-20 14 14 0 0 0-27.3 3.5A8 8 0 0 0 20 40Z" />
  </Svg>
);

const IconPartly = ({ size }) => (
  <Svg size={size}>
    {/* sol */}
    <circle cx="22" cy="24" r="7" />
    {Array.from({ length: 6 }).map((_, i) => {
      const a = (i * Math.PI) / 3;
      const x1 = 22 + Math.cos(a) * 12, y1 = 24 + Math.sin(a) * 12;
      const x2 = 22 + Math.cos(a) * 16, y2 = 24 + Math.sin(a) * 16;
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
    })}
    {/* nube */}
    <path d="M26 42h20a8 8 0 0 0 0-16 12 12 0 0 0-23.2 3" />
  </Svg>
);

const IconRain = ({ size }) => (
  <Svg size={size}>
    <path d="M20 34h24a9 9 0 0 0 0-18 13 13 0 0 0-25 3" />
    <line x1="24" y1="42" x2="20" y2="50" />
    <line x1="32" y1="42" x2="28" y2="50" />
    <line x1="40" y1="42" x2="36" y2="50" />
  </Svg>
);

const IconStorm = ({ size }) => (
  <Svg size={size}>
    <path d="M20 34h24a9 9 0 0 0 0-18 13 13 0 0 0-25 3" />
    <polyline points="28,40 22,50 30,50 26,58" />
    <polyline points="38,40 32,50 40,50 36,58" />
  </Svg>
);

// ---- Regla simple para elegir icono + label (ES) ----
function getWeatherPresentation(d) {
  const t = Number(d?.temperature);
  const h = Number(d?.humidity) || 0;
  const r = Number(d?.rainfall) || 0;
  const wind = Number(d?.wind_speed) || 0;

  if (r >= 8) return { kind: "storm", label: "Tormenta" };
  if (r > 0.2) return { kind: "rain", label: "Lluvioso" };
  if (h >= 80) return { kind: "cloud", label: "Nublado" };
  if (t >= 26 && h < 70) return { kind: "sunny", label: "Soleado" };
  if (wind >= 25 && h < 75) return { kind: "partly", label: "Parcialmente nublado" };
  return { kind: "partly", label: "Parcialmente nublado" };
}

function WeatherIcon({ kind, size = 56 }) {
  switch (kind) {
    case "sunny": return <IconSunny size={size} />;
    case "cloud": return <IconCloud size={size} />;
    case "rain":  return <IconRain size={size} />;
    case "storm": return <IconStorm size={size} />;
    default:      return <IconPartly size={size} />;
  }
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



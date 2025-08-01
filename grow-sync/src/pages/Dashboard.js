import React, { useEffect, useState } from "react";
import { Card, Row, Col, Statistic } from "antd";
import { 
  UserOutlined, 
  InboxOutlined, 
  FileTextOutlined, 
  EnvironmentOutlined, 
  CloudOutlined,
  ArrowUpOutlined 
} from "@ant-design/icons";
import axios from "axios";

const url = process.env.REACT_APP_URL;

const Dashboard = () => {
  const [stats, setStats] = useState({
    users: 0,
    products: 0,
    lots: 0,
    usages: 0,
  });
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get(`${url}/api/stats`);
        setStats(res.data);
      } catch (error) {
        console.error("Error al cargar estadísticas", error);
      }
    };

    const fetchWeatherWithLocation = () => {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            try {
              // Llama a la ruta del backend para actualizar y devolver el clima
              const res = await axios.get(`${url}/api/weather/update?lat=${lat}&lon=${lon}`);
              setWeather(res.data || null);
            } catch (error) {
              console.error("Error al obtener clima:", error);
              setWeather(null);
            }
          },
          (error) => {
            console.error("No se pudo obtener la ubicación:", error);
            // Si no se da permiso o hay error, obtenemos el último clima registrado
            fetchWeatherFallback();
          }
        );
      } else {
        console.error("Geolocalización no soportada en este navegador.");
        fetchWeatherFallback();
      }
    };

    const fetchWeatherFallback = async () => {
      try {
        const res = await axios.get(`${url}/api/weather/latest`);
        setWeather(res.data || null);
      } catch (error) {
        console.error("Error al cargar clima:", error);
        setWeather(null);
      }
    };

    fetchStats();
    fetchWeatherWithLocation();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Usuarios Registrados"
              value={stats.users}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Productos en Inventario"
              value={stats.products}
              prefix={<InboxOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Lotes Registrados"
              value={stats.lots}
              prefix={<EnvironmentOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Registros de Uso"
              value={stats.usages}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 24 }}>
        <h3><CloudOutlined /> Clima Actual</h3>
        {weather ? (
          <>
            <p><strong>Temp:</strong> {weather?.temperature ?? "-"} °C</p>
            <p><strong>Humedad:</strong> {weather?.humidity ?? "-"} %</p>
            <p>
              <strong>Viento:</strong> {weather?.wind_speed ?? "-"} km/h 
              {weather?.wind_direction && (
                <ArrowUpOutlined
                  style={{
                    transform: `rotate(${weather.wind_direction}deg)`,
                    marginLeft: 8,
                    fontSize: 18
                  }}
                />
              )}
            </p>
            <p><strong>Lluvia:</strong> {weather?.rainfall ?? "-"} mm</p>
          </>
        ) : (
          <p>No hay datos de clima disponibles.</p>
        )}
      </Card>
    </div>
  );
};

export default Dashboard;


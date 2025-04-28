import React, { useEffect, useState } from "react";
import { Card, Row, Col, Statistic } from "antd";
import { UserOutlined, InboxOutlined, FileTextOutlined, EnvironmentOutlined } from "@ant-design/icons";
import axios from "axios";

const Dashboard = () => {
  const [stats, setStats] = useState({
    users: 0,
    products: 0,
    lots: 0,
    usages: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get('http://localhost:4000/api/stats');
        setStats(res.data);
      } catch (error) {
        console.error("Error al cargar estadísticas", error);
      }
    };

    fetchStats();
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
    </div>
  );
};

export default Dashboard;

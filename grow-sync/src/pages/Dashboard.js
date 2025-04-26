import React, { useEffect, useState } from "react";
import { Card, Row, Col, Statistic } from "antd";
import { UserOutlined, InboxOutlined, FileTextOutlined, EnvironmentOutlined } from "@ant-design/icons";

const Dashboard = () => {
  const [data, setData] = useState({
    users: 0,
    inventory: 0,
    lots: 0,
    usages: 0,
  });

  useEffect(() => {
    // Acá simulo que traemos datos del backend.
    setTimeout(() => {
      setData({
        users: 8,
        inventory: 120,
        lots: 5,
        usages: 15,
      });
    }, 500);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Usuarios Registrados"
              value={data.users}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Productos en Inventario"
              value={data.inventory}
              prefix={<InboxOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Lotes Registrados"
              value={data.lots}
              prefix={<EnvironmentOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Registros de Uso"
              value={data.usages}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;

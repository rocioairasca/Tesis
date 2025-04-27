import React, { useEffect, useState } from "react";
import { Card, Row, Col, Statistic } from "antd";
import { UserOutlined, InboxOutlined, FileTextOutlined, EnvironmentOutlined } from "@ant-design/icons";
import axios from "axios";

const Dashboard = () => {
  const [lotCount, setLotCount] = useState(0);

  const [data, setData] = useState({
    users: 0,
    inventory: 0,
    lots: 0,
    usages: 0,
  });

  useEffect(() => {
    const fetchLotCount = async () => {
      try {
        const res = await axios.get('http://localhost:4000/api/lots/count/enabled');
        setLotCount(res.data.total);
      } catch (error) {
        console.error('Error al cargar cantidad de lotes:', error);
      }
    };

    fetchLotCount();

    setTimeout(() => {
      setData({
        users: 8,
        inventory: 120,
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
              value={lotCount}
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

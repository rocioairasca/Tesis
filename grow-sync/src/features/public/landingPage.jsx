import React from "react";
import { Button, Card, Col, Row, Space, Typography } from "antd";
import {
  BarChartOutlined,
  DropboxOutlined,
  EnvironmentOutlined,
  CalendarOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

const { Title, Paragraph } = Typography;

const features = [
  {
    icon: <EnvironmentOutlined style={{ fontSize: 32 }} />,
    title: "Gestión de Lotes",
    description:
      "Administrá campos, superficies y ubicaciones de manera simple.",
  },
  {
    icon: <DropboxOutlined style={{ fontSize: 32 }} />,
    title: "Inventario",
    description:
      "Controlá productos, stock y movimientos en tiempo real.",
  },
  {
    icon: <CalendarOutlined style={{ fontSize: 32 }} />,
    title: "Planificaciones",
    description:
      "Organizá tareas agrícolas y actividades operativas.",
  },
  {
    icon: <BarChartOutlined style={{ fontSize: 32 }} />,
    title: "Dashboard",
    description:
      "Visualizá estadísticas, rendimientos y métricas productivas.",
  },
  {
    icon: <TeamOutlined style={{ fontSize: 32 }} />,
    title: "Multiempresa",
    description:
      "Cada empresa administra sus propios datos de forma segura.",
  },
];

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f7fa",
        padding: "32px 16px",
      }}
    >
      {/* HERO */}
      <Row justify="center" style={{ marginTop: 40 }}>
        <Col xs={24} md={18} lg={14}>
          <Card
            bordered={false}
            style={{
              borderRadius: 20,
              textAlign: "center",
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            }}
          >
            <Space direction="vertical" size={24} style={{ width: "100%" }}>
              <div>
                <Title
                  level={1}
                  style={{
                    marginBottom: 8,
                    color: "#1f1f1f",
                  }}
                >
                  GrowSync
                </Title>

                <Title
                  level={3}
                  style={{
                    fontWeight: 400,
                    color: "#52c41a",
                    marginTop: 0,
                  }}
                >
                  Gestión inteligente para el agro
                </Title>
              </div>

              <Paragraph
                style={{
                  fontSize: 18,
                  maxWidth: 700,
                  margin: "0 auto",
                  color: "#595959",
                }}
              >
                Centralizá la gestión de lotes, inventario, cosechas,
                planificaciones y usuarios en una sola plataforma moderna,
                segura y multiempresa.
              </Paragraph>

              <Space
                size={16}
                wrap
                style={{
                  justifyContent: "center",
                }}
              >
                <Button
                  type="primary"
                  size="large"
                  onClick={() => navigate("/register-company")}
                >
                  Crear Empresa
                </Button>

                <Button
                  size="large"
                  onClick={() => navigate("/login")}
                >
                  Iniciar Sesión
                </Button>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* FEATURES */}
      <Row
        gutter={[24, 24]}
        justify="center"
        style={{ marginTop: 48 }}
      >
        {features.map((feature) => (
          <Col xs={24} sm={12} lg={8} key={feature.title}>
            <Card
              bordered={false}
              style={{
                height: "100%",
                borderRadius: 16,
                textAlign: "center",
                boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
              }}
            >
              <Space direction="vertical" size={16}>
                <div style={{ color: "#52c41a" }}>
                  {feature.icon}
                </div>

                <Title level={4} style={{ marginBottom: 0 }}>
                  {feature.title}
                </Title>

                <Paragraph style={{ color: "#595959" }}>
                  {feature.description}
                </Paragraph>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      {/* FOOTER */}
      <div
        style={{
          marginTop: 64,
          textAlign: "center",
          color: "#8c8c8c",
        }}
      >
        GrowSync © {new Date().getFullYear()}
      </div>
    </div>
  );
};

export default LandingPage;
import React from "react";
import { Button, Card, Col, Row, Space, Tag, Typography } from "antd";
import { CheckCircleOutlined, Leaf } from "../../components/AppIcons";
import { useNavigate } from "react-router-dom";

const { Title, Paragraph, Text } = Typography;

const plans = [
  {
    key: "basic",
    name: "Basico",
    price: 20000,
    description: "Herramientas esenciales para iniciar la gestion agricola.",
    features: ["Lotes", "Inventario", "Planificaciones", "Dashboard"],
  },
  {
    key: "professional",
    name: "Profesional",
    price: 45000,
    description: "Gestion completa con cosechas, lluvias y reportes operativos.",
    features: ["Todo Basico", "Cosechas", "Registro de lluvias", "Usuarios y permisos"],
    highlight: true,
  },
];

const formatMoney = (value) => value.toLocaleString("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const PlanSelection = () => {
  const navigate = useNavigate();

  const handleSelectPlan = (planKey) => {
    localStorage.removeItem("growsync_mp_external_reference");
    localStorage.removeItem("growsync_mp_preference_id");
    localStorage.removeItem("growsync_payment_id");
    navigate(`/payment?plan=${planKey}`);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa", padding: "32px 16px" }}>
      <Row justify="center">
        <Col xs={24} lg={18} xl={14}>
          <Space direction="vertical" size={28} style={{ width: "100%" }}>
            <div style={{ textAlign: "center" }}>
              <Leaf size={42} style={{ color: "#437118" }} />
              <Title level={1} style={{ marginBottom: 4 }}>Elegir plan</Title>
              <Paragraph style={{ fontSize: 16, color: "#595959" }}>
                Selecciona un plan para continuar con el pago simulado.
              </Paragraph>
            </div>

            <Row gutter={[20, 20]}>
              {plans.map((plan) => (
                <Col xs={24} md={12} key={plan.key}>
                  <Card
                    bordered={false}
                    style={{
                      height: "100%",
                      borderRadius: 16,
                      border: plan.highlight ? "2px solid #437118" : "1px solid #edf0f2",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
                    }}
                    title={
                      <Space>
                        <span>{plan.name}</span>
                        {plan.highlight && <Tag color="green">Recomendado</Tag>}
                      </Space>
                    }
                  >
                    <Space direction="vertical" size={18} style={{ width: "100%" }}>
                      <div>
                        <Title level={2} style={{ margin: 0 }}>{formatMoney(plan.price)}</Title>
                        <Text type="secondary">Pago simulado unico</Text>
                      </div>
                      <Paragraph>{plan.description}</Paragraph>
                      <Space direction="vertical" size={8}>
                        {plan.features.map((feature) => (
                          <Text key={feature}>
                            <CheckCircleOutlined style={{ color: "#437118", marginRight: 8 }} />
                            {feature}
                          </Text>
                        ))}
                      </Space>
                      <Button
                        type={plan.highlight ? "primary" : "default"}
                        size="large"
                        block
                        onClick={() => handleSelectPlan(plan.key)}
                      >
                        Seleccionar {plan.name}
                      </Button>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>

            <div style={{ textAlign: "center" }}>
              <Button type="link" onClick={() => navigate("/")}>Volver al inicio</Button>
            </div>
          </Space>
        </Col>
      </Row>
    </div>
  );
};

export default PlanSelection;

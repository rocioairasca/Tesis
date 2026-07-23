import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Space,
  Typography,
  notification,
} from "antd";

import { useNavigate, useSearchParams } from "react-router-dom";

import {
  Leaf,
  LockOutlined,
  MailOutlined,
  UserOutlined,
} from "../../components/AppIcons";

import {
  getMercadoPagoPaymentByReference,
  getSimulatedPayment,
  registerCompany,
} from "../../services/publicService";

const { Title, Paragraph, Text } = Typography;

const RegisterCompany = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [payment, setPayment] = useState(null);
  const [checkingPayment, setCheckingPayment] = useState(true);
  const mercadoPagoExternalReference =
    searchParams.get("externalReference") ||
    localStorage.getItem("growsync_mp_external_reference");
  const paymentId = mercadoPagoExternalReference
    ? null
    : searchParams.get("paymentId") ||
      localStorage.getItem("growsync_payment_id");
  const paymentApproved = payment?.status === "approved";

  useEffect(() => {
    const verifyPayment = async () => {
      if (!paymentId && !mercadoPagoExternalReference) {
        setCheckingPayment(false);
        return;
      }

      try {
        if (paymentId) {
          const response = await getSimulatedPayment(paymentId);
          setPayment(response.payment || null);
          return;
        }

        const response = await getMercadoPagoPaymentByReference(
          mercadoPagoExternalReference
        );

        setPayment(
          response.found
            ? {
                ...response.payment,
                provider: "mercadopago",
              }
            : null
        );
      } catch {
        setPayment(null);
      } finally {
        setCheckingPayment(false);
      }
    };

    verifyPayment();
  }, [paymentId, mercadoPagoExternalReference]);

  const handleSubmit = async (values) => {
    try {
      setLoading(true);

      await registerCompany({
        companyName: values.companyName,
        adminName: values.adminName,
        email: values.email,
        password: values.password,
        paymentId,
        mercadoPagoExternalReference,
      });

      notification.success({
        message: "Empresa creada correctamente",
        description: "Ya podes iniciar sesion con el administrador creado.",
      });

      form.resetFields();
      localStorage.removeItem("growsync_payment_id");
      localStorage.removeItem("growsync_mp_external_reference");
      localStorage.removeItem("growsync_mp_preference_id");

      navigate("/login");
    } catch (error) {
      console.error(error);

      notification.error({
        message: "No se pudo crear la empresa",
        description:
          error?.response?.data?.message ||
          "Ocurrio un error inesperado",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f7fa",
        padding: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Row justify="center" style={{ width: "100%" }}>
        <Col xs={24} sm={22} md={16} lg={10} xl={8}>
          <Card
            bordered={false}
            style={{
              borderRadius: 20,
              boxShadow: "0 6px 30px rgba(0,0,0,0.08)",
            }}
          >
            <Space
              direction="vertical"
              size={24}
              style={{ width: "100%" }}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 20,
                    background: "#f6ffed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px auto",
                    color: "#52c41a",
                  }}
                >
                  <Leaf size={40} />
                </div>

                <Title level={2} style={{ marginBottom: 4 }}>
                  Crear Empresa
                </Title>

                <Paragraph type="secondary">
                  Registra tu empresa y comenza a utilizar GrowSync.
                </Paragraph>
              </div>

              <Alert
                type={paymentApproved ? "success" : "warning"}
                showIcon
                message={paymentApproved ? "Pago aprobado verificado" : "Pago requerido"}
                description={
                  paymentApproved
                    ? `Operacion ${payment.transaction_number || payment.id}. El primer usuario creado tendra permisos de administrador.`
                    : "Para registrar una empresa, primero confirma el pago desde la seleccion de plan."
                }
              />

              {!checkingPayment && !paymentApproved && (
                <Button type="primary" block onClick={() => navigate("/select-plan")}>
                  Elegir plan y pagar
                </Button>
              )}

              <Form
                form={form}
                layout="vertical"
                onFinish={handleSubmit}
                autoComplete="off"
              >
                <Form.Item
                  label="Nombre de la Empresa"
                  name="companyName"
                  rules={[{ required: true, message: "Ingresa el nombre de la empresa" }]}
                >
                  <Input size="large" placeholder="Ej: Campo La Esperanza" />
                </Form.Item>

                <Form.Item
                  label="Nombre del Administrador"
                  name="adminName"
                  rules={[{ required: true, message: "Ingresa el nombre del administrador" }]}
                >
                  <Input
                    size="large"
                    prefix={<UserOutlined />}
                    placeholder="Nombre y apellido"
                  />
                </Form.Item>

                <Form.Item
                  label="Email"
                  name="email"
                  rules={[
                    { required: true, message: "Ingresa un email" },
                    { type: "email", message: "Ingresa un email valido" },
                  ]}
                >
                  <Input
                    size="large"
                    prefix={<MailOutlined />}
                    placeholder="admin@empresa.com"
                  />
                </Form.Item>

                <Form.Item
                  label="Contrasena"
                  name="password"
                  rules={[
                    { required: true, message: "Ingresa una contrasena" },
                    { min: 8, message: "La contrasena debe tener al menos 8 caracteres" },
                  ]}
                >
                  <Input.Password
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="********"
                  />
                </Form.Item>

                <Form.Item
                  label="Confirmar Contrasena"
                  name="confirmPassword"
                  dependencies={["password"]}
                  rules={[
                    { required: true, message: "Confirma la contrasena" },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (!value || getFieldValue("password") === value) {
                          return Promise.resolve();
                        }

                        return Promise.reject(new Error("Las contrasenas no coinciden"));
                      },
                    }),
                  ]}
                >
                  <Input.Password
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="********"
                  />
                </Form.Item>

                <Form.Item style={{ marginTop: 32 }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={loading}
                    disabled={checkingPayment || !paymentApproved}
                  >
                    Crear Empresa
                  </Button>
                </Form.Item>
              </Form>

              <div style={{ textAlign: "center" }}>
                <Text type="secondary">
                  Ya tenes cuenta?
                </Text>

                <Button
                  type="link"
                  onClick={() => navigate("/login")}
                >
                  Iniciar sesion
                </Button>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default RegisterCompany;

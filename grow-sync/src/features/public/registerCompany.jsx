import React, { useState } from "react";
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

import { useNavigate } from "react-router-dom";

import {
  Leaf,
  LockOutlined,
  MailOutlined,
  UserOutlined,
} from "../../components/AppIcons";

import { registerCompany } from "../../services/publicService";

const { Title, Paragraph, Text } = Typography;

const RegisterCompany = () => {
  const navigate = useNavigate();

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values) => {
    try {
      setLoading(true);

      await registerCompany({
        companyName: values.companyName,
        adminName: values.adminName,
        email: values.email,
        password: values.password,
      });

      notification.success({
        message: "Empresa creada correctamente",
        description:
          "Ya podés iniciar sesión con el administrador creado.",
      });

      form.resetFields();

      navigate("/login");
    } catch (error) {
      console.error(error);

      notification.error({
        message: "No se pudo crear la empresa",
        description:
          error?.response?.data?.message ||
          "Ocurrió un error inesperado",
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
                  Registrá tu empresa y comenzá a utilizar GrowSync.
                </Paragraph>
              </div>

              <Alert
                type="info"
                showIcon
                message="El primer usuario creado tendrá permisos de administrador."
              />

              <Form
                form={form}
                layout="vertical"
                onFinish={handleSubmit}
                autoComplete="off"
              >
                <Form.Item
                  label="Nombre de la Empresa"
                  name="companyName"
                  rules={[
                    {
                      required: true,
                      message: "Ingresá el nombre de la empresa",
                    },
                  ]}
                >
                  <Input
                    size="large"
                    placeholder="Ej: Campo La Esperanza"
                  />
                </Form.Item>

                <Form.Item
                  label="Nombre del Administrador"
                  name="adminName"
                  rules={[
                    {
                      required: true,
                      message: "Ingresá el nombre del administrador",
                    },
                  ]}
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
                    {
                      required: true,
                      message: "Ingresá un email",
                    },
                    {
                      type: "email",
                      message: "Ingresá un email válido",
                    },
                  ]}
                >
                  <Input
                    size="large"
                    prefix={<MailOutlined />}
                    placeholder="admin@empresa.com"
                  />
                </Form.Item>

                <Form.Item
                  label="Contraseña"
                  name="password"
                  rules={[
                    {
                      required: true,
                      message: "Ingresá una contraseña",
                    },
                    {
                      min: 8,
                      message:
                        "La contraseña debe tener al menos 8 caracteres",
                    },
                  ]}
                >
                  <Input.Password
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="********"
                  />
                </Form.Item>

                <Form.Item
                  label="Confirmar Contraseña"
                  name="confirmPassword"
                  dependencies={["password"]}
                  rules={[
                    {
                      required: true,
                      message: "Confirmá la contraseña",
                    },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (
                          !value ||
                          getFieldValue("password") === value
                        ) {
                          return Promise.resolve();
                        }

                        return Promise.reject(
                          new Error("Las contraseñas no coinciden")
                        );
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
                  >
                    Crear Empresa
                  </Button>
                </Form.Item>
              </Form>

              <div style={{ textAlign: "center" }}>
                <Text type="secondary">
                  ¿Ya tenés cuenta?
                </Text>

                <Button
                  type="link"
                  onClick={() => navigate("/login")}
                >
                  Iniciar sesión
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
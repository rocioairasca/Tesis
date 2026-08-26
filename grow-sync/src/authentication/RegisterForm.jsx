import React, { useState, useEffect } from "react";
import { Alert, Form, Input, Button, message, Typography } from "antd";
import { UserOutlined, LockOutlined, MailOutlined } from '../components/AppIcons';
import { registerUser, getInvitation } from "../services/authService";

const { Text } = Typography;

const RegisterForm = ({ onSwitchToLogin, token }) => {
    const [loading, setLoading] = useState(false);
    const [invitation, setInvitation] = useState(null);
    const [invitationLoading, setInvitationLoading] = useState(false);
    const [invitationError, setInvitationError] = useState(null);
    const [form] = Form.useForm();

    useEffect(() => {
        if (token) {
            setInvitationLoading(true);
            setInvitationError(null);

            // Obtener email de la invitación y autocompletar
            getInvitation(token)
                .then(data => {
                    setInvitation(data);
                    form.setFieldsValue({ email: data.email });
                })
                .catch(err => {
                    console.error("Error fetching invitation:", err);
                    setInvitation(null);
                    setInvitationError(err?.message || "Invitación inválida o expirada");
                    message.error(err?.message || "Invitación inválida o expirada");
                })
                .finally(() => {
                    setInvitationLoading(false);
                });
        }
    }, [token, form]);

    const onFinish = async (values) => {
        try {
            setLoading(true);
            const { username, email, password } = values;
            if (token && !invitation) {
                message.error("Primero debe validarse la invitación");
                return;
            }

            const response = await registerUser({ username, email, password, token });

            message.success(response?.message || "Usuario registrado con éxito 🚀");

            setTimeout(() => {
                onSwitchToLogin?.();
            }, 800);
        } catch (error) {
            console.error("→ Error:", error);
            message.error(error?.message || "Error al registrar usuario");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Form name="register_form" onFinish={onFinish} layout="vertical" form={form}>
            {token && invitation && (
                <Alert
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="Invitación validada"
                    description={
                        <Text>
                            Vas a crear la cuenta administradora de {invitation.companyName || "la empresa invitada"}.
                        </Text>
                    }
                />
            )}

            {token && invitationError && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="No se pudo validar la invitación"
                    description={invitationError}
                />
            )}

            <Form.Item name="username" rules={[{ required: true, message: "Por favor ingrese un nombre de usuario" }]}>
                <Input prefix={<UserOutlined />} placeholder="Nombre de usuario" />
            </Form.Item>

            <Form.Item
                name="email"
                rules={[
                    { required: true, message: "Por favor ingrese su correo electrónico" },
                    { type: "email", message: "Correo no válido" }
                ]}
            >
                <Input prefix={<MailOutlined />} placeholder="Correo electrónico" disabled={!!token} />
            </Form.Item>

            <Form.Item name="password" rules={[{ required: true, message: "Por favor ingrese una contraseña" }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="Contraseña" />
            </Form.Item>

            <Form.Item
                name="confirm"
                dependencies={["password"]}
                hasFeedback
                rules={[
                    { required: true, message: "Por favor confirme su contraseña" },
                    ({ getFieldValue }) => ({
                        validator(_, value) {
                            if (!value || getFieldValue("password") === value) return Promise.resolve();
                            return Promise.reject(new Error("Las contraseñas no coinciden"));
                        },
                    }),
                ]}
            >
                <Input.Password prefix={<LockOutlined />} placeholder="Confirmar contraseña" />
            </Form.Item>

            <Form.Item>
                <Button
                    type="primary"
                    htmlType="submit"
                    block
                    loading={loading || invitationLoading}
                    disabled={!!token && (!invitation || invitationLoading)}
                    style={{ backgroundColor: "#437118", borderColor: "#437118" }}
                >
                    Registrarse
                </Button>
            </Form.Item>
        </Form>
    );
};

export default RegisterForm;

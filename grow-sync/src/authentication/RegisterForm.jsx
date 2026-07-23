import React, { useState, useEffect } from "react";
import { Form, Input, Button, message } from "antd";
import { UserOutlined, LockOutlined, MailOutlined } from '../components/AppIcons';
import { registerUser, getInvitation } from "../services/authService";

const RegisterForm = ({ onSwitchToLogin, token }) => {
    const [loading, setLoading] = useState(false);
    const [form] = Form.useForm();

    useEffect(() => {
        if (token) {
            // Obtener email de la invitación y autocompletar
            getInvitation(token)
                .then(data => {
                    form.setFieldsValue({ email: data.email });
                })
                .catch(err => {
                    console.error("Error fetching invitation:", err);
                });
        }
    }, [token, form]);

    const onFinish = async (values) => {
        try {
            setLoading(true);
            const { username, email, password } = values;
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
                    loading={loading}
                    style={{ backgroundColor: "#437118", borderColor: "#437118" }}
                >
                    Registrarse
                </Button>
            </Form.Item>
        </Form>
    );
};

export default RegisterForm;

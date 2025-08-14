import React, {useState} from "react";
import { Form, Input, Button, message } from "antd";
import { UserOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";
import { registerUser } from "../../services/authService";

const RegisterForm = ({onSwitchToLogin}) => {
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    try {
      setLoading(true);
      const { username, email, password } = values;
      const response = await registerUser({ username, email, password });

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
    <Form name="register_form" onFinish={onFinish} layout="vertical">
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
        <Input prefix={<MailOutlined />} placeholder="Correo electrónico" />
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
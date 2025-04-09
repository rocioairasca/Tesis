import React, {useState} from "react";
import { Form, Input, Button, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { loginUser } from "../../services/authService"; // Asegúrate de que la ruta sea correcta
import { useNavigate } from "react-router-dom"; // Importa useNavigate para redireccionar

const LoginForm = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate(); // Inicializa useNavigate

  const onFinish = async (values) => {
    const { username, password } = values;

    try {
      setLoading(true);
      const response = await loginUser(username, password);
      localStorage.setItem("access_token", response.access_token);
      message.success("¡Inicio de sesión exitoso! 🚀");

      setTimeout(() => {
        navigate("/dashboard");
      }, 1000);

    } catch (error) {
      console.error("Error al iniciar sesión:", error.response?.data || error.message);
      message.error("Email o contraseña incorrectos.");
      
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form
      name="login_form"
      initialValues={{ remember: true }}
      onFinish={onFinish}
      layout="vertical"
    >
      <Form.Item
        name="username"
        rules={[{ required: true, message: "Por favor ingrese su email" }]}
      >
        <Input prefix={<UserOutlined />} placeholder="Email" />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[{ required: true, message: "Por favor ingrese su contraseña" }]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="Ingrese su contraseña" />
      </Form.Item>

      <Form.Item style={{ marginTop: 8 }}>
        <Button type="primary" htmlType="submit" block loading={loading} style={{ backgroundColor: "#437118", borderColor: "#437118" }}>
          Login
        </Button>
      </Form.Item>
    </Form>
  );
};

export default LoginForm;
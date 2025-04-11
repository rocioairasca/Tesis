import React, {useState} from "react";
import { Form, Input, Button, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { loginUser, getUserDataByEmail } from "../../services/authService"; // Asegúrate de que la ruta sea correcta
import { useNavigate } from "react-router-dom"; // Importa useNavigate para redireccionar
import { jwtDecode } from 'jwt-decode';

const LoginForm = () => {
  const [loading] = useState(false);
  const navigate = useNavigate(); // Inicializa useNavigate

  const onFinish = async (values) => {
    try {
      const res = await loginUser(values);
  
      message.success('Inicio de sesión exitoso');
  
      // Guardamos el token en localStorage
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('token', res.id_token);

      const decoded = jwtDecode(res.id_token);
      const userData = await getUserDataByEmail(decoded.email);
      localStorage.setItem('user', JSON.stringify(userData));      
  
      // Redireccionamos al dashboard
      navigate('/dashboard');
    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      message.error(error.response?.data?.message || 'Error al iniciar sesión');
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
        name="email"
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
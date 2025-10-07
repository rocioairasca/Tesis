import React, {useState} from "react";
import { Form, Input, Button, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { loginUser, getUserDataByEmail } from "../services/authService"; // Asegúrate de que la ruta sea correcta
import { useNavigate } from "react-router-dom"; // Importa useNavigate para redireccionar
import { jwtDecode } from 'jwt-decode';

const LoginForm = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate(); // Inicializa useNavigate

    const onFinish = async (values) => {
    try {
      setLoading(true);

      // 1) Login contra tu backend (guarda access_token y auth_email)
      const res = await loginUser(values); // { access_token, id_token? }

      // 2) Determinar email (preferimos id_token si está; si no, usamos el ingresado)
      let emailFromToken = null;
      if (res?.id_token) {
        try {
          const decoded = jwtDecode(res.id_token);
          emailFromToken = decoded?.email || null;
        } catch {}
      }
      const emailToUse = emailFromToken || values.email;
      localStorage.setItem("auth_email", emailToUse);

      // 3) Obtener datos (y rol) del usuario
      const userData = await getUserDataByEmail(emailToUse);
      localStorage.setItem('user', JSON.stringify(userData));

      message.success('Inicio de sesión exitoso');
      navigate('/dashboard');
    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      message.error(error?.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Form name="login_form" initialValues={{ remember: true }} onFinish={onFinish} layout="vertical">
      <Form.Item name="email" rules={[{ required: true, message: "Por favor ingrese su email" }]}>
        <Input prefix={<UserOutlined />} placeholder="Email" />
      </Form.Item>

      <Form.Item name="password" rules={[{ required: true, message: "Por favor ingrese su contraseña" }]}>
        <Input.Password prefix={<LockOutlined />} placeholder="Ingrese su contraseña" />
      </Form.Item>

      <Form.Item style={{ marginTop: 8 }}>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={loading}
          style={{ backgroundColor: "#437118", borderColor: "#437118" }}
        >
          Login
        </Button>
      </Form.Item>
    </Form>
  );
};

export default LoginForm;
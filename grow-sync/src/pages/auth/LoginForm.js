import React from "react";
import { Form, Input, Button, Checkbox } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";

const LoginForm = () => {
  const onFinish = (values) => {
    console.log("Login form values:", values);
    // Acá se va a hacer el login con Auth0 luego
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
        rules={[{ required: true, message: "Por favor ingrese su nombre de usuario" }]}
      >
        <Input prefix={<UserOutlined />} placeholder="Ingrese su nombre de usuario" />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[{ required: true, message: "Por favor ingrese su contraseña" }]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="Ingrese su contraseña" />
      </Form.Item>

      <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 8 }}>
        <Checkbox>Recuérdame</Checkbox>
      </Form.Item>

      <Form.Item style={{ marginTop: 8 }}>
        <Button type="primary" htmlType="submit" block style={{ backgroundColor: "#437118", borderColor: "#437118" }}>
          Login
        </Button>
      </Form.Item>
    </Form>
  );
};

export default LoginForm;
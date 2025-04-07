import React from "react";
import { Form, Input, Button } from "antd";
import { UserOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";

const RegisterForm = () => {
  const onFinish = (values) => {
    console.log("Register form values:", values);
    // Acá se podría conectar con Auth0 o tu backend para registrar el usuario
  };

  return (
    <Form name="register_form" onFinish={onFinish} layout="vertical">
      <Form.Item
        name="username"
        rules={[{ required: true, message: "Por favor ingrese un nombre de usuario" }]}
      >
        <Input prefix={<UserOutlined />} placeholder="Nombre de usuario" />
      </Form.Item>

      <Form.Item
        name="email"
        rules={[{ required: true, message: "Por favor ingrese su correo electrónico" }, { type: "email", message: "Correo no válido" }]}
      >
        <Input prefix={<MailOutlined />} placeholder="Correo electrónico" />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[{ required: true, message: "Por favor ingrese una contraseña" }]}
      >
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
              if (!value || getFieldValue("password") === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error("Las contraseñas no coinciden"));
            },
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="Confirmar contraseña" />
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" block style={{ backgroundColor: "#437118", borderColor: "#437118" }}>
          Registrarse
        </Button>
      </Form.Item>
    </Form>
  );
};

export default RegisterForm;
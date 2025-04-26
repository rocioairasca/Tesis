import React, { useState } from "react";
import { Tabs, Typography } from "antd";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";

const { Title, Text } = Typography;

const LoginRegister = () => {
  const [activeTab, setActiveTab] = useState("login");

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#F5F3D8",
        padding: 20,
      }}
    >
      <div
        style={{
          maxWidth: 400,
          width: "100%",
          background: "#fff",
          padding: 40,
          borderRadius: 10,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
        <img src="/LogoGrande.png" alt="GrowSync Logo" style={{ width: 40, marginBottom: 8 }} />
          <Title level={3} style={{ marginBottom: 0 }}>Grow Sync</Title>
          <Text>Bienvenido a nuestro software!</Text>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          centered
          items={[
            {
              key: "login",
              label: "Login",
              children: <LoginForm />,
            },
            {
              key: "register",
              label: "Register",
              children: <RegisterForm onSwitchToLogin={() => setActiveTab("login")} />,
            },
          ]}
        />

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Text type="secondary">Copyright © 2024 - Grow Sync</Text>
        </div>
      </div>
    </div>
  );
};

export default LoginRegister;
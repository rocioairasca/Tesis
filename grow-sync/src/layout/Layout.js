import React from "react";
import { Layout, Typography } from "antd";
import Sidebar from "./Sidebar";
import AppHeader from "./Header";

const { Content } = Layout;
const { Text } = Typography;

const AppLayout = ({ children }) => {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sidebar />
      <Layout>
        <AppHeader />
        <Content style={{ margin: "16px", padding: "16px", background: "#fff" }}>
          {children}
        </Content>
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Text type="secondary">Copyright © 2024 - Grow Sync</Text>
        </div>
      </Layout>
    </Layout>
  );
};

export default AppLayout;

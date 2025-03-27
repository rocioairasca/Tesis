import React from "react";
import { Layout } from "antd";
import Sidebar from "./Sidebar";
import AppHeader from "./Header";

const { Content } = Layout;

const AppLayout = ({ children }) => {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sidebar />
      <Layout>
        <AppHeader />
        <Content style={{ margin: "16px", padding: "16px", background: "#fff" }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;

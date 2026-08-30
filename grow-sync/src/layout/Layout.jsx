import React, { useState } from "react";
import { Layout, Typography } from "antd";

import Sidebar from "./Sidebar";
import AppHeader from "./Header";

import useIsMobile from "../hooks/useIsMobile";

const { Content } = Layout;
const { Text } = Typography;

const AppLayout = ({ children }) => {
  const isMobile = useIsMobile();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sidebarWidth = sidebarCollapsed ? 80 : 200;

  const currentUser = JSON.parse(localStorage.getItem("user") || "null");

  const companyName =
    currentUser?.company_name ||
    currentUser?.companies?.name ||
    currentUser?.company?.name ||
    currentUser?.companyName ||
    "GrowSync";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && (
        <Sidebar
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
        />
      )}

      <Layout
        style={{
          marginLeft: isMobile ? 0 : sidebarWidth,
          transition: "margin-left 0.2s",
        }}
      >
        <AppHeader companyName={companyName} />

        <Content
          style={{
            margin: "16px",
            padding: "16px",
            background: "#fff",
            maxWidth: "100%",
            overflowX: "hidden",
          }}
        >
          {children}
        </Content>

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Text type="secondary">
            Copyright © 2026 - Grow Sync
          </Text>
        </div>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
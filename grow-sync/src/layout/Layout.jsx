import React, { useState } from "react";
import { Layout, Typography } from "antd";

import Sidebar from "./Sidebar";
import AppHeader from "./Header";

import useIsMobile from "../hooks/useIsMobile";
import { APP_VERSION_LABEL } from "../config/appVersion";
import { tokens } from '../theme/tokens';

const { Content } = Layout;
const { Text } = Typography;

const AppLayout = ({ children, wide = false }) => {
  const isMobile = useIsMobile();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sidebarWidth = sidebarCollapsed ? tokens.sidebar.collapsed : tokens.sidebar.expanded;

  const currentUser = JSON.parse(localStorage.getItem("user") || "null");

  const companyName =
    currentUser?.company_name ||
    currentUser?.companies?.name ||
    currentUser?.company?.name ||
    currentUser?.companyName ||
    "GrowSync";

  return (
    <Layout className="gs-shell" style={{ '--gs-sidebar-width': `${isMobile ? 0 : sidebarWidth}px` }}>
      <a className="gs-skip-link" href="#workspace">Ir al contenido</a>
      {!isMobile && (
        <Sidebar
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
        />
      )}

      <Layout className="gs-shell-main">
        <AppHeader companyName={companyName} />

        <div className="gs-shell-scroll">
          <Content id="workspace" tabIndex={-1} className={`gs-workspace${wide ? ' gs-workspace--wide' : ''}`}>
            <div className="gs-workspace-surface">{children}</div>
          </Content>

          <footer className="gs-shell-footer">
            <Text type="secondary">
              Copyright © 2026 - Grow Sync · {APP_VERSION_LABEL}
            </Text>
          </footer>
        </div>
      </Layout>
    </Layout>
  );
};

export default AppLayout;

import React, { useMemo } from "react";
import { Layout, Menu } from "antd";
import {
  CalendarOutlined,
  CarOutlined,
  UserOutlined,
  DashboardOutlined,
  HarvestOutlined,
  AppstoreOutlined,
  EnvironmentOutlined,
  FormOutlined,
} from '../components/AppIcons';
import { Link, useLocation } from "react-router-dom";

import { PERMISSIONS } from "../constants/permissions";
import { hasPermission } from "../utils/permissions";

const { Sider } = Layout;

const Sidebar = ({ collapsed, onCollapse }) => {
  const location = useLocation();

  const currentUser = useMemo(() => {
    return JSON.parse(localStorage.getItem("user") || "null");
  }, []);

  const allItems = [
    {
      key: "dashboard",
      icon: <DashboardOutlined />,
      label: <Link to="/dashboard">Dashboard</Link>,
      show: true,
    },
    {
      key: "planning",
      icon: <CalendarOutlined />,
      label: <Link to="/planificaciones">Planificaciones</Link>,
      show: hasPermission(currentUser, PERMISSIONS.PLANNING_VIEW),
    },
    {
      key: "harvest",
      icon: <HarvestOutlined />,
      label: <Link to="/harvest">Cosechas</Link>,
      show: hasPermission(currentUser, PERMISSIONS.HARVEST_VIEW),
    },
    {
      key: "usage",
      icon: <FormOutlined />,
      label: <Link to="/usage">Registros de Uso</Link>,
      show: hasPermission(currentUser, PERMISSIONS.USAGE_VIEW),
    },
    {
      key: "inventario",
      icon: <AppstoreOutlined />,
      label: <Link to="/inventario">Inventario</Link>,
      show: hasPermission(currentUser, PERMISSIONS.INVENTORY_VIEW),
    },
    {
      key: "lotes",
      icon: <EnvironmentOutlined />,
      label: <Link to="/lotes">Lotes</Link>,
      show: hasPermission(currentUser, PERMISSIONS.LOTS_VIEW),
    },
    {
      key: "vehiculos",
      icon: <CarOutlined />,
      label: <Link to="/vehiculos">Vehículos</Link>,
      show: hasPermission(currentUser, PERMISSIONS.VEHICLES_VIEW),
    },
    {
      key: "usuarios",
      icon: <UserOutlined />,
      label: <Link to="/usuarios">Usuarios</Link>,
      show: hasPermission(currentUser, PERMISSIONS.USERS_VIEW),
    },
  ];

  const menuItems = allItems
    .filter((item) => item.show)
    .map(({ show, ...item }) => item);

  return (
    <Sider
      className="grow-sidebar"
      breakpoint="md"
      collapsible
      collapsed={collapsed}
      onCollapse={onCollapse}
    >
      <div style={{ padding: "16px", display: "flex", alignItems: "center" }}>
        <img
          src="/LogoGrande.png"
          alt="Logo"
          style={{ width: "45px", height: "auto", transition: "all 0.3s" }}
        />

        {!collapsed && (
          <div style={{ marginTop: "10px", color: "white", fontSize: "25px" }}>
            GrowSync
          </div>
        )}
      </div>

      <Menu
        theme="dark"
        mode="inline"
        inlineCollapsed={collapsed}
        selectedKeys={[location.pathname.split("/")[1] || "dashboard"]}
        style={{ background: "#1D2A62" }}
        items={menuItems}
      />
    </Sider>
  );
};

export default Sidebar;

import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  HomeOutlined,
  AppstoreOutlined,
  FormOutlined,
  EnvironmentOutlined,
  MoreOutlined,
  UserOutlined,
  CarOutlined,
  CalendarOutlined
} from './AppIcons';
import { Drawer, List } from "antd";
import "../css/BottomNavigation.css";
import { PERMISSIONS } from "../constants/permissions";
import { hasPermission } from "../utils/permissions";

const BottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [drawerVisible, setDrawerVisible] = useState(false);
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");

  const isActive = (path) => currentPath === path;

  const primaryItems = [
    {
      key: "dashboard",
      path: "/dashboard",
      label: "Dashboard",
      icon: <HomeOutlined />,
      show: true,
    },
    {
      key: "planning",
      path: "/planificaciones",
      label: "Planificaciones",
      icon: <CalendarOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.PLANNING_VIEW),
    },
    {
      key: "cosecha",
      path: "/cosechas",
      label: "Cosechas",
      icon: <HarvestOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.HARVEST_VIEW),
    },
    {
      key: "lotes",
      path: "/lotes",
      label: "Lotes",
      icon: <EnvironmentOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.LOTS_VIEW),
    },
  ].filter((item) => item.show);

  const menuItems = [
    {
      key: "inventario",
      label: "Inventario",
      icon: <AppstoreOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.INVENTORY_VIEW),
      onClick: () => {
        navigate("/inventario");
        setDrawerVisible(false);
      },
    },
    {
      key: "usage",
      label: "Registros de Uso",
      icon: <FormOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.USAGE_VIEW),
      onClick: () => {
        navigate("/usage");
        setDrawerVisible(false);
      },
    },
    {
      key: "vehiculos",
      label: "Vehiculos",
      icon: <CarOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.VEHICLES_VIEW),
      onClick: () => {
        navigate("/vehiculos");
        setDrawerVisible(false);
      },
    },
    {
      key: "usuarios",
      label: "Usuarios",
      icon: <UserOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.USERS_VIEW),
      onClick: () => {
        navigate("/usuarios");
        setDrawerVisible(false);
      },
    }
  ].filter((item) => item.show);

  return (
    <>
      <div className="bottom-nav">
        {primaryItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav__button${isActive(item.path) ? " bottom-nav__button--active" : ""}`}
            aria-label={item.label}
            onClick={() => navigate(item.path)}
          >
            {item.icon}
          </button>
        ))}
        {menuItems.length > 0 && (
          <button
            type="button"
            className="bottom-nav__button"
            aria-label="Mas opciones"
            onClick={() => setDrawerVisible(true)}
          >
            <MoreOutlined />
          </button>
        )}
      </div>

      <Drawer
        title="Mas opciones"
        placement="left"
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        width={250}
      >
        <List
          dataSource={menuItems}
          renderItem={(item) => (
            <List.Item
              onClick={item.onClick}
              style={{ cursor: "pointer", padding: "12px 0" }}
            >
              <List.Item.Meta
                avatar={<span style={{ fontSize: 20, color: "#1D2A62" }}>{item.icon}</span>}
                title={<span style={{ fontSize: 16 }}>{item.label}</span>}
              />
            </List.Item>
          )}
        />
      </Drawer>
    </>
  );
};

export default BottomNavigation;

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
} from "@ant-design/icons";
import { Drawer, List } from "antd";
import "../css/BottomNavigation.css";

const BottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [drawerVisible, setDrawerVisible] = useState(false);

  const isActive = (path) => currentPath === path;

  const menuItems = [
    {
      key: "vehiculos",
      label: "Vehículos",
      icon: <CarOutlined />,
      onClick: () => {
        navigate("/vehiculos");
        setDrawerVisible(false);
      },
    },
    {
      key: "usuarios",
      label: "Usuarios",
      icon: <UserOutlined />,
      onClick: () => {
        navigate("/usuarios");
        setDrawerVisible(false);
      },
    }
  ];

  return (
    <>
      <div className="bottom-nav">
        <HomeOutlined
          onClick={() => navigate("/dashboard")}
          style={{ fontSize: 24, color: isActive("/dashboard") ? "#1D2A62" : "#aaa" }}
        />
        <CalendarOutlined
          onClick={() => navigate("/planificaciones")}
          style={{ fontSize: 24, color: isActive("/planificaciones") ? "#1D2A62" : "#aaa" }}
        />
        <AppstoreOutlined
          onClick={() => navigate("/inventario")}
          style={{ fontSize: 24, color: isActive("/inventario") ? "#1D2A62" : "#aaa" }}
        />
        <FormOutlined
          onClick={() => navigate("/usage")}
          style={{ fontSize: 24, color: isActive("/usage") ? "#1D2A62" : "#aaa" }}
        />
        <EnvironmentOutlined
          onClick={() => navigate("/lotes")}
          style={{ fontSize: 24, color: isActive("/lotes") ? "#1D2A62" : "#aaa" }}
        />
        <MoreOutlined
          onClick={() => setDrawerVisible(true)}
          style={{ fontSize: 24, cursor: "pointer", color: "#666" }}
        />
      </div>

      <Drawer
        title="Más opciones"
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

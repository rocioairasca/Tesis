import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  HomeOutlined,
  AppstoreOutlined,
  FormOutlined,
  EnvironmentOutlined,
  MoreOutlined,
  UserOutlined,
  CarOutlined
} from "@ant-design/icons";
import { Dropdown, Menu } from "antd";
import "../css/BottomNavigation.css";

const BottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path) => currentPath === path;

  const moreMenu = (
    <Menu
      items={[
        {
          key: "usuarios",
          label: "Usuarios",
          icon: <UserOutlined />,
          onClick: () => navigate("/usuarios"),
        },
        {
          key: "vehiculos",
          label: "Vehículos",
          icon: <CarOutlined />,
          onClick: () => navigate("/vehiculos"),
        }
      ]}
    />
  );

  return (
    <div className="bottom-nav">
        <HomeOutlined
          onClick={() => navigate("/dashboard")}
          style={{ fontSize: 24, color: isActive("/dashboard") ? "#1D2A62" : "#aaa" }}
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
        <Dropdown overlay={moreMenu} trigger={['click']} placement="topRight">
          <MoreOutlined style={{ fontSize: 24, cursor: "pointer", color: "#666" }} />
        </Dropdown>
    </div>
  );
};

export default BottomNavigation;

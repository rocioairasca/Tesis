import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AppIcons } from './AppIcons';
const { home: HomeOutlined, inventory: AppstoreOutlined, usage: FormOutlined, lots: EnvironmentOutlined, more: MoreOutlined, users: UserOutlined, vehicle: CarOutlined, cloud: CloudOutlined, harvest: HarvestOutlined, planning: CalendarOutlined } = AppIcons;
import { Drawer, List, Button } from "antd";
import "../css/BottomNavigation.css";
import { PERMISSIONS } from "../constants/permissions";
import { hasPermission } from "../utils/permissions";

const BottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [drawerVisible, setDrawerVisible] = useState(false);
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");

  const isActive = (path) => currentPath === path || currentPath.startsWith(`${path}/`) || currentPath.startsWith(`${path}-`)
    || (path==='/inventario'&&currentPath==='/productos-deshabilitados') || (path==='/usage'&&currentPath==='/usages-disabled');

  const primaryItems = [
    {
      key: "dashboard",
      path: "/dashboard",
      label: "Inicio",
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
      key: "inventario",
      path: "/inventario",
      label: "Inventario",
      icon: <AppstoreOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.INVENTORY_VIEW),
    },
    {
      key: "lotes",
      path: "/lotes",
      label: "Lotes",
      icon: <EnvironmentOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.LOTS_VIEW),
    },
  ].filter((item) => item.show).sort((a,b)=>['dashboard','planning','lotes','inventario'].indexOf(a.key)-['dashboard','planning','lotes','inventario'].indexOf(b.key));

  const menuItems = [
    {
      key: "cosecha",
      label: "Cosechas",
      icon: <HarvestOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.HARVEST_VIEW),
      onClick: () => {
        navigate("/harvest");
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
      key: "rain-records",
      label: "Registro de lluvias",
      icon: <CloudOutlined />,
      show: hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_VIEW),
      onClick: () => {
        navigate("/registro-lluvias");
        setDrawerVisible(false);
      },
    },
    {
      key: "vehiculos",
      label: "Vehículos",
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
      <nav className="bottom-nav" aria-label="Navegación principal mobile">
        {primaryItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav__button${isActive(item.path) ? " bottom-nav__button--active" : ""}`}
            aria-label={item.label}
            aria-current={isActive(item.path) ? 'page' : undefined}
            onClick={() => navigate(item.path)}
          >
            {item.icon}

          </button>
        ))}
        {menuItems.length > 0 && (
          <button
            type="button"
            className={`bottom-nav__button${!primaryItems.some(item=>isActive(item.path))?' bottom-nav__button--active':''}`}
            aria-label="Más opciones"
            aria-expanded={drawerVisible}
            aria-haspopup="dialog"
            onClick={() => setDrawerVisible(true)}
          >
            <MoreOutlined />

          </button>
        )}
      </nav>

      <Drawer
        title="Más opciones"
        placement="bottom"
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        height="auto"
        styles={{body:{maxHeight:'70dvh',overflowY:'auto',paddingBottom:'calc(24px + env(safe-area-inset-bottom, 0px))'}}}
      >
        <List
          dataSource={menuItems}
          renderItem={(item) => (
            <List.Item>
              <Button type="text" block onClick={item.onClick} icon={item.icon} style={{minHeight:44,justifyContent:'flex-start'}}>{item.label}</Button>
            </List.Item>
          )}
        />
      </Drawer>
    </>
  );
};

export default BottomNavigation;

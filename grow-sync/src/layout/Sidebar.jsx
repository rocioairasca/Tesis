import React, { useMemo } from "react";
import { Layout, Menu, Button } from "antd";
import { tokens } from '../theme/tokens';
import { AppIcons } from '../components/AppIcons';
const { planning: CalendarOutlined, vehicle: CarOutlined, users: UserOutlined, home: DashboardOutlined, harvest: HarvestOutlined, cloud: CloudOutlined, inventory: AppstoreOutlined, lots: EnvironmentOutlined, usage: FormOutlined, collapse: ArrowLeftOutlined } = AppIcons;
import { Link, useLocation } from "react-router-dom";

import { PERMISSIONS } from "../constants/permissions";
import { hasPermission } from "../utils/permissions";
import sidebarField from "../assets/illustrations/sidebar-field.png";

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
      key: "registro-lluvias",
      icon: <CloudOutlined />,
      label: <Link to="/registro-lluvias">Registro de lluvias</Link>,
      show: hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_VIEW),
    },
    {
      key: "usage",
      icon: <FormOutlined />,
      label: <Link to="/usage">Registros de Uso</Link>,
      show: hasPermission(currentUser, PERMISSIONS.USAGE_VIEW),
    },
    {
      key: "inventario",
      title: "Inventario",
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
    .map(({ show, ...item }) => ({...item,title:item.label.props.children}));
  const routeKey = location.pathname.startsWith('/planificaciones') ? 'planning'
    : location.pathname.startsWith('/productos-') ? 'inventario'
    : location.pathname.startsWith('/usages-') ? 'usage'
    : location.pathname.startsWith('/lotes') ? 'lotes'
    : location.pathname.startsWith('/vehiculos') ? 'vehiculos'
    : location.pathname.startsWith('/harvest') ? 'harvest'
    : location.pathname.split('/')[1];

  return (
    <Sider
      className="grow-sidebar"
      breakpoint="md"
      collapsible
      width={tokens.sidebar.expanded}
      collapsedWidth={tokens.sidebar.collapsed}
      trigger={null}
      collapsed={collapsed}
      onCollapse={onCollapse}
    >
      <div className="gs-sidebar-brand">
        <img
          src="/LogoGrande.png"
          alt={collapsed ? 'GrowSync' : ''}
        />

        {!collapsed && (
          <div className="gs-sidebar-wordmark">
            GrowSync
          </div>
        )}
      </div>

      <nav aria-label="Navegación principal"><Menu
        theme="dark"
        mode="inline"
        inlineCollapsed={collapsed}
        selectedKeys={[routeKey || "dashboard"]}
        items={menuItems}
      /></nav>
      {!collapsed && (
        <div className="gs-sidebar-field" aria-hidden="true">
          <img src={sidebarField} alt="" draggable={false} />
        </div>
      )}
      <div className="gs-sidebar-collapse">
        <Button type="text" className="gs-sidebar-toggle" aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'} aria-expanded={!collapsed}
          onClick={()=>onCollapse(!collapsed)} icon={<ArrowLeftOutlined style={{transform:collapsed?'rotate(180deg)':undefined}}/>}>

        </Button>
      </div>
    </Sider>
  );
};

export default Sidebar;

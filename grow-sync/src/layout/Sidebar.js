import React, {useState} from "react";
import { Layout, Menu } from "antd";
import { CalendarOutlined, CarOutlined, UserOutlined, DashboardOutlined, AppstoreOutlined, EnvironmentOutlined, FormOutlined} from "@ant-design/icons";
import { Link, useLocation } from "react-router-dom";

const { Sider } = Layout;

const Sidebar = () => {
    const [collapsed, setCollapsed] = useState(false);
    const location = useLocation();

    // Maneja el evento de colapso
    const onCollapse = (collapsed) => {
        setCollapsed(collapsed);
    };

    return(
        <Sider
            breakpoint="md"
            // collapsedWidth="0"
            // onBreakpoint={(broken) => setCollapsed(broken)}
            collapsible 
            collapsed={collapsed} onCollapse={onCollapse}
        >
            <div style={{ padding: "16px", display: "flex", alignItems: "center" }}>
                {/* Logo visible siempre, nombre solo cuando la sidebar está expandida */}
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
                style={{
                background: "#1D2A62", 
                }}
                items={[
                    {
                        key: "dashboard",
                        icon: <DashboardOutlined />,
                        label: <Link to="/dashboard">Dashboard</Link>,
                    },
                    {
                        key: "planning",
                        icon: <CalendarOutlined />,
                        label: <Link to="/planificaciones">Planificaciones</Link>,
                    },
                    {
                        key: "usage",
                        icon: <FormOutlined />, 
                        label: <Link to="/usage">Registros de Uso</Link>,
                    },
                    {
                        key: "inventario",
                        icon: <AppstoreOutlined />,
                        label: <Link to="/inventario">Inventario</Link>,
                    },
                    {
                        key: "lotes",
                        icon: <EnvironmentOutlined />,
                        label: <Link to="/lotes">Lotes</Link>,
                    },
                    {
                        key: "vehiculos",
                        icon: <CarOutlined />,
                        label: <Link to="/vehiculos">Vehículos</Link>,
                    },
                    {
                        key: "usuarios",
                        icon: <UserOutlined />,
                        label: <Link to="/usuarios">Usuarios</Link>,
                    },
                ]}
            />
        </Sider>
    );
};

export default Sidebar;
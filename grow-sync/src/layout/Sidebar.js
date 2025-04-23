import React, {useState} from "react";
import { Layout, Menu } from "antd";
import { UserOutlined, DashboardOutlined, AppstoreOutlined } from "@ant-design/icons";
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
        <Sider collapsible collapsed={collapsed} onCollapse={onCollapse}>
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
                selectedKeys={[location.pathname.split("/")[1] || "dashboard"]}  
                style={{
                background: "#1D2A62",  // Fondo igual al de la sidebar
                }}
                items={[
                    {
                        key: "dashboard",
                        icon: <DashboardOutlined />,
                        label: <Link to="/dashboard">Dashboard</Link>,
                    },
                    {
                        key: "usuarios",
                        icon: <UserOutlined />,
                        label: <Link to="/usuarios">Gestión de Usuarios</Link>,
                    },
                    {
                        key: "inventario",
                        icon: <AppstoreOutlined />,
                        label: <Link to="/inventario">Gestión de Inventarios</Link>,
                    },
                ]}
            />
        </Sider>
    );
};

export default Sidebar;
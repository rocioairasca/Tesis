import React from "react";
import { Layout, Avatar, Dropdown, Button, Badge } from "antd";
import { BellOutlined, SettingOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";

const { Header } = Layout;


const AppHeader = () => {
     // Menú de usuario
    const userMenuItems = [
        { key: "profile", icon: <UserOutlined />, label: "Perfil" },
        { key: "settings", icon: <SettingOutlined />, label: "Configuración" },
    ];

    // Menú de notificaciones
    const notificationsMenuItems = [
        { key: "no-notifications", label: "No tienes notificaciones", disabled: true },
    ];

    return(
        <Header style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "0 20px", background: "#fff" }}>
            {/* Dropdown de Notificaciones */}
            <Dropdown menu={{ items: notificationsMenuItems }} placement="bottomRight" arrow>
                <Badge count={0} showZero>
                <Button type="text" icon={<BellOutlined style={{ fontSize: "18px" }} />} />
                </Badge>
            </Dropdown>

            {/* Dropdown de Usuario */}
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" arrow>
                <div style={{ display: "flex", alignItems: "center", cursor: "pointer", marginLeft: "15px" }}>
                    <Avatar src="https://via.placeholder.com/40" size="large" />
                    <span style={{ marginLeft: "10px", fontSize: "16px", fontWeight: "500" }}>Usuario</span>
                </div>
            </Dropdown>

            {/* Botón de Cerrar Sesión */}
            <Button 
                type="text" 
                icon={<LogoutOutlined />} 
                style={{ marginLeft: "15px", fontSize: "18px", color: "#ff4d4f" }} 
            >
            </Button>
        </Header>
    );
};

export default AppHeader;
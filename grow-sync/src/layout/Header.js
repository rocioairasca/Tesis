import React from "react";
import { Layout, Avatar, Dropdown, Button, Badge } from "antd";
import { BellOutlined, SettingOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom"; // Importa useNavigate para redireccionar


const { Header } = Layout;
const user = JSON.parse(localStorage.getItem('user'));
console.log("USUARIO DECODIFICADO:", user);

const AppHeader = () => {
    const navigate = useNavigate(); 

    // Menú de usuario
    const userMenuItems = [
        { key: "profile", icon: <UserOutlined />, label: "Perfil" },
        { key: "settings", icon: <SettingOutlined />, label: "Configuración" },
    ];

    // Menú de notificaciones
    const notificationsMenuItems = [
        { key: "no-notifications", label: "No tienes notificaciones", disabled: true },
    ];

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
    };
      
    return(
        <Header
        style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "0 20px",
            background: "#fff",
            gap: "20px", // espacio parejito entre los elementos
        }}
        >
        {/* Notificaciones */}
        <Dropdown menu={{ items: notificationsMenuItems }} placement="bottomRight" arrow>
            <Badge count={0} showZero offset={[-2, 2]}>
            <Button
                type="text"
                icon={<BellOutlined style={{ fontSize: "20px", color: "#1D2A62" }} />}
            />
            </Badge>
        </Dropdown>

        {/* Usuario */}
        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" arrow>
            <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                cursor: "pointer",
            }}
            >
            <Avatar
                src={user?.picture || "https://api.dicebear.com/7.x/initials/svg?seed=Rocio"}
                size="large"
            />
            <span
                style={{
                fontSize: "16px",
                fontWeight: "500",
                color: "#1D2A62",
                whiteSpace: "nowrap",
                }}
            >
                {user?.nickname || user?.name || user?.email}
            </span>
            </div>
        </Dropdown>

        {/* Cerrar Sesión */}
        <Button
            type="text"
            icon={<LogoutOutlined style={{ fontSize: "20px", color: "#ff4d4f" }} />}
            onClick={handleLogout}
        />
        </Header>

    );
};

export default AppHeader;
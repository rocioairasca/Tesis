import React from "react";
import { Layout, Avatar, Dropdown, Button, Badge } from "antd";
import { BellOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import useIsMobile from "../hooks/useIsMobile";

const { Header } = Layout;
const user = JSON.parse(localStorage.getItem('user'));
console.log("USUARIO DECODIFICADO:", user);

const AppHeader = () => {
    const navigate = useNavigate(); 
    const isMobile = useIsMobile();

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
                alignItems: "center",
                padding: "0 20px",
                background: "#fff",
            }}
            >
            {/* IZQUIERDA: logo solo en mobile */}
            {isMobile && (
                <div style={{ display: "flex", alignItems: "center" }}>
                <img
                    src="/LogoGrande.png"
                    alt="GrowSync"
                    style={{ height: 50 }}
                />
                </div>
            )}

            {/* ESPACIO ENTRE logo y contenido */}
            <div style={{ flexGrow: 1 }} />

            {/* DERECHA: notificaciones + usuario + logout */}
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
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
                <div
                    style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    cursor: "pointer",
                    }}
                >
                    <Avatar
                    src={user?.picture}
                    icon={!user?.picture && <UserOutlined />}
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
                    {user?.nickname || user?.username || user?.email}
                    </span>
                </div>

                {/* Cerrar sesión */}
                <Button
                type="text"
                icon={<LogoutOutlined style={{ fontSize: "20px", color: "#ff4d4f" }} />}
                onClick={handleLogout}
                />
            </div>
        </Header>


    );
};

export default AppHeader;
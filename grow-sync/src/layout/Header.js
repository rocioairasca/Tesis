import React, { useEffect, useState } from "react";
import { Layout, Avatar, Dropdown, Button, Badge } from "antd";
import { BellOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import useIsMobile from "../hooks/useIsMobile";

const { Header } = Layout;

const AppHeader = () => {
    const navigate = useNavigate();
    const isMobile = useIsMobile();

    const [user, setUser] = useState(null);

    // cargamos el usuario desde localStorage
    useEffect(() => {
        try {
            const u = localStorage.getItem("user");
            setUser(u ? JSON.parse(u) : null);
        } catch {
            setUser(null);
        }
    }, []);

    // Menú de notificaciones
    const notificationsMenuItems = [
        { key: "no-notifications", label: "No tienes notificaciones", disabled: true },
    ];

    const handleLogout = () => {
        try {
            // Limpieza completa para que no queden tokens colgados
            localStorage.removeItem("access_token");
            localStorage.removeItem("id_token");
            localStorage.removeItem("auth_email");
            localStorage.removeItem("user");
        } catch { }

        navigate("/login", { replace: true });
    };

    const displayName =
        user?.nickname || user?.username || user?.email || "Usuario";

    return (
        <Header
            style={{
                display: "flex",
                alignItems: "center",
                padding: "0 20px",
                background: "#fff",
                position: "sticky",
                top: 0,
                zIndex: 1000,
                width: "100%",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
        >
            {/* IZQUIERDA: logo solo en mobile */}
            {isMobile && (
                <div style={{ display: "flex", alignItems: "center" }}>
                    <img src="/LogoGrande.png" alt="GrowSync" style={{ height: 50 }} />
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
                    style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "default" }}
                >
                    <Avatar
                        src={user?.picture}
                        icon={!user?.picture && <UserOutlined />}
                        size="large"
                    />
                    <span
                        style={{
                            fontSize: "16px",
                            fontWeight: 500,
                            color: "#1D2A62",
                            whiteSpace: "nowrap",
                        }}
                        title={displayName}
                    >
                        {displayName}
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
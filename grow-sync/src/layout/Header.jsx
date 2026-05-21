import React, { useEffect, useState } from "react";
import { Layout, Avatar, Button } from "antd";
import { LogoutOutlined, UserOutlined } from '../components/AppIcons';
import { useNavigate } from "react-router-dom";
import useIsMobile from "../hooks/useIsMobile";
import NotificationBell from "../components/NotificationBell";
import NotificationsDrawer from "../components/NotificationsDrawer";
import { Popconfirm } from "antd";

const { Header } = Layout;

const AppHeader = ({ companyName }) => {
    const navigate = useNavigate();
    const isMobile = useIsMobile();

    const [user, setUser] = useState(null);
    const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);

    // cargamos el usuario desde localStorage
    useEffect(() => {
        try {
            const u = localStorage.getItem("user");
            setUser(u ? JSON.parse(u) : null);
        } catch {
            setUser(null);
        }
    }, []);


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
            justifyContent: "space-between",
            padding: isMobile ? "0 12px" : "0 20px",
            background: "#fff",
            position: "sticky",
            top: 0,
            zIndex: 1000,
            width: "100%",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            overflow: "hidden",
            }}
        >
            {/* IZQUIERDA */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minWidth: 0,
                }}
            >
                <img
                    src="/LogoGrande.png"
                    alt="GrowSync"
                    style={{
                    height: isMobile ? 36 : 42,
                    flexShrink: 0,
                    }}
                />

                <div
                    style={{
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                    }}
                >
                    <span
                        style={{
                            fontWeight: 700,
                            color: "#26356f",
                            fontSize: isMobile ? 14 : 16,
                            lineHeight: 1.1,
                        }}
                    >
                        GrowSync
                    </span>

                    <span
                        style={{
                            fontSize: isMobile ? 11 : 13,
                            color: "#666",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: isMobile ? 120 : 240,
                        }}
                    >
                        {companyName}
                    </span>
                </div>
            </div>

            {/* DERECHA */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: isMobile ? 10 : 18,
                    flexShrink: 0,
                }}
            >
                {/* Campanita */}
                <NotificationBell
                    onOpenDrawer={() => setNotificationsDrawerOpen(true)}
                />

                {/* Avatar */}
                <Avatar
                    src={user?.picture}
                    icon={!user?.picture && <UserOutlined />}
                    size={isMobile ? "default" : "large"}
                />

                {/* Logout */}
                <Popconfirm
                    title="Cerrar sesión"
                    description="¿Estás seguro de que quieres cerrar sesión?"
                    okText="Sí"
                    cancelText="Cancelar"
                    onConfirm={handleLogout}
                >
                    <Button
                        type="text"
                        icon={
                            <LogoutOutlined
                                style={{
                                    fontSize: 20,
                                    color: "#ff4d4f",
                                }}
                            />
                        }
                    />
                </Popconfirm>
            </div>

            {/* Drawer */}
            <NotificationsDrawer
                open={notificationsDrawerOpen}
                onClose={() => setNotificationsDrawerOpen(false)}
            />
        </Header>
    );
};

export default AppHeader;

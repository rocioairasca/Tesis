import React from "react";
import { Layout, Menu } from "antd";
import { UserOutlined, DashboardOutlined, AppstoreOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

const { Sider } = Layout;

const Sidebar = () => {
    return(
        <Sider collapsible>
            <Menu theme="dark" mode="inline">
                <Menu.Item key="dashboard" icon={<DashboardOutlined />}>
                    <Link to="/">Dashboard</Link>
                </Menu.Item>
                <Menu.Item key="usuarios" icon={<UserOutlined />}>
                    <Link to="/usuarios">Gestión de Usuarios</Link>
                </Menu.Item>
                <Menu.Item key="inventario" icon={<AppstoreOutlined />}>
                    <Link to="/inventario">Gestión de Inventarios</Link>
                </Menu.Item>
            </Menu>
        </Sider>
    );
};

export default Sidebar;
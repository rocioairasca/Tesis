import React from "react";
import { Layout } from "antd";

const { Header } = Layout;


const AppHeader = () => {
    return(
        <Header style={{ background: '#fff', padding: 0, textAlign: "center" }}>
            <h2>GrowSync - Gestión Agropecuaria</h2>
        </Header>
    );
};

export default AppHeader;
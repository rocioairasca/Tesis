import React, { useState, useEffect, useCallback } from "react";
import { Table, Button, Row, Col, Tag, Tooltip, notification } from "antd";
import { ArrowLeftOutlined, CheckOutlined } from '../../components/AppIcons';
import { useNavigate } from "react-router-dom";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";
import { STATUS_COLORS, formatActivity, getPlanningDisplayName, statusLabel } from "./planningDisplay";

const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.title ?? String(Math.random());

const DisabledPlanning = () => {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canEnable = hasPermission(currentUser, PERMISSIONS.PLANNING_EDIT)
    && hasPermission(currentUser, PERMISSIONS.PLANNING_ENABLE);

  const fetchDisabled = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/planning/disabled");
      const items = Array.isArray(data) ? data : data?.items || data?.data || [];
      setList(items);
    } catch (e) {
      console.error("→ disabled planning list error:", e);
      notification.error({ message: "Error al cargar planificaciones canceladas" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDisabled(); }, [fetchDisabled]);

  const handleEnable = async (row) => {
    try {
      await api.put(`/planning/enable/${getId(row)}`);
      notification.success({ message: "Planificación restaurada" });
      fetchDisabled();
    } catch (e) {
      console.error("→ enable planning error:", e);
      notification.error({ message: "No se pudo restaurar la planificación" });
    }
  };

  const columns = [
    { title: "Cultivo", dataIndex: "crop_name", render: (_, row) => getPlanningDisplayName(row) },
    { title: "Actividad", dataIndex: "activity_type", render: (t) => <Tag color="default">{formatActivity(t)}</Tag> },
    { title: "Estado", dataIndex: "status", render: (s) => <Tag color={STATUS_COLORS[s] || "default"}>{statusLabel(s)}</Tag> },
    canEnable && {
      title: "Acciones",
      key: "actions",
      width: 72,
      render: (_, record) => (
        <Tooltip title="Restaurar">
          <Button
            type="text"
            shape="circle"
            aria-label="Restaurar"
            icon={<CheckOutlined style={{ color: "#52c41a" }} />}
            onClick={() => handleEnable(record)}
          />
        </Tooltip>
      ),
    },
  ].filter(Boolean);

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><h2>Planificaciones Canceladas</h2></Col>
        <Col>
          {!isMobile ? (
            <Button onClick={() => navigate("/planificaciones")}>← Volver</Button>
          ) : (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/planificaciones")}
              shape="circle"
              type="default"
              style={{ borderColor: "#95ba56" }}
            />
          )}
        </Col>
      </Row>

      <Table
        scroll={{ x: "max-content" }}
        columns={columns}
        dataSource={list}
        loading={loading}
        pagination={{ pageSize: 8, position: ["bottomCenter"] }}
        rowKey={rowKey}
      />
    </div>
  );
};

export default DisabledPlanning;

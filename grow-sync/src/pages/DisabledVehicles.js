import React, { useState, useEffect, useCallback } from "react";
import { Table, Button, Row, Col, Tag, Tooltip, notification } from "antd";
import { ArrowLeftOutlined, CheckOutlined, CarOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import useIsMobile from "../hooks/useIsMobile";
import api from "../services/apiClient";

// ---- helpers ----
const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.plate ?? r?.name ?? String(Math.random());

const statusTag = (s) => {
  switch (s) {
    case "activo": return <Tag color="green">Activo</Tag>;
    case "mantenimiento": return <Tag color="gold">Mantenimiento</Tag>;
    case "fuera_de_servicio": return <Tag color="red">Fuera de servicio</Tag>;
    default: return <Tag>—</Tag>;
  }
};
const numberFmt = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return x.toLocaleString("es-AR");
};

const DisabledVehicles = () => {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const fetchDisabledVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/vehicles/disabled");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setVehicles(list);
    } catch (error) {
      console.error("→ disabled vehicles list error:", error);
      notification.error({ message: "Error al cargar vehículos deshabilitados" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisabledVehicles();
  }, [fetchDisabledVehicles]);

  const handleEnable = async (id) => {
    try {
      await api.put(`/vehicles/enable/${id}`);
      notification.success({ message: "Vehículo habilitado" });
      fetchDisabledVehicles();
    } catch (error) {
      console.error("→ enable vehicle error:", error);
      notification.error({ message: "Error al habilitar vehículo" });
    }
  };

  const columns = [
    {
      title: "#",
      dataIndex: "index",
      key: "index",
      width: 64,
      render: (_, __, index) => index + 1,
    },
    { title: "Nombre", dataIndex: "name", key: "name" },
    {
      title: "Tipo",
      dataIndex: "type",
      key: "type",
      render: (t) => t ? <Tag color="blue">{t[0].toUpperCase() + t.slice(1)}</Tag> : "—",
    },
    { title: "Marca", dataIndex: "brand", key: "brand" },
    { title: "Modelo", dataIndex: "model", key: "model" },
    {
      title: "Patente",
      dataIndex: "plate",
      key: "plate",
      render: (p) => (p ? String(p).toUpperCase() : "—"),
    },
    {
      title: "Capacidad",
      dataIndex: "capacity",
      key: "capacity",
      render: (v) => (v != null ? numberFmt(v) : "—"),
    },
    {
      title: "Estado",
      dataIndex: "status",
      key: "status",
      render: (s) => statusTag(s),
    },
    {
      title: "Acciones",
      key: "actions",
      width: 72,
      render: (_, record) => (
        <Tooltip title="Habilitar">
          <Button
            type="text"
            shape="circle"
            aria-label="Habilitar"
            icon={<CheckOutlined style={{ color: "#52c41a" }} />}
            onClick={() => handleEnable(getId(record))}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><h2>Vehículos Deshabilitados</h2></Col>
        <Col>
          {!isMobile ? (
            <Button onClick={() => navigate("/vehiculos")}>← Volver a Vehículos</Button>
          ) : (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/vehiculos")}
              shape="circle"
              type="default"
              style={{ borderColor: "#95ba56" }}
            />
          )}
        </Col>
      </Row>

      {/* Tabla (desktop) */}
      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={vehicles}
          loading={loading}
          pagination={{ pageSize: 8, position: ["bottomCenter"] }}
          rowKey={rowKey}
        />
      )}

      {/* Cards (mobile) */}
      {isMobile && (
        <div className="inventory-cards-container">
          {vehicles.map((v) => (
            <div className="inventory-card" key={rowKey(v)}>
              <div className="card-header">
                <h3>{v.name}</h3>
              </div>

              <p className="flex-row"><CarOutlined /> <strong>Tipo:</strong> {v.type || "—"}</p>
              <p><strong>Marca:</strong> {v.brand || "—"}</p>
              <p><strong>Modelo:</strong> {v.model || "—"}</p>
              <p><strong>Patente:</strong> {(v.plate || "").toUpperCase() || "—"}</p>
              <p><strong>Capacidad:</strong> {v.capacity != null ? numberFmt(v.capacity) : "—"}</p>
              <p><strong>Estado:</strong> {statusTag(v.status)}</p>

              <div style={{ marginTop: 12 }}>
                <Button type="primary" block onClick={() => handleEnable(getId(v))}>
                  Habilitar Vehículo
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DisabledVehicles;

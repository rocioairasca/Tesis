import React, { useState, useEffect, useCallback } from "react";
import { Table, Button, Space, Popconfirm, notification, Row, Col, Tooltip } from "antd";
import { LeftOutlined, CheckOutlined, EnvironmentOutlined, AimOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";

// helpers
const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.name ?? String(Math.random());

const DisabledLots = () => {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const fetchDisabledLots = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/lots/disabled");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setLots(list);
    } catch (error) {
      console.error("→ disabled lots list error:", error);
      notification.error({ message: "Error al cargar lotes deshabilitados" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisabledLots();
  }, [fetchDisabledLots]);

  const handleEnable = async (id) => {
    try {
      await api.put(`/lots/enable/${id}`);
      notification.success({ message: "Lote habilitado exitosamente" });
      fetchDisabledLots();
    } catch (error) {
      console.error("→ enable lot error:", error);
      notification.error({ message: "Error al habilitar lote" });
    }
  };

  const columns = [
    {
      title: "#",
      dataIndex: "index",
      key: "index",
      render: (_, __, index) => index + 1,
      width: 64,
    },
    { title: "Nombre del Lote", dataIndex: "name", key: "name" },
    { title: "Área Total (ha)", dataIndex: "area", key: "area" },
    {
      title: "Acciones",
      key: "actions",
      width: 72,
      render: (_, record) => (
        <Space size="small">
          <Popconfirm
            title="¿Volver a habilitar este lote?"
            okText="Sí"
            cancelText="No"
            onConfirm={() => handleEnable(getId(record))}
          >
            <Tooltip title="Habilitar">
              <Button
                type="text"
                shape="circle"
                aria-label="Habilitar"
                icon={<CheckOutlined style={{ color: "#52c41a" }} />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Lotes Deshabilitados</h2>
        </Col>
        <Col>
          <Button
            type="default"
            icon={<LeftOutlined />}
            shape="circle"
            onClick={() => navigate("/lotes")}
            style={{ borderColor: "#95ba56" }}
          />
        </Col>
      </Row>

      {/* Tabla (desktop) */}
      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={lots}
          loading={loading}
          pagination={{ pageSize: 5, position: ["bottomCenter"] }}
          rowKey={rowKey}
        />
      )}

      {/* Cards (mobile) */}
      {isMobile && (
        <div className="inventory-cards-container">
          {lots.map((lot) => (
            <div key={rowKey(lot)} className="inventory-card">
              <div className="card-header">
                <h3>{lot.name}</h3>
              </div>

              <p>
                <AimOutlined style={{ marginRight: 8 }} /> <strong>Área:</strong> {lot.area} ha
              </p>
              <p>
                <EnvironmentOutlined style={{ marginRight: 8 }} /> <strong>Ubicación:</strong>{" "}
                {lot.location ? "Asignada" : "No asignada"}
              </p>

              <Button type="primary" block style={{ marginTop: 12 }} onClick={() => handleEnable(getId(lot))}>
                Habilitar Lote
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DisabledLots;

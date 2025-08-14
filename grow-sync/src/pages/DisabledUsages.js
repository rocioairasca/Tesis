import React, { useState, useEffect, useCallback } from "react";
import { Table, Button, Row, Col, notification, Tooltip } from "antd";
import { ArrowLeftOutlined, CalendarOutlined, CheckOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import useIsMobile from "../hooks/useIsMobile";
import { Package, MapPin, Ruler } from "phosphor-react";
import api from "../services/apiClient";

// helpers
const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? `${r?.product_id}-${r?.date}`;
const parseLotIds = (lot_ids) => {
  if (!lot_ids) return [];
  if (Array.isArray(lot_ids)) return lot_ids;
  try { return JSON.parse(lot_ids); } catch { return []; }
};

const DisabledUsages = () => {
  const [usages, setUsages] = useState([]);
  const [products, setProducts] = useState([]);
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const fetchDisabledUsages = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/usages/disabled");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setUsages(list);
    } catch (error) {
      console.error("→ disabled usages list error:", error);
      notification.error({ message: "Error al cargar registros deshabilitados" });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await api.get("/products");
      setProducts(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch (error) {
      console.error("→ products list error:", error);
      notification.error({ message: "Error al cargar productos" });
    }
  }, []);

  // para mostrar nombres de lotes en lugar de IDs
  const fetchLots = useCallback(async () => {
    try {
      const { data } = await api.get("/lots");
      setLots(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch (error) {
      console.error("→ lots list error:", error);
      // opcional: notification.warning({ message: "No se pudo cargar la lista de lotes" });
    }
  }, []);

  useEffect(() => {
    fetchDisabledUsages();
    fetchProducts();
    fetchLots();
  }, [fetchDisabledUsages, fetchProducts, fetchLots]);

  const handleEnable = async (id) => {
    try {
      await api.put(`/usages/enable/${id}`);
      notification.success({ message: "Registro de uso habilitado exitosamente" });
      fetchDisabledUsages();
    } catch (error) {
      console.error("→ enable usage error:", error);
      notification.error({ message: "Error al habilitar registro de uso" });
    }
  };

  // helpers UI
  const productName = (id) => products.find((p) => p.id === id)?.name || "-";
  const lotNames = (usage) => {
    // preferimos usage_lots -> lot_id -> nombre; si no, parseamos lot_ids
    if (Array.isArray(usage?.usage_lots) && usage.usage_lots.length) {
      return usage.usage_lots
        .map((l) => lots.find((x) => x.id === l.lot_id)?.name || l.lot_id)
        .join(", ");
    }
    const ids = parseLotIds(usage?.lot_ids);
    return ids.map((id) => lots.find((x) => x.id === id)?.name || id).join(", ");
  };

  const columns = [
    {
      title: "#",
      dataIndex: "index",
      key: "index",
      width: 64,
      render: (_, __, index) => index + 1,
    },
    {
      title: "Producto",
      dataIndex: "product_id",
      key: "product_id",
      render: (id) => productName(id),
    },
    {
      title: "Cantidad",
      dataIndex: "amount_used",
      key: "amount_used",
      render: (v, record) => `${v} ${record.unit}`,
    },
    {
      title: "Lotes",
      key: "lot_ids",
      render: (_, record) => lotNames(record) || "-",
    },
    {
      title: "Área Total (ha)",
      dataIndex: "total_area",
      key: "total_area",
      render: (v) => (v != null ? `${v} ha` : "-"),
    },
    {
      title: "Fecha",
      dataIndex: "date",
      key: "date",
      render: (text) => (text ? dayjs(text).format("DD/MM/YYYY") : "-"),
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
        <Col>
          <h2>Registros de Uso Deshabilitados</h2>
        </Col>
        <Col>
          {!isMobile ? (
            <Button onClick={() => navigate("/usage")}>← Volver a Registros de Uso</Button>
          ) : (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/usage")}
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
          dataSource={usages}
          loading={loading}
          pagination={{ pageSize: 5, position: ["bottomCenter"] }}
          rowKey={rowKey}
        />
      )}

      {/* Cards (mobile) */}
      {isMobile && (
        <div className="inventory-cards-container">
          {usages.map((usage) => {
            const date = usage.date ? dayjs(usage.date).format("DD/MM/YYYY") : "-";
            return (
              <div className="inventory-card" key={rowKey(usage)}>
                <div className="card-header">
                  <h3>{productName(usage.product_id)}</h3>
                </div>

                <p className="flex-row">
                  <Package size={18} style={{ marginRight: 8 }} /> <strong>Cantidad:</strong>{" "}
                  {usage.amount_used} {usage.unit}
                </p>
                <p className="flex-row">
                  <MapPin size={18} style={{ marginRight: 8 }} /> <strong>Lotes:</strong>{" "}
                  {lotNames(usage) || "-"}
                </p>
                <p className="flex-row">
                  <Ruler size={18} style={{ marginRight: 8 }} /> <strong>Área Total:</strong>{" "}
                  {usage.total_area} ha
                </p>
                <p>
                  <CalendarOutlined style={{ marginRight: 8 }} /> <strong>Fecha:</strong> {date}
                </p>

                <div style={{ marginTop: 12 }}>
                  <Button type="primary" block onClick={() => handleEnable(getId(usage))}>
                    Habilitar Registro
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DisabledUsages;

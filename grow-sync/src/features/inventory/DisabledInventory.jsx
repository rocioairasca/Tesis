import {unitLabel} from '../../utils/inventoryUnits';
import { expirationLabel, isExpired, soon as isExpiringSoon } from './inventoryModel.mjs';
import React, { useState, useEffect, useCallback } from "react";
import { Table, Button, notification, Row, Col, Tag, Tooltip } from "antd";
import {
  LeftOutlined,
  CalendarOutlined,
  DollarOutlined,
  InboxOutlined,
  AppstoreOutlined,
  ExclamationCircleOutlined,
  CheckOutlined,
} from '../../components/AppIcons';
import { useNavigate } from "react-router-dom";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";

// ---- helpers de formato (mismos criterios que Inventory) ----
const formatUnit = unitLabel;

const formatCurrency = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
};

const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.name;

const DisabledInventory = () => {
  const [disabledProducts, setDisabledProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canEnable = hasPermission(currentUser, PERMISSIONS.INVENTORY_ENABLE);

  const fetchDisabledProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/products/disabled");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setDisabledProducts(list);
    } catch (error) {
      console.error("→ disabled products list error:", error);
      notification.error({ message: "Error al cargar productos deshabilitados" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisabledProducts();
  }, [fetchDisabledProducts]);

  const handleEnable = async (id) => {
    try {
      await api.put(`/products/enable/${id}`);
      notification.success({ message: "Producto habilitado exitosamente" });
      fetchDisabledProducts();
    } catch (error) {
      console.error("→ enable product error:", error);
      notification.error({ message: "Error al habilitar producto" });
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
    { title: "Nombre", dataIndex: "name", key: "name" },
    { title: "Cantidad Total", dataIndex: "total_quantity", key: "total_quantity" },
    {
      title: "Cantidad Disponible",
      dataIndex: "available_quantity",
      key: "available_quantity",
      render: (v) => (v > 0 ? v : <Tag color="red">Agotado</Tag>),
    },
    {
      title: "Unidad",
      dataIndex: "unit",
      key: "unit",
      render: (u) => formatUnit(u),
    },
    {
      title: "Precio",
      dataIndex: "price",
      key: "price",
      render: (v) => formatCurrency(v),
    },
    {
      title: "Fecha de Vencimiento",
      dataIndex: "expiration_date",
      key: "expiration_date",
      render: (_, d) => {
        const expired = isExpired(d);
        const soon = isExpiringSoon(d);
        return (
          <span>
            {expirationLabel(d)}{" "}
            {expired && <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />}
            {!expired && soon && <ExclamationCircleOutlined style={{ color: "#faad14" }} />}
          </span>
        );
      },
    },
    canEnable && {
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
  ].filter(Boolean);

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Productos Deshabilitados</h2>
        </Col>
        <Col>
          <Button
            icon={<LeftOutlined />}
            onClick={() => navigate("/inventario")}
            shape="circle"
            type="default"
            style={{ borderColor: "#95ba56" }}
          />
        </Col>
      </Row>

      {/* Tabla (desktop) */}
      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={disabledProducts}
          loading={loading}
          pagination={{ pageSize: 5, position: ["bottomCenter"] }}
          rowKey={rowKey}
        />
      )}

      {/* Cards (mobile) */}
      {isMobile && (
        <div className="inventory-cards-container">
          {disabledProducts.map((product) => (
            <div className="inventory-card" key={rowKey(product)}>
              <div className="card-header">
                <h3>{product.name}</h3>
              </div>

              <p><AppstoreOutlined /> <strong>Tipo:</strong> {product.type}</p>
              <p><InboxOutlined /> <strong>Total:</strong> {product.total_quantity} {formatUnit(product.unit)}</p>

              <p>
                <InboxOutlined /> <strong>Disponible:</strong>{" "}
                <Tag
                  color={
                    product.available_quantity === 0
                      ? "red"
                      : product.available_quantity < product.total_quantity * 0.3
                      ? "orange"
                      : "green"
                  }
                >
                  {product.available_quantity} {formatUnit(product.unit)}
                </Tag>
              </p>

              <p><DollarOutlined /> <strong>Precio:</strong> {formatCurrency(product.price)}</p>

              <p>
                <CalendarOutlined /> <strong>Vence:</strong>{" "}
                {expirationLabel(product)}{" "}
                {isExpired(product) && (
                  <ExclamationCircleOutlined style={{ color: "#ff4d4f", marginLeft: 6 }} />
                )}
                {!isExpired(product) && isExpiringSoon(product) && (
                  <ExclamationCircleOutlined style={{ color: "#faad14", marginLeft: 6 }} />
                )}
              </p>

              {canEnable && <div style={{ marginTop: 12 }}>
                <Button type="primary" block onClick={() => handleEnable(getId(product))}>
                  Habilitar Producto
                </Button>
              </div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DisabledInventory;

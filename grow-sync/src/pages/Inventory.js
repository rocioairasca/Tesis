import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Table, Button, Drawer, Form, Input, InputNumber, Select, Space,
  Popconfirm, notification, Row, Col, Tag, Dropdown, Tooltip
} from "antd";
import {
  EditOutlined, DeleteOutlined, PlusOutlined, MoreOutlined,
  CalendarOutlined, DollarOutlined, InboxOutlined, AppstoreOutlined, ExclamationCircleOutlined
} from "@ant-design/icons";
import api from "../services/apiClient";
import useIsMobile from "../hooks/useIsMobile";

const ROLE_OPTIONS = [
  { value: "líquido", label: "Líquido" },
  { value: "polvo", label: "Polvo" },
];

// ---- helpers de formato ----
const UNIT_DISPLAY = {
  litros: "L", litro: "L", lt: "L", l: "L", L: "L",
  kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
};
const formatUnit = (u) => UNIT_DISPLAY[String(u || "").toLowerCase()] || (u || "-");

const formatCurrency = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
};

const pad2 = (n) => String(n).padStart(2, "0");
const formatDateDDMMYYYY = (d) => {
  if (!d) return "-";
  const dt = new Date(d);
  if (isNaN(dt)) return "-";
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};

const daysTo = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.ceil((dt - today) / (1000 * 60 * 60 * 24));
};
const isExpired = (d) => { const x = daysTo(d); return x !== null && x <= 0; };
const isExpiringSoon = (d, win = 15) => { const x = daysTo(d); return x !== null && x > 0 && x <= win; };


const Inventory = () => {
  // ------------------------- STATE -------------------------
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const notifiedRef = useRef(false);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [unit, setUnit] = useState("");
  const [form] = Form.useForm();

  const isMobile = useIsMobile();

  const getId = (r) => r?.id ?? r?._id;
  const rowKey = (r) => getId(r) ?? r?.name;

  // ------------------------- API -------------------------
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/products");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setProducts(list);

      // Notificar solo una vez por montaje
      if (!notifiedRef.current) {
        const expired = list.filter(p => isExpired(p.acquisition_date));
        const soon = list.filter(p => isExpiringSoon(p.acquisition_date));

        if (expired.length) {
          notification.error({
            message: "Productos vencidos",
            description:
              expired.slice(0, 5).map(p => p.name).join(", ") +
              (expired.length > 5 ? ` y ${expired.length - 5} más` : ""),
            duration: 6,
          });
        }
        if (soon.length) {
          notification.warning({
            message: "Vencen pronto (≤15 días)",
            description:
              soon.slice(0, 5).map(p => p.name).join(", ") +
              (soon.length > 5 ? ` y ${soon.length - 5} más` : ""),
            duration: 6,
          });
        }
        notifiedRef.current = true;
      }
    } catch (error) {
      console.error("→ products list error:", error);
      notification.error({ message: "Error al cargar productos" });
    } finally {
      setLoading(false);
    }
  }, []); 

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]); 


  // ------------------------- HANDLERS -------------------------
  const openDrawer = (product = null) => {
    if (!product) {
      setEditingProduct(null);
      setUnit("");
      form.resetFields();
      form.setFieldsValue({
        type: undefined,
        unit: "",
        acquisition_date: null,
        total_quantity: undefined,
        price: undefined,
        name: "",
      });
    } else {
      setEditingProduct(product);
      const acquisitionDate = product.acquisition_date
        ? new Date(product.acquisition_date).toISOString().split("T")[0]
        : null;

      const type = ["líquido", "polvo"].includes(product.type)
        ? product.type
        : undefined;

      form.setFieldsValue({
        name: product.name ?? "",
        type,
        unit: product.unit ?? (type === "líquido" ? "litros" : "kg"),
        total_quantity: product.total_quantity ?? undefined,
        price: product.price ?? undefined,
        acquisition_date: acquisitionDate,
      });
      setUnit(product.unit ?? (type === "líquido" ? "litros" : "kg"));
    }
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingProduct(null);
    form.resetFields();
  };

  const handleSubmit = async (values) => {
    try {
      const payload = {
        ...values,
        unit: values.unit || (values.type === "líquido" ? "litros" : "kg"),
        // si es creación, la disponible = total; si es edición, se conserva
        available_quantity: editingProduct
          ? editingProduct.available_quantity
          : values.total_quantity,
      };

      const id = getId(editingProduct);

      if (editingProduct && id) {
        await api.put(`/products/${id}`, payload);
        notification.success({ message: "Producto actualizado exitosamente" });
      } else {
        await api.post("/products", payload);
        notification.success({ message: "Producto creado exitosamente" });
      }

      fetchProducts();
      closeDrawer();
    } catch (error) {
      console.error("→ save product error:", error);
      notification.error({
        message: error?.response?.data?.message || "Error al guardar producto",
      });
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/products/${id}`);
      notification.success({ message: "Producto deshabilitado exitosamente" });
      fetchProducts();
    } catch (error) {
      console.error("→ disable product error:", error);
      notification.error({
        message:
          error?.response?.data?.message || "Error al deshabilitar producto",
      });
    }
  };

  // ------------------------- TABLE CONFIG -------------------------
  const columns = [
    {
      title: "#",
      dataIndex: "index",
      key: "index",
      render: (_, __, index) => index + 1,
      width: 64,
    },
    { title: "Nombre", dataIndex: "name", key: "name" },
    {
      title: "Cantidad Total",
      dataIndex: "total_quantity",
      key: "total_quantity",
    },
    {
      title: "Cantidad Disponible",
      dataIndex: "available_quantity",
      key: "available_quantity",
      render: (v) => (v > 0 ? v : <Tag color="red">Agotado</Tag>),
    },
    { title: "Unidad", dataIndex: "unit", key: "unit",
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
      dataIndex: "acquisition_date",
      key: "acquisition_date",
      render: (d) => {
        const expired = isExpired(d);
        const soon = isExpiringSoon(d);
        return (
          <Space size={6}>
            <span>{formatDateDDMMYYYY(d)}</span>
            {expired && (
              <Tooltip title="Vencido">
                <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />
              </Tooltip>
            )}
            {!expired && soon && (
              <Tooltip title="Próximo a vencer">
                <ExclamationCircleOutlined style={{ color: "#faad14" }} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: "Acciones",
      key: "actions",
      width: 96,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Editar">
            <Button
              type="text"
              shape="circle"
              icon={<EditOutlined />}
              aria-label="Editar"
              onClick={() => openDrawer(record)}
            />
          </Tooltip>

          <Popconfirm
            title="¿Deshabilitar este producto?"
            okText="Sí"
            cancelText="No"
            onConfirm={() => handleDelete(getId(record))}
          >
            <Tooltip title="Deshabilitar">
              <Button
                type="text"
                danger
                shape="circle"
                icon={<DeleteOutlined />}
                aria-label="Deshabilitar"
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const menuItems = [
    {
      key: "1",
      label: (
        <span onClick={() => (window.location.href = "/productos-deshabilitados")}>
          Ver productos deshabilitados
        </span>
      ),
    },
  ];

  // ------------------------- RENDER -------------------------
  return (
    <div style={{ padding: 12 }}>
      <Row
        justify="space-between"
        align="middle"
        style={{ marginBottom: 12, marginTop: isMobile ? 8 : 24 }}
      >
        <Col>
          <h2>Gestión de Inventario</h2>
        </Col>
        <Col>
          <Space>
            {isMobile && (
              <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            )}
            {!isMobile && (
              <Space>
                <Button onClick={() => (window.location.href = "/productos-deshabilitados")}>
                  Ver Productos Deshabilitados
                </Button>
                <Button type="primary" onClick={() => openDrawer(null)}>
                  Agregar Producto
                </Button>
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {/* Tabla solo en desktop */}
      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={products}
          loading={loading}
          pagination={{ pageSize: 5, position: ["bottomCenter"] }}
          rowKey={rowKey}
        />
      )}

      {/* Cards solo en mobile */}
      {isMobile && (
        <div className="inventory-cards-container">
          {products.map((product) => {
            const expiration = product.acquisition_date
              ? new Date(product.acquisition_date)
              : null;
            const today = new Date();
            const diffDays =
              expiration != null
                ? Math.ceil((expiration - today) / (1000 * 60 * 60 * 24))
                : null;

            return (
              <div className="inventory-card" key={rowKey(product)}>
                <div className="card-header">
                  <h3>{product.name}</h3>
                  <div className="card-icons">
                    <EditOutlined onClick={() => openDrawer(product)} />
                    <DeleteOutlined onClick={() => handleDelete(getId(product))} />
                  </div>
                </div>

                <p>
                  <AppstoreOutlined /> <strong>Tipo:</strong> {product.type}
                </p>
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
                  {formatDateDDMMYYYY(product.acquisition_date)}{" "}
                  {/* ícono de alerta en mobile */}
                  {isExpired(product.acquisition_date) && (
                    <ExclamationCircleOutlined style={{ color: "#ff4d4f", marginLeft: 6 }} />
                  )}
                  {!isExpired(product.acquisition_date) && isExpiringSoon(product.acquisition_date) && (
                    <ExclamationCircleOutlined style={{ color: "#faad14", marginLeft: 6 }} />
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <Drawer
        title={editingProduct ? "Editar Producto" : "Agregar Producto"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 400}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnClose
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Nombre"
            rules={[{ required: true, message: "Por favor ingresá el nombre del producto." }]}
          >
            <Input placeholder="Por favor ingresá el nombre del producto." />
          </Form.Item>

          <Form.Item
            name="type"
            label="Tipo"
            rules={[{ required: true, message: "Por favor seleccioná el tipo." }]}
          >
            <Select
              allowClear
              placeholder="Seleccioná el tipo de producto"
              options={ROLE_OPTIONS} // ✅ AntD v5
              onChange={(value) => {
                const nextUnit = value === "líquido" ? "litros" : "kg";
                form.setFieldsValue({ unit: nextUnit });
                setUnit(nextUnit);
              }}
            />
          </Form.Item>

          <Form.Item
            name="total_quantity"
            label="Cantidad Total"
            rules={[{ required: true, message: "Por favor ingresá la cantidad total." }]}
          >
            <InputNumber
              min={0}
              style={{ width: "100%" }}
              placeholder="Ingresá la cantidad total."
              disabled={!!editingProduct}
            />
          </Form.Item>

          <Form.Item name="unit" label="Unidad">
            <Input disabled value={unit} />
          </Form.Item>

          <Form.Item
            name="price"
            label="Precio"
            rules={[{ required: true, message: "Por favor ingresá el precio." }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} prefix="$" placeholder="Ingresá el precio." />
          </Form.Item>

          <Form.Item
            name="acquisition_date"
            label="Fecha de Vencimiento"
            rules={[
              { required: true, message: "Por favor ingresá la fecha de vencimiento." },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  const inputTs = new Date(value).getTime();
                  const todayMidnight = new Date().setHours(0, 0, 0, 0);
                  return inputTs >= todayMidnight
                    ? Promise.resolve()
                    : Promise.reject(new Error("La fecha de vencimiento no puede ser anterior a la fecha actual."));
                },
              },
            ]}
          >
            <Input type="date" placeholder="dd/mm/aaaa" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingProduct ? "Actualizar Producto" : "Guardar Producto"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>

      {isMobile && !isDrawerOpen && (
        <div className="fab-button" onClick={() => openDrawer(null)}>
          <PlusOutlined />
        </div>
      )}
    </div>
  );
};

export default Inventory;


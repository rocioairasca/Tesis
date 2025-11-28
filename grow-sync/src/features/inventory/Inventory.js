/**
 * Feature: Gestión de Inventario (Productos)
 * Ubicación: src/features/inventory/Inventory.js
 * Descripción:
 *  Contenedor principal para la gestión de productos/insumos.
 *  Maneja el estado (lista, loading, alertas de vencimiento) y la lógica CRUD.
 * 
 * Refactorización:
 *  - Extracción de vistas de tabla (Desktop) y lista (Mobile) a componentes.
 *  - Lógica de alertas de vencimiento centralizada en el fetch.
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Button, Drawer, Form, Input, InputNumber, Select, Space,
  notification, Row, Col, Dropdown
} from "antd";
import {
  PlusOutlined, MoreOutlined
} from "@ant-design/icons";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import ProductTable from "./components/ProductTable";
import ProductListMobile from "./components/ProductListMobile";

const CATEGORY_OPTIONS = [
  { value: "semillas", label: "Semillas" },
  { value: "agroquimicos", label: "Agroquímicos" },
  { value: "fertilizantes", label: "Fertilizantes" },
  { value: "combustible", label: "Combustible" },
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
  const today = new Date(); today.setHours(0, 0, 0, 0);
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
        category: undefined,
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

      form.setFieldsValue({
        name: product.name ?? "",
        category: product.category,
        unit: product.unit ?? "kg",
        total_quantity: product.total_quantity ?? undefined,
        price: product.price ?? undefined,
        acquisition_date: acquisitionDate,
      });
      setUnit(product.unit ?? "kg");
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
        unit: values.unit || "kg",
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
        <ProductTable
          products={products}
          loading={loading}
          onEdit={openDrawer}
          onDelete={handleDelete}
          rowKey={rowKey}
          getId={getId}
          formatUnit={formatUnit}
          formatCurrency={formatCurrency}
          formatDateDDMMYYYY={formatDateDDMMYYYY}
          isExpired={isExpired}
          isExpiringSoon={isExpiringSoon}
        />
      )}

      {/* Cards solo en mobile */}
      {isMobile && (
        <ProductListMobile
          products={products}
          onEdit={openDrawer}
          onDelete={handleDelete}
          rowKey={rowKey}
          getId={getId}
          formatUnit={formatUnit}
          formatCurrency={formatCurrency}
          formatDateDDMMYYYY={formatDateDDMMYYYY}
          isExpired={isExpired}
          isExpiringSoon={isExpiringSoon}
        />
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
            name="category"
            label="Categoría"
            rules={[{ required: true, message: "Por favor seleccioná la categoría." }]}
          >
            <Select
              allowClear
              placeholder="Seleccioná la categoría"
              options={CATEGORY_OPTIONS}
              onChange={(value) => {
                let nextUnit = "kg";
                if (value === "combustible" || value === "agroquimicos") nextUnit = "litros";
                if (value === "semillas") nextUnit = "bolsas";

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



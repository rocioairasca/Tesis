/**
 * Feature: Gestión de Inventario (Productos)
 * Ubicación: src/features/inventory/Inventory.jsx
 * Descripción:
 *  Contenedor principal para la gestión de productos/insumos.
 *  Maneja el estado (lista, loading, alertas de vencimiento) y la lógica CRUD.
 * 
 * Refactorización:
 *  - Extracción de vistas de tabla (Desktop) y lista (Mobile) a componentes.
 *  - Lógica de alertas de vencimiento centralizada en el fetch.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Button, Drawer, Form, Input, InputNumber, Select, Space,
  notification, Row, Col, Dropdown, Modal, Typography
} from "antd";
import {
  PlusOutlined, MoreOutlined
} from '../../components/AppIcons';
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import ProductTable from "./components/ProductTable";
import ProductListMobile from "./components/ProductListMobile";

import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";
import { getUserFriendlyError } from "../../utils/userFriendlyErrors";

const CATEGORY_OPTIONS = [
  { value: "semillas", label: "Semillas" },
  { value: "agroquimicos", label: "Agroquímicos" },
  { value: "fertilizantes", label: "Fertilizantes" },
  { value: "combustible", label: "Combustible" },
];

const UNIT_OPTIONS_BY_CATEGORY = {
  semillas: [
    { value: "bolsas", label: "Bolsas" },
    { value: "kg", label: "kg" },
  ],
  agroquimicos: [
    { value: "litros", label: "Litros" },
    { value: "kg", label: "kg" },
  ],
  fertilizantes: [
    { value: "kg", label: "kg" },
    { value: "litros", label: "Litros" },
  ],
  combustible: [
    { value: "litros", label: "Litros" },
  ],
};

const defaultUnitForCategory = (category) => UNIT_OPTIONS_BY_CATEGORY[category]?.[0]?.value || "kg";

// ---- helpers de formato ----
const UNIT_DISPLAY = {
  litros: "L", litro: "L", lt: "L", l: "L", L: "L",
  kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
};
const formatUnit = (u) => UNIT_DISPLAY[String(u || "").toLowerCase()] || (u || "-");

const pad2 = (n) => String(n).padStart(2, "0");
const formatDateDDMMYYYY = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return "—";
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

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const isLowStock = (product) => {
  const available = Number(product.available_quantity || 0);
  const total = Number(product.total_quantity || 0);
  return total > 0 && available > 0 && available <= total * 0.1;
};

const currentUser = JSON.parse(localStorage.getItem("user") || "null");

const canCreate = hasPermission(currentUser, PERMISSIONS.INVENTORY_CREATE);
const canViewDisabled = hasPermission(currentUser, PERMISSIONS.INVENTORY_VIEW_DISABLED);

const Inventory = () => {
  // ------------------------- STATE -------------------------
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const notifiedRef = useRef(false);
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [tablePagination, setTablePagination] = useState({ current: 1, pageSize: 10 });

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [stockProduct, setStockProduct] = useState(null);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [addStockLoading, setAddStockLoading] = useState(false);
  const [form] = Form.useForm();
  const [stockForm] = Form.useForm();
  const selectedCategory = Form.useWatch("category", form);
  const unitOptions = UNIT_OPTIONS_BY_CATEGORY[selectedCategory] || [];

  const isMobile = useIsMobile();

  const getId = (r) => r?.id ?? r?._id;
  const rowKey = (r) => getId(r) ?? r?.name;
  const expirationValue = (product) => product?.expiration_date || product?.acquisition_date || null;

  const categoryOptions = useMemo(() => {
    const categories = [...new Set(products.map((product) => product.category).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));
    return [
      { value: "all", label: "Todas las categorías" },
      ...categories.map((category) => ({
        value: category,
        label: CATEGORY_OPTIONS.find((option) => option.value === category)?.label || category,
      })),
    ];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const search = normalizeText(searchText);
    const withIndex = products.map((product, index) => ({ product, index }));

    return withIndex
      .filter(({ product }) => {
        const matchesSearch = !search
          || normalizeText(product.name).includes(search)
          || normalizeText(product.category).includes(search);
        const matchesCategory = categoryFilter === "all" || product.category === categoryFilter;
        const available = Number(product.available_quantity || 0);
        const matchesStock =
          stockFilter === "all"
          || (stockFilter === "in_stock" && available > 0)
          || (stockFilter === "out_of_stock" && available <= 0)
          || (stockFilter === "low_stock" && isLowStock(product));

        return matchesSearch && matchesCategory && matchesStock;
      })
      .sort((a, b) => {
        const nameCompare = String(a.product.name || "").localeCompare(
          String(b.product.name || ""),
          "es",
          { sensitivity: "base" }
        );
        return nameCompare || a.index - b.index;
      })
      .map(({ product }) => product);
  }, [categoryFilter, products, searchText, stockFilter]);

  const resetTablePage = () => {
    setTablePagination((current) => ({ ...current, current: 1 }));
  };

  // ------------------------- API -------------------------
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/products");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setProducts(list);

      // Notificar solo una vez por montaje
      if (!notifiedRef.current) {
        const expired = list.filter(p => isExpired(expirationValue(p)));
        const soon = list.filter(p => isExpiringSoon(expirationValue(p)));

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
      notification.error({ message: getUserFriendlyError(error, "No se pudieron cargar los productos.") });
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
      form.resetFields();
      form.setFieldsValue({
        category: undefined,
        unit: "",
        acquisition_date: null,
        total_quantity: undefined,
        name: "",
      });
    } else {
      setEditingProduct(product);
      const productExpiration = expirationValue(product);
      const acquisitionDate = productExpiration
        ? new Date(productExpiration).toISOString().split("T")[0]
        : null;

      form.setFieldsValue({
        name: product.name ?? "",
        category: product.category,
        unit: product.unit ?? "kg",
        total_quantity: product.total_quantity ?? undefined,
        acquisition_date: acquisitionDate,
      });
    }
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingProduct(null);
    form.resetFields();
  };

  const openAddStockModal = (product) => {
    setStockProduct(product);
    stockForm.resetFields();
    setIsStockModalOpen(true);
  };

  const closeAddStockModal = () => {
    if (addStockLoading) return;
    setIsStockModalOpen(false);
    setStockProduct(null);
    stockForm.resetFields();
  };

  const handleSubmit = async (values) => {
    try {
      const expirationDate = values.acquisition_date || null;
      const payload = {
        ...values,
        unit: values.unit || "kg",
        acquisition_date: expirationDate,
        expiration_date: expirationDate,
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
        message: getUserFriendlyError(error, "No se pudo guardar el producto."),
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
        message: getUserFriendlyError(error, "No se pudo deshabilitar el producto."),
      });
    }
  };

  const handleAddStock = async (values) => {
    if (addStockLoading || !stockProduct) return;

    try {
      setAddStockLoading(true);
      await api.patch(`/products/${getId(stockProduct)}/add-stock`, {
        quantity: values.quantity,
      });
      notification.success({ message: "Stock agregado exitosamente" });
      await fetchProducts();
      setIsStockModalOpen(false);
      setStockProduct(null);
      stockForm.resetFields();
    } catch (error) {
      console.error("→ add stock error:", error);
      notification.error({
        message: getUserFriendlyError(error, "No se pudo agregar stock."),
      });
    } finally {
      setAddStockLoading(false);
    }
  };

  const menuItems = [
    canViewDisabled && {
      key: "1",
      label: (
        <span onClick={() => (window.location.href = "/productos-deshabilitados")}>
          Ver productos deshabilitados
        </span>
      ),
    },
  ].filter(Boolean);

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
            {isMobile && menuItems.length > 0 && (
              <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            )}
          </Space>
        </Col>
      </Row>

      <Row
        gutter={[12, 12]}
        align="middle"
        justify="space-between"
        style={{ marginBottom: 16 }}
      >
        <Col xs={24} lg={14}>
          <Row gutter={[8, 8]}>
            <Col xs={24} md={10}>
              <Input.Search
                allowClear
                placeholder="Buscar producto..."
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  resetTablePage();
                }}
              />
            </Col>
            <Col xs={24} sm={12} md={7}>
              <Select
                value={categoryFilter}
                options={categoryOptions}
                onChange={(value) => {
                  setCategoryFilter(value);
                  resetTablePage();
                }}
                style={{ width: "100%" }}
              />
            </Col>
            <Col xs={24} sm={12} md={7}>
              <Select
                value={stockFilter}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "in_stock", label: "Con stock" },
                  { value: "out_of_stock", label: "Sin stock" },
                  { value: "low_stock", label: "Stock bajo" },
                ]}
                onChange={(value) => {
                  setStockFilter(value);
                  resetTablePage();
                }}
                style={{ width: "100%" }}
              />
            </Col>
          </Row>
        </Col>
        {!isMobile && (
          <Col>
            <Space wrap>
              {canViewDisabled && (
                <Button onClick={() => (window.location.href = "/productos-deshabilitados")}>
                  Ver Productos Deshabilitados
                </Button>
              )}
              {canCreate && (
                <Button type="primary" onClick={() => openDrawer(null)}>
                  Agregar Producto
                </Button>
              )}
            </Space>
          </Col>
        )}
      </Row>

      {/* Tabla solo en desktop */}
      {!isMobile && (
        <ProductTable
          products={filteredProducts}
          loading={loading}
          onEdit={openDrawer}
          onAddStock={openAddStockModal}
          onDelete={handleDelete}
          rowKey={rowKey}
          getId={getId}
          formatUnit={formatUnit}
          formatDateDDMMYYYY={formatDateDDMMYYYY}
          isExpired={isExpired}
          isExpiringSoon={isExpiringSoon}
          expirationValue={expirationValue}
          pagination={tablePagination}
          onPaginationChange={(pagination) => {
            setTablePagination({
              current: pagination.current,
              pageSize: 10,
            });
          }}
        />
      )}

      {/* Cards solo en mobile */}
      {isMobile && (
        <ProductListMobile
          products={filteredProducts}
          onEdit={openDrawer}
          onAddStock={openAddStockModal}
          onDelete={handleDelete}
          rowKey={rowKey}
          getId={getId}
          formatUnit={formatUnit}
          formatDateDDMMYYYY={formatDateDDMMYYYY}
          isExpired={isExpired}
          isExpiringSoon={isExpiringSoon}
          expirationValue={expirationValue}
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
        destroyOnHidden
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
                form.setFieldsValue({ unit: defaultUnitForCategory(value) });
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

          <Form.Item
            name="unit"
            label="Unidad"
            rules={[{ required: true, message: "Por favor seleccionÃ¡ la unidad." }]}
          >
            <Select
              placeholder="SeleccionÃ¡ la unidad"
              disabled={!selectedCategory}
              options={unitOptions}
            />
          </Form.Item>

          <Form.Item
            name="acquisition_date"
            label="Fecha de Vencimiento"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  const currentExpiration = expirationValue(editingProduct);
                  if (currentExpiration) {
                    const currentValue = new Date(currentExpiration).toISOString().split("T")[0];
                    if (value === currentValue) return Promise.resolve();
                  }
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

      <Modal
        title="Agregar stock"
        open={isStockModalOpen}
        onCancel={closeAddStockModal}
        footer={null}
        destroyOnHidden
      >
        <Form layout="vertical" form={stockForm} onFinish={handleAddStock}>
          <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 16 }}>
            <Typography.Text strong>{stockProduct?.name || "Producto"}</Typography.Text>
            <Typography.Text type="secondary">
              Stock disponible actual: {stockProduct?.available_quantity ?? 0} {formatUnit(stockProduct?.unit)}
            </Typography.Text>
          </Space>

          <Form.Item
            name="quantity"
            label="Cantidad a agregar"
            rules={[
              { required: true, message: "Ingresá la cantidad a agregar." },
              {
                validator: (_, value) => (
                  Number(value) > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error("La cantidad debe ser mayor a 0."))
                ),
              },
            ]}
          >
            <InputNumber
              min={0}
              addonAfter={formatUnit(stockProduct?.unit)}
              style={{ width: "100%" }}
              disabled={addStockLoading}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={addStockLoading}
              disabled={addStockLoading}
            >
              Confirmar
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {isMobile && !isDrawerOpen && !isStockModalOpen && canCreate && (
        <button
          type="button"
          className="fab-button"
          aria-label="Agregar producto"
          onClick={() => openDrawer(null)}
        >
          <PlusOutlined />
        </button>
      )}
    </div>
  );
};

export default Inventory;



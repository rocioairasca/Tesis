import React, { useState, useEffect, useCallback } from "react";
import {
  Table, Button, Drawer, Form, Input, InputNumber, Select, DatePicker,
  Dropdown, Space, Popconfirm, Row, Col, notification, Tooltip
} from "antd";
import {
  PlusOutlined, MoreOutlined, EditOutlined, DeleteOutlined,
} from "@ant-design/icons";
import {
  Package, MapPin, Ruler, Leaf, User as UserIcon, Calendar as CalendarIcon,
} from "phosphor-react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";

const Usage = () => {
  const [usages, setUsages] = useState([]);
  const [userIndex, setUserIndex] = useState({});
  const [products, setProducts] = useState([]);
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(false);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingUsage, setEditingUsage] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [form] = Form.useForm();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const getId = (r) => r?.id ?? r?._id;
  const rowKey = (r) => getId(r) ?? `${r?.product_id}-${r?.date}`;

  // ---------- fetchers ----------
  const fetchUsages = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/usages");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setUsages(list);
    } catch (error) {
      console.error("→ usages list error:", error);
      notification.error({ message: "Error al cargar registros de uso" });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsersIndex = useCallback(async () => {
    try {
      const { data } = await api.get("/users");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      const idx = {};
      list.forEach((u) => {
        const id = u.id ?? u._id;
        idx[id] = u.full_name || u.nickname || u.username || u.email || String(id);
      });
      setUserIndex(idx);
    } catch (error) {
      console.error("→ users index error:", error);
      // opcional: notification.warning({ message: "No se pudo cargar el índice de usuarios" });
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

  const fetchLots = useCallback(async () => {
    try {
      const { data } = await api.get("/lots");
      setLots(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch (error) {
      console.error("→ lots list error:", error);
      notification.error({ message: "Error al cargar lotes" });
    }
  }, []);

  useEffect(() => {
    fetchUsages();
    fetchProducts();
    fetchLots();
    fetchUsersIndex();
  }, [fetchUsages, fetchProducts, fetchLots, fetchUsersIndex]);

  // Si estamos editando y los productos se cargaron después, sincroniza selectedProduct
  useEffect(() => {
    if (editingUsage && products.length) {
      const p = products.find((x) => x.id === editingUsage.product_id);
      if (p) setSelectedProduct(p);
    }
  }, [editingUsage, products]);

  // ---------- drawer handlers ----------
  const openDrawer = (usage = null) => {
    setEditingUsage(usage);
    setIsDrawerOpen(true);

    if (usage) {
      const p = products.find((x) => x.id === usage.product_id) || null;
      setSelectedProduct(p);

      form.setFieldsValue({
        product_id: usage.product_id,
        amount_used: usage.amount_used,
        unit: usage.unit,
        lot_ids: usage.usage_lots ? usage.usage_lots.map((l) => l.lot_id) : [],
        total_area: usage.total_area,
        previous_crop: usage.previous_crop,
        current_crop: usage.current_crop,
        date: usage.date ? dayjs(usage.date) : null,
      });
    } else {
      setSelectedProduct(null);
      form.resetFields();
    }
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingUsage(null);
    form.resetFields();
  };

  const storedUser = JSON.parse(localStorage.getItem("user"));
  const userId = storedUser?.id;

  // ---------- submit / delete ----------
  const handleSubmit = async (values) => {
    try {
      const payload = {
        product_id: values.product_id,
        amount_used: Number(values.amount_used),
        unit: values.unit,
        lot_ids: values.lot_ids,
        total_area: Number(values.total_area ?? 0),
        previous_crop: values.previous_crop || null,
        current_crop: values.current_crop || null,
        date: values.date.format("YYYY-MM-DD"),
        user_id: userId,
      };

      if (editingUsage && getId(editingUsage)) {
        await api.put(`/usages/${getId(editingUsage)}`, payload);
        notification.success({ message: "Registro de uso actualizado exitosamente" });
      } else {
        await api.post("/usages", payload);
        notification.success({ message: "Registro de uso creado exitosamente" });
      }

      fetchUsages();
      closeDrawer();
    } catch (error) {
      console.error("→ save usage error:", error);
      notification.error({ message: "Error al guardar registro de uso" });
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/usages/${id}`);
      notification.success({ message: "Registro de uso deshabilitado exitosamente" });
      fetchUsages();
    } catch (error) {
      console.error("→ disable usage error:", error);
      notification.error({ message: "Error al deshabilitar registro de uso" });
    }
  };

  // ---------- select handlers ----------
  const handleProductChange = (productId) => {
    const p = products.find((x) => x.id === productId) || null;
    setSelectedProduct(p);
    form.setFieldsValue({
      unit: p?.unit || "",
    });
  };

  const handleLotChange = (selectedLotIds) => {
    const totalArea = selectedLotIds.reduce((acc, id) => {
      const lot = lots.find((l) => l.id === id);
      return acc + Number(lot?.area || 0);
    }, 0);
    form.setFieldsValue({ total_area: Math.round(totalArea * 100) / 100 });
  };

  // ---------- table ----------
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
      render: (id) => products.find((p) => p.id === id)?.name || "-",
    },
    {
      title: "Cantidad",
      dataIndex: "amount_used",
      key: "amount_used",
      render: (value, record) => `${value} ${record.unit}`,
    },
    {
      title: "Lotes",
      dataIndex: "lot_ids",
      key: "lot_ids",
      render: (_, record) => {
        if (!record.usage_lots) return "-";
        const lotNames = record.usage_lots
          .map((l) => lots.find((x) => x.id === l.lot_id)?.name || l.lot_id)
          .join(", ");
        return lotNames || "-";
      },
    },
    {
      title: "Área Total",
      dataIndex: "total_area",
      key: "total_area",
      render: (v) => `${v} ha`,
    },
    { title: "Cultivo Previo", dataIndex: "previous_crop", key: "previous_crop" },
    { title: "Cultivo Actual", dataIndex: "current_crop", key: "current_crop" },
    {
      title: "Usuario",
      key: "user",
      render: (_, record) =>
        userIndex[record.user_id]
          || record.users?.full_name
          || record.users?.nickname
          || record.users?.email
          || "-",
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
      width: 96,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Editar">
            <Button
              type="text"
              shape="circle"
              aria-label="Editar"
              icon={<EditOutlined />}
              onClick={() => openDrawer(record)}
            />
          </Tooltip>
          <Popconfirm
            title="¿Deshabilitar este registro?"
            okText="Sí"
            cancelText="No"
            onConfirm={() => handleDelete(getId(record))}
          >
            <Tooltip title="Deshabilitar">
              <Button
                type="text"
                danger
                shape="circle"
                aria-label="Deshabilitar"
                icon={<DeleteOutlined />}
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
      label: <span onClick={() => navigate("/usages-disabled")}>Ver Registros Deshabilitados</span>,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Registros de Uso</h2>
        </Col>
        <Col>
          <Space>
            {isMobile ? (
              <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            ) : (
              <Space>
                <Button onClick={() => navigate("/usages-disabled")}>
                  Ver Registros Deshabilitados
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
                  Agregar Registro
                </Button>
              </Space>
            )}
          </Space>
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
            const product = products.find((p) => p.id === usage.product_id);
            const lotList = usage.usage_lots
              ? usage.usage_lots
                  .map((l) => lots.find((x) => x.id === l.lot_id)?.name || l.lot_id)
                  .join(", ")
              : "-";
            const date = usage.date ? dayjs(usage.date).format("DD/MM/YYYY") : "-";

            return (
              <div className="inventory-card" key={rowKey(usage)}>
                <div className="card-header">
                  <h3>{product?.name || "Producto"}</h3>
                  <div className="card-icons">
                    <EditOutlined onClick={() => openDrawer(usage)} />
                    <DeleteOutlined onClick={() => handleDelete(getId(usage))} />
                  </div>
                </div>

                <p className="flex-row"><Package size={18} /> <strong>Cantidad:</strong> {usage.amount_used} {usage.unit}</p>
                <p className="flex-row"><MapPin size={18} /> <strong>Lotes:</strong> {lotList}</p>
                <p className="flex-row"><Ruler size={18} /> <strong>Área Total:</strong> {usage.total_area} ha</p>
                <p className="flex-row"><Leaf size={18} /> <strong>Cultivo Previo:</strong> {usage.previous_crop || "-"}</p>
                <p className="flex-row"><Leaf size={18} /> <strong>Cultivo Actual:</strong> {usage.current_crop || "-"}</p>
                <p className="flex-row">
                  <UserIcon size={18} /> <strong>Usuario:</strong> {" "}
                  {userIndex[usage.user_id]
                    || usage.users?.full_name
                    || usage.users?.nickname
                    || usage.users?.email
                    || "-"}
                </p>
                <p className="flex-row"><CalendarIcon size={18} /> <strong>Fecha:</strong> {date}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer crear/editar */}
      <Drawer
        title={editingUsage ? "Editar Registro de Uso" : "Agregar Registro de Uso"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 420}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnClose
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <Form.Item
            name="product_id"
            label="Producto"
            rules={[{ required: true, message: "Seleccioná un producto" }]}
          >
            <Select
              placeholder="Seleccioná un producto"
              options={products.map((p) => ({ value: p.id, label: p.name }))}
              onChange={handleProductChange}
            />
          </Form.Item>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontWeight: 500 }}>Cantidad Usada</label>
            {selectedProduct && (
              <div style={{ fontSize: 13, color: "#888" }}>
                Disponible: <strong>{selectedProduct.available_quantity} {selectedProduct.unit}</strong>
              </div>
            )}
          </div>

          <Form.Item
            name="amount_used"
            rules={[
              { required: true, message: "Ingresá la cantidad usada" },
              {
                validator: (_, value) => {
                  if (selectedProduct && Number(value) > Number(selectedProduct.available_quantity)) {
                    return Promise.reject(`Solo hay ${selectedProduct.available_quantity} disponibles`);
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name="unit"
            label="Unidad"
            rules={[{ required: true, message: "Ingresá la unidad" }]}
          >
            <Input disabled placeholder="Se asigna según el producto seleccionado" />
          </Form.Item>

          <Form.Item
            name="lot_ids"
            label="Seleccionar Lotes"
            rules={[{ required: true, message: "Seleccioná al menos un lote" }]}
          >
            <Select
              mode="multiple"
              placeholder="Seleccioná lotes"
              options={lots.map((l) => ({ value: l.id, label: l.name }))}
              onChange={handleLotChange}
            />
          </Form.Item>

          <Form.Item
            name="total_area"
            label="Área Total (ha)"
            rules={[{ required: true, message: "Ingresá el área total" }]}
          >
            <InputNumber disabled min={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item name="previous_crop" label="Cultivo Previo">
            <Input />
          </Form.Item>

          <Form.Item name="current_crop" label="Cultivo Actual">
            <Input />
          </Form.Item>

          <Form.Item
            name="date"
            label="Fecha de Uso"
            rules={[{ required: true, message: "Seleccioná la fecha" }]}
          >
            <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingUsage ? "Actualizar Registro" : "Registrar Uso"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>

      {isMobile && !isDrawerOpen && (
        <div className="fab-button" onClick={() => openDrawer()}>
          <PlusOutlined />
        </div>
      )}
    </div>
  );
};

export default Usage;


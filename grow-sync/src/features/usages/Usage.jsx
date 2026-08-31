import React, { useState, useEffect, useCallback } from "react";
import {
  Table, Button, Drawer, Form, Input, InputNumber, Select, DatePicker,
  Dropdown, Space, Popconfirm, Row, Col, notification, Tooltip, Descriptions, List, Tag
} from "antd";
import {
  PlusOutlined, MoreOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
} from '../../components/AppIcons';
import {
  Package, MapPin, Ruler, Leaf, Calendar as CalendarIcon,
} from '../../components/AppIcons';
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";
import LotMapPreview from "../planning/components/LotMapPreview";
import { formatActivity } from "../planning/planningDisplay";

const Usage = () => {
  const [usages, setUsages] = useState([]);
  const [products, setProducts] = useState([]);
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(false);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingUsage, setEditingUsage] = useState(null);
  const [viewingUsage, setViewingUsage] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [form] = Form.useForm();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canCreate = hasPermission(currentUser, PERMISSIONS.USAGE_CREATE);
  const canEdit = hasPermission(currentUser, PERMISSIONS.USAGE_EDIT);
  const canDisable = hasPermission(currentUser, PERMISSIONS.USAGE_DISABLE);
  const canViewDisabled = hasPermission(currentUser, PERMISSIONS.USAGE_VIEW_DISABLED);

  const getId = (r) => r?.id ?? r?._id;
  const rowKey = (r) => getId(r) ?? `${r?.product_id}-${r?.date}`;
  const formatArea = (value) => value == null
    ? "-"
    : `${Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ha`;
  const formatQuantity = (value, unit) => `${Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })} ${unit || ""}`.trim();
  const productName = (usage) => usage?.products?.name || products.find((p) => p.id === usage?.product_id)?.name || "Producto";
  const lotNames = (usage) => {
    if (Array.isArray(usage?.lot_names) && usage.lot_names.length) return usage.lot_names.join(", ");
    if (Array.isArray(usage?.usage_lots) && usage.usage_lots.length) {
      return usage.usage_lots
        .map((usageLot) => (
          usageLot?.sub_lot?.name
          || usageLot?.sub_lot_name
          || usageLot?.lot?.name
          || lots.find((x) => x.id === usageLot.lot_id)?.name
          || usageLot.lot_id
        ))
        .filter(Boolean)
        .join(", ");
    }
    return "-";
  };
  const registeredBy = (usage) => (
    usage?.user?.full_name
    || usage?.user?.email
    || "-"
  );
  const usageOrigin = (usage) => usage?.origin || (usage?.source_planning_id ? "Planificación" : "Registro manual");
  const isPlanningUsage = (usage) => Boolean(usage?.source_planning_id);
  const hasDetailValue = (value) => value !== undefined && value !== null && value !== "" && value !== "—" && value !== "-";
  const normalizeGeometry = (value) => {
    if (!value) return null;
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        return null;
      }
    }
    const geometry = parsed?.type === "Feature" ? parsed.geometry : parsed;
    return ["Polygon", "MultiPolygon"].includes(geometry?.type) ? geometry : null;
  };
  const getUsageMapSelections = (usage) => (
    Array.isArray(usage?.usage_surfaces) && usage.usage_surfaces.length
      ? usage.usage_surfaces.map((surface) => ({
          lot_id: surface.lot_id,
          sub_lot_id: surface.sub_lot_id || null,
          lot_name: surface.lot_name,
          sub_lot_name: surface.sub_lot_name,
          lot_geom: surface.sub_lot_id
            ? normalizeGeometry(surface.parent_geometry)
            : normalizeGeometry(surface.geometry),
          sub_lot_geom: surface.sub_lot_id ? normalizeGeometry(surface.geometry) : null,
        }))
      : (usage?.usage_lots || []).map((usageLot) => ({
          lot_id: usageLot.lot_id,
          sub_lot_id: usageLot.sub_lot_id || null,
          lot_name: usageLot?.lot?.name,
          sub_lot_name: usageLot?.sub_lot?.name,
          lot_geom: normalizeGeometry(usageLot?.lot?.geom),
          lot_location: usageLot?.lot?.location,
          sub_lot_geom: normalizeGeometry(usageLot?.sub_lot?.geom),
        }))
  );

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
  }, [fetchUsages, fetchProducts, fetchLots]);

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

  const openDetail = (usage) => {
    setViewingUsage(usage);
    setIsDetailOpen(true);
  };

  const closeDetail = () => {
    setIsDetailOpen(false);
    setViewingUsage(null);
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
      title: "Producto",
      dataIndex: "product_id",
      key: "product_id",
      render: (_, record) => productName(record),
    },
    {
      title: "Cantidad",
      dataIndex: "amount_used",
      key: "amount_used",
      render: (value, record) => formatQuantity(value, record.unit),
    },
    {
      title: "Lotes / Sublotes",
      dataIndex: "lot_ids",
      key: "lot_ids",
      render: (_, record) => lotNames(record),
    },
    {
      title: "Área Total",
      dataIndex: "total_area",
      key: "total_area",
      render: (v) => formatArea(v),
    },
    {
      title: "Cultivo",
      dataIndex: "current_crop_resolved",
      key: "current_crop_resolved",
      render: (value) => value || "Sin cultivo",
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
      width: 132,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Ver">
            <Button
              type="text"
              shape="circle"
              aria-label="Ver"
              icon={<EyeOutlined />}
              onClick={() => openDetail(record)}
            />
          </Tooltip>
          {canEdit && !isPlanningUsage(record) && <Tooltip title="Editar">
            <Button
              type="text"
              shape="circle"
              aria-label="Editar"
              icon={<EditOutlined />}
              onClick={() => openDrawer(record)}
            />
          </Tooltip>}
          {canDisable && !isPlanningUsage(record) && <Popconfirm
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
          </Popconfirm>}
        </Space>
      ),
    },
  ].filter(Boolean);

  const menuItems = [
    canViewDisabled && {
      key: "1",
      label: <span onClick={() => navigate("/usages-disabled")}>Ver Registros Deshabilitados</span>,
    },
  ].filter(Boolean);

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Registros de Uso</h2>
        </Col>
        <Col>
          <Space>
            {isMobile ? (
              menuItems.length > 0 ? (
                <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                  <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
                </Dropdown>
              ) : null
            ) : (
              <Space>
                {canViewDisabled && <Button onClick={() => navigate("/usages-disabled")}>
                  Ver Registros Deshabilitados
                </Button>}
                {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
                  Agregar Registro
                </Button>}
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
            const lotList = lotNames(usage);
            const date = usage.date ? dayjs(usage.date).format("DD/MM/YYYY") : "-";

            return (
              <div className="inventory-card" key={rowKey(usage)}>
                <div className="card-header">
                  <h3>{product?.name || "Producto"}</h3>
                  <div className="card-icons">
                    <Tooltip title="Ver">
                      <Button
                        type="text"
                        shape="circle"
                        aria-label={`Ver ${product?.name || "registro de uso"}`}
                        icon={<EyeOutlined />}
                        onClick={() => openDetail(usage)}
                      />
                    </Tooltip>
                    {canEdit && !isPlanningUsage(usage) && <Tooltip title="Editar">
                      <Button
                        type="text"
                        shape="circle"
                        aria-label={`Editar ${product?.name || "registro de uso"}`}
                        icon={<EditOutlined />}
                        onClick={() => openDrawer(usage)}
                      />
                    </Tooltip>}
                    {canDisable && !isPlanningUsage(usage) && <Popconfirm
                      title="Deshabilitar registro"
                      description="Esta accion se puede revertir desde registros deshabilitados."
                      okText="Si"
                      cancelText="No"
                      onConfirm={() => handleDelete(getId(usage))}
                    >
                      <Tooltip title="Deshabilitar">
                        <Button
                          type="text"
                          danger
                          shape="circle"
                          aria-label={`Deshabilitar ${product?.name || "registro de uso"}`}
                          icon={<DeleteOutlined />}
                        />
                      </Tooltip>
                    </Popconfirm>}
                  </div>
                </div>

                <p className="flex-row"><Package size={18} /> <strong>Cantidad:</strong> {formatQuantity(usage.amount_used, usage.unit)}</p>
                <p className="flex-row"><MapPin size={18} /> <strong>Lotes / Sublotes:</strong> {lotList}</p>
                <p className="flex-row"><Leaf size={18} /> <strong>Cultivo:</strong> {usage.current_crop_resolved || "Sin cultivo"}</p>
                <p className="flex-row"><Ruler size={18} /> <strong>Área:</strong> {formatArea(usage.total_area)}</p>
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
        destroyOnHidden
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

      <Drawer
        title="Detalle de Registro de Uso"
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDetail}
        open={isDetailOpen}
        height={isMobile ? "85vh" : undefined}
        width={isMobile ? "100%" : 480}
        destroyOnHidden
      >
        {viewingUsage && (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Producto">{productName(viewingUsage)}</Descriptions.Item>
              <Descriptions.Item label="Cantidad utilizada">
                {formatQuantity(viewingUsage.amount_used, viewingUsage.unit)}
              </Descriptions.Item>
              <Descriptions.Item label="Fecha efectiva">
                {viewingUsage.date ? dayjs(viewingUsage.date).format("DD/MM/YYYY") : null}
              </Descriptions.Item>
              {hasDetailValue(viewingUsage.total_area) && (
                <Descriptions.Item label="Área total">{formatArea(viewingUsage.total_area)}</Descriptions.Item>
              )}
              <Descriptions.Item label="Cultivo">
                {viewingUsage.current_crop_resolved || "Sin cultivo"}
              </Descriptions.Item>
              {hasDetailValue(usageOrigin(viewingUsage)) && (
                <Descriptions.Item label="Origen">
                  <Space direction="vertical" size={2}>
                    <Tag color={isPlanningUsage(viewingUsage) ? "blue" : "default"}>
                      {usageOrigin(viewingUsage)}
                    </Tag>
                    {hasDetailValue(viewingUsage.source_activity_type) && (
                      <span>{formatActivity(viewingUsage.source_activity_type)}</span>
                    )}
                  </Space>
                </Descriptions.Item>
              )}
            </Descriptions>

            <div>
              <h4>Ubicación del uso</h4>
              <LotMapPreview selections={getUsageMapSelections(viewingUsage)} />
            </div>

            <div>
              <h4>Lotes / Sublotes</h4>
              <List
                size="small"
                bordered
                dataSource={Array.isArray(viewingUsage.lot_names) && viewingUsage.lot_names.length
                  ? viewingUsage.lot_names
                  : lotNames(viewingUsage).split(", ").filter(Boolean)}
                renderItem={(item) => <List.Item>{item}</List.Item>}
                locale={{ emptyText: "Sin lotes asignados" }}
              />
            </div>

            {(hasDetailValue(registeredBy(viewingUsage)) || hasDetailValue(viewingUsage.previous_crop_resolved)) && (
              <div>
                <h4>Información adicional</h4>
                <Descriptions column={1} bordered size="small">
                  {hasDetailValue(registeredBy(viewingUsage)) && (
                    <Descriptions.Item label="Registrado por">{registeredBy(viewingUsage)}</Descriptions.Item>
                  )}
                  {hasDetailValue(viewingUsage.previous_crop_resolved) && (
                    <Descriptions.Item label="Cultivo previo">{viewingUsage.previous_crop_resolved}</Descriptions.Item>
                  )}
                </Descriptions>
              </div>
            )}
          </Space>
        )}
      </Drawer>

      {isMobile && !isDrawerOpen && canCreate && (
        <button
          type="button"
          className="fab-button"
          aria-label="Agregar registro de uso"
          onClick={() => openDrawer()}
        >
          <PlusOutlined />
        </button>
      )}
    </div>
  );
};

export default Usage;


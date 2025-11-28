/**
 * Componente: Planning
 * Ubicación: src/features/planning/Planning.js
 * Descripción:
 *  Contenedor principal para la gestión de planificaciones.
 *  Maneja la lógica de estado, llamadas a API, y renderizado condicional
 *  de vistas (Tabla Desktop, Lista Mobile, Calendario).
 * 
 * Refactorización:
 *  - Se extrajo la tabla desktop a `components/PlanningTable.js`.
 *  - Se extrajo la lista mobile a `components/PlanningListMobile.js`.
 *  - Se mantiene la lógica de estado y handlers aquí.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Drawer, Form, Input, InputNumber, Select, DatePicker,
  Dropdown, Space, Row, Col, Tag, notification,
  Calendar as AntCalendar, Segmented, List, Popconfirm, Descriptions, Table
} from "antd";
import { PlusOutlined, MoreOutlined, EyeOutlined } from "@ant-design/icons";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import { useNavigate } from "react-router-dom";

import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import PlanningTable from "./components/PlanningTable";
import PlanningListMobile from "./components/PlanningListMobile";
import LotMapPreview from "./components/LotMapPreview";

dayjs.extend(isBetween);

const { RangePicker } = DatePicker;

// --- helpers ---
const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.title ?? String(Math.random());

const STATUS_COLORS = {
  planificado: "blue",
  en_progreso: "gold",
  completado: "green",
  cancelado: "volcano",
};
const statusTag = (s) => <Tag color={STATUS_COLORS[s] || "default"}>{s?.replaceAll("_", " ") || "—"}</Tag>;

const ACTIVITY_OPTIONS = [
  { value: "siembra", label: "Siembra" },
  { value: "fumigacion", label: "Fumigación" },
  { value: "cosecha", label: "Cosecha" },
  { value: "fertilizacion", label: "Fertilización" },
  { value: "riego", label: "Riego" },
  { value: "otra", label: "Otra" },
];

const Planning = () => {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const [viewMode, setViewMode] = useState("table"); // 'table' | 'calendar'
  const [openDay, setOpenDay] = useState(null); // dayjs() o null

  // filtros
  const [filters, setFilters] = useState({
    status: null,
    responsible: null,
  });

  // catálogos para nombres legibles
  const [users, setUsers] = useState([]);
  const [lots, setLots] = useState([]);
  const [products, setProducts] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  // índices id -> nombre
  const userIx = Object.fromEntries(users.map(u => [u.id ?? u._id, u.full_name || u.nickname || u.username || u.email]));
  const lotIx = Object.fromEntries(lots.map(l => [l.id ?? l._id, l.name]));
  const prodIx = Object.fromEntries(products.map(p => [p.id ?? p._id, p.name]));
  const vehIx = Object.fromEntries(vehicles.map(v => [v.id ?? v._id, v.name || v.model || v.plate]));

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null); // Estado para el detalle
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [form] = Form.useForm();

  const isMobile = useIsMobile();
  const navigate = useNavigate();

  //helpers
  // planificaciones que "tocan" un día (inicio/fin inclusivo)
  const eventsOn = (day) => {
    if (!day) return [];
    return list.filter((r) => {
      const start = r.start_at ? dayjs(r.start_at) : null;
      const end = r.end_at ? dayjs(r.end_at) : null;
      if (!start || !end) return false;
      return day.isBetween(start.startOf("day"), end.endOf("day"), "day", "[]");
    });
  };

  // contenido de cada celda de fecha
  // color por estado (podés cambiarlo por tipo de actividad si querés)
  const statusColor = (s) => ({
    planificado: "#1677ff",
    en_progreso: "#faad14",
    completado: "#52c41a",
    cancelado: "#ff4d4f",
  }[s] || "#8c8c8c");

  // parte del span para ese día
  const eventPartForDay = (ev, day) => {
    const s = ev.start_at ? dayjs(ev.start_at).startOf("day") : null;
    const e = ev.end_at ? dayjs(ev.end_at).endOf("day") : null;
    if (!s || !e) return "single";
    if (s.isSame(e, "day")) return "single";
    if (day.isSame(s, "day")) return "start";
    if (day.isSame(e, "day")) return "end";
    return "middle";
  };

  const renderDateCell = (value) => {
    const items = eventsOn(value);
    if (!items.length) return null;

    // si hay muchos, mostramos 3 bandas y luego “+N más”
    const visible = items.slice(0, 3);

    return (
      <div className="cal-bars">
        {visible.map((ev) => {
          const part = eventPartForDay(ev, value);
          const bg = statusColor(ev.status);
          return (
            <div
              key={getId(ev)}
              className={`cal-bar cal-bar--${part}`}
              style={{ backgroundColor: bg }}
              title={`${ev.title || "Sin título"} • ${dayjs(ev.start_at).format("DD/MM/YYYY")} → ${dayjs(ev.end_at).format("DD/MM/YYYY")}`}
              onClick={(e) => {
                e.stopPropagation();
                // abrimos el detalle (read-only)
                openDetail(ev);
              }}
            >
              <span className="cal-bar__text">{ev.title || "Sin título"}</span>
            </div>
          );
        })}
        {items.length > 3 && (
          <div className="cal-more">+{items.length - 3} más</div>
        )}
      </div>
    );
  };


  // ---------- fetchers ----------
  const fetchPlanning = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.responsible) params.responsible = filters.responsible;

      const { data } = await api.get("/planning", { params }); // ?includeDisabled=0&includeCanceled=0 por default
      const items = Array.isArray(data) ? data : data?.items || data?.data || [];
      setList(items);
    } catch (e) {
      console.error("→ planning list error:", e);
      notification.error({ message: "Error al cargar planificaciones" });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);
  const fetchLots = useCallback(async () => {
    try {
      const { data } = await api.get("/lots");
      setLots(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);
  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await api.get("/products");
      setProducts(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);
  const fetchVehicles = useCallback(async () => {
    try {
      const { data } = await api.get("/vehicles");
      setVehicles(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);

  useEffect(() => {
    fetchPlanning();
    fetchUsers();
    fetchLots();
    fetchProducts();
    fetchVehicles();
  }, [fetchPlanning, fetchUsers, fetchLots, fetchProducts, fetchVehicles]);

  // ---------- drawer handlers ----------
  const openDrawer = (row = null) => {
    setEditing(row);
    if (row) {
      form.setFieldsValue({
        title: row.title,
        description: row.description,
        activity_type: row.activity_type,
        date_range: [row.start_at ? dayjs(row.start_at) : null, row.end_at ? dayjs(row.end_at) : null],
        responsible_user: row.responsible_user,
        vehicle_id: row.vehicle_id,
        lot_ids: row.lot_ids || (row.lots || []).map(l => l.id),
        products: Array.isArray(row.products) ? row.products.map(p => ({
          product_id: p.product_id,
          amount: p.amount,
          unit: p.unit,
        })) : [],
        status: row.status || "planificado",
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ status: "planificado", products: [] });
    }
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openDetail = (row) => {
    setViewing(row);
    setIsDetailOpen(true);
  };

  const closeDetail = () => {
    setIsDetailOpen(false);
    setViewing(null);
  };

  const handleSubmit = async (values) => {
    try {
      const [start, end] = values.date_range || [];
      const payload = {
        title: values.title?.trim(),
        description: values.description || "",
        activity_type: values.activity_type,
        start_at: start?.toDate().toISOString(),
        end_at: end?.toDate().toISOString(),
        responsible_user: values.responsible_user || null,
        status: values.status || "planificado",
        vehicle_id: values.vehicle_id || null,
        lot_ids: values.lot_ids || [],
        products: (values.products || []).map(p => ({
          product_id: p.product_id,
          amount: Number(p.amount ?? 0),
          unit: p.unit || products.find(x => x.id === p.product_id)?.unit || "",
        })),
      };

      if (editing && getId(editing)) {
        // actualizar; para status usamos PATCH (según colección)
        await api.patch(`/planning/${getId(editing)}`, payload);
        notification.success({ message: "Planificación actualizada" });
      } else {
        await api.post("/planning", payload);
        notification.success({ message: "Planificación creada" });
      }
      fetchPlanning();
      closeDrawer();
    } catch (e) {
      console.error("→ save planning error:", e);
      const errorMsg = e.response?.data?.error === 'Conflicto de fechas en lotes'
        ? "Conflicto de fechas: Los lotes seleccionados ya tienen una planificación en ese rango."
        : (e.response?.data?.message || "Error al guardar planificación");
      notification.error({ message: errorMsg });
    }
  };

  const handleCancel = async (row) => {
    try {
      await api.delete(`/planning/${getId(row)}`); // soft delete -> status cancelado
      notification.success({ message: "Planificación cancelada" });
      fetchPlanning();
    } catch (e) {
      console.error("→ cancel planning error:", e);
      notification.error({ message: "No se pudo cancelar la planificación" });
    }
  };

  const updateStatus = async (row, status) => {
    try {
      await api.patch(`/planning/${getId(row)}`, { status });
      fetchPlanning();
    } catch (e) {
      notification.error({ message: "No se pudo actualizar el estado" });
    }
  };

  const handleFilterChange = (key, val) => {
    setFilters(prev => ({ ...prev, [key]: val }));
  };

  const disabledMenu = [{ key: "1", label: <span onClick={() => navigate("/planificaciones-deshabilitadas")}>Ver Canceladas</span> }];

  // ---------- UI ----------
  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><h2>Planificaciones</h2></Col>
        <Col>
          <Space>
            <Segmented
              size="middle"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { label: "Tabla", value: "table" },
                { label: "Calendario", value: "calendar" },
              ]}
            />
            {isMobile ? (
              <Dropdown menu={{ items: disabledMenu }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            ) : (
              <Space>
                <Button onClick={() => navigate("/planificaciones-deshabilitadas")}>Ver Canceladas</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
                  Nueva Planificación
                </Button>
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {/* Filtros (Desktop) */}
      {!isMobile && viewMode === "table" && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Select
              style={{ width: "100%" }}
              placeholder="Filtrar por Estado"
              allowClear
              onChange={(v) => handleFilterChange("status", v)}
              options={[
                { value: "planificado", label: "Planificado" },
                { value: "en_progreso", label: "En Progreso" },
                { value: "completado", label: "Completado" },
                { value: "cancelado", label: "Cancelado" },
              ]}
            />
          </Col>
          <Col span={6}>
            <Select
              style={{ width: "100%" }}
              placeholder="Filtrar por Responsable"
              allowClear
              onChange={(v) => handleFilterChange("responsible", v)}
              options={users.map(u => ({ value: u.id ?? u._id, label: userIx[u.id ?? u._id] }))}
            />
          </Col>
        </Row>
      )}

      {/* Tabla (desktop) */}
      {viewMode === "table" && !isMobile && (
        <PlanningTable
          list={list}
          loading={loading}
          onEdit={openDrawer}
          onView={openDetail}
          onUpdateStatus={updateStatus}
          onCancel={handleCancel}
          rowKey={rowKey}
          userIx={userIx}
          lotIx={lotIx}
          vehIx={vehIx}
          statusTag={statusTag}
        />
      )}

      {/* Vista CALENDARIO (desktop y mobile) */}
      {viewMode === "calendar" && (
        <div style={{ background: "#fff", padding: 12, borderRadius: 8 }}>
          <AntCalendar
            fullscreen={!isMobile}
            dateCellRender={renderDateCell}
            onSelect={(d) => setOpenDay(d)} // click en día abre detalle
          />
        </div>
      )}

      {/* Cards (mobile) */}
      {isMobile && viewMode === "table" && (
        <PlanningListMobile
          list={list}
          onEdit={openDrawer}
          onView={openDetail}
          onCancel={handleCancel}
          rowKey={rowKey}
          userIx={userIx}
          lotIx={lotIx}
          vehIx={vehIx}
          statusTag={statusTag}
        />
      )}

      {/* Drawer crear/editar */}
      <Drawer
        title={editing ? "Editar Planificación" : "Nueva Planificación"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 480}
        destroyOnClose
        styles={{ body: { paddingBottom: 80 } }}
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <Form.Item name="title" label="Título" rules={[{ required: true, message: "Ingresá un título" }]}>
            <Input placeholder="Ej: Fumigación Lote Norte" />
          </Form.Item>

          <Form.Item name="description" label="Descripción">
            <Input.TextArea placeholder="Detalle de la planificación" rows={3} />
          </Form.Item>

          <Form.Item name="activity_type" label="Actividad" rules={[{ required: true, message: "Seleccioná la actividad" }]}>
            <Select options={ACTIVITY_OPTIONS} placeholder="Seleccioná la actividad" />
          </Form.Item>

          <Form.Item name="date_range" label="Período" rules={[{ required: true, message: "Seleccioná el período" }]}>
            <RangePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item name="responsible_user" label="Responsable">
            <Select
              allowClear
              placeholder="Seleccioná un usuario"
              options={users.map(u => ({ value: u.id ?? u._id, label: userIx[u.id ?? u._id] }))}
            />
          </Form.Item>

          <Form.Item name="vehicle_id" label="Vehículo">
            <Select
              allowClear
              placeholder="Seleccioná un vehículo"
              options={vehicles
                .filter(v => v.status === 'activo')
                .map(v => ({ value: v.id ?? v._id, label: vehIx[v.id ?? v._id] }))}
            />
          </Form.Item>

          <Form.Item name="lot_ids" label="Lotes" rules={[{ required: true, message: "Seleccioná al menos un lote" }]}>
            <Select
              mode="multiple"
              placeholder="Seleccioná lotes"
              options={lots.map(l => ({ value: l.id ?? l._id, label: lotIx[l.id ?? l._id] }))}
            />
          </Form.Item>

          {/* Productos a aplicar */}
          <Form.List name="products">
            {(fields, { add, remove }) => (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label style={{ fontWeight: 500 }}>Productos</label>
                  <Button type="dashed" onClick={() => add()} size="small">Agregar producto</Button>
                </div>

                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} style={{ display: "flex", marginBottom: 8 }} align="start" wrap>
                    <Form.Item
                      {...rest}
                      name={[name, "product_id"]}
                      rules={[{ required: true, message: "Producto" }]}
                    >
                      <Select
                        placeholder="Producto"
                        style={{ width: 200 }}
                        options={products.map(p => ({ value: p.id ?? p._id, label: prodIx[p.id ?? p._id] }))}
                        onChange={(pid) => {
                          const prod = products.find(p => (p.id ?? p._id) === pid);
                          const current = form.getFieldValue("products") || [];
                          current[name] = { ...(current[name] || {}), unit: prod?.unit || "" };
                          form.setFieldsValue({ products: current });
                        }}
                      />
                    </Form.Item>

                    <Form.Item
                      {...rest}
                      name={[name, "amount"]}
                      rules={[{ required: true, message: "Cantidad" }]}
                    >
                      <InputNumber min={0} placeholder="Cantidad" style={{ width: 120 }} />
                    </Form.Item>

                    <Form.Item {...rest} name={[name, "unit"]}>
                      <Input placeholder="Unidad" style={{ width: 100 }} />
                    </Form.Item>

                    <Button danger type="text" onClick={() => remove(name)}>Eliminar</Button>
                  </Space>
                ))}
              </>
            )}
          </Form.List>

          <Form.Item name="status" label="Estado">
            <Select
              options={[
                { value: "planificado", label: "Planificado" },
                { value: "en_progreso", label: "En progreso" },
                { value: "completado", label: "Completado" },
              ]}
              placeholder="Estado"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editing ? "Actualizar" : "Crear Planificación"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>

      {/* Drawer Detalle (Read-only) */}
      <Drawer
        title="Detalle de Planificación"
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDetail}
        open={isDetailOpen}
        height={isMobile ? "85vh" : undefined}
        width={isMobile ? "100%" : 500}
        destroyOnClose
      >
        {viewing && (
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Título">{viewing.title}</Descriptions.Item>
              <Descriptions.Item label="Estado">{statusTag(viewing.status)}</Descriptions.Item>
              <Descriptions.Item label="Actividad">
                {viewing.activity_type ? viewing.activity_type.toUpperCase() : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Período">
                {viewing.start_at ? dayjs(viewing.start_at).format("DD/MM/YYYY") : "—"}
                {" → "}
                {viewing.end_at ? dayjs(viewing.end_at).format("DD/MM/YYYY") : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Responsable">
                {userIx[viewing.responsible_user] || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Vehículo">
                {vehIx[viewing.vehicle_id] || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Descripción">
                {viewing.description || "—"}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <h4>Lotes</h4>
              <List
                size="small"
                bordered
                dataSource={viewing.lots || []}
                renderItem={item => {
                  // Buscar el lote completo en el estado 'lots' para obtener la location
                  const fullLot = lots.find(l => (l.id ?? l._id) === (item.id ?? item._id));
                  return (
                    <List.Item style={{ display: 'block' }}>
                      <div style={{ marginBottom: 8 }}><strong>{item.name}</strong></div>
                      {fullLot?.location && (
                        <LotMapPreview location={fullLot.location} allLots={lots} />
                      )}
                    </List.Item>
                  );
                }}
                locale={{ emptyText: "Sin lotes asignados" }}
              />
            </div>
            <div>
              <h4>Productos</h4>
              <Table
                size="small"
                pagination={false}
                dataSource={viewing.products || []}
                rowKey="product_id"
                columns={[
                  { title: "Producto", dataIndex: "name" },
                  { title: "Cant.", dataIndex: "amount" },
                  { title: "Unidad", dataIndex: "unit" },
                ]}
                locale={{ emptyText: "Sin productos asignados" }}
              />
            </div>
          </Space>
        )}
      </Drawer>

      <Drawer
        title={openDay ? `Planificaciones del ${openDay.format("DD/MM/YYYY")}` : ""}
        open={!!openDay}
        onClose={() => setOpenDay(null)}
        width={isMobile ? "100%" : 520}
        placement={isMobile ? "bottom" : "right"}
        height={isMobile ? "80vh" : undefined}
        destroyOnClose
      >
        <List
          dataSource={eventsOn(openDay)}
          locale={{ emptyText: "Sin planificaciones para este día" }}
          renderItem={(item) => (
            <List.Item
              key={getId(item)}
              actions={[
                <Button type="link" icon={<EyeOutlined />} onClick={() => { setOpenDay(null); openDetail(item); }}>Ver</Button>,
                <Popconfirm
                  title="¿Cancelar planificación?"
                  description="Esta acción no se puede deshacer."
                  onConfirm={() => { setOpenDay(null); handleCancel(item); }}
                  okText="Sí"
                  cancelText="No"
                >
                  <Button type="link" danger>Cancelar</Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={<span>{statusTag(item.status)} <strong>{item.title || "Sin título"}</strong></span>}
                description={
                  <div style={{ fontSize: 12 }}>
                    <div>Período: {item.start_at ? dayjs(item.start_at).format("DD/MM/YYYY") : "—"} → {item.end_at ? dayjs(item.end_at).format("DD/MM/YYYY") : "—"}</div>
                    <div>Lotes: {(item.lot_ids || []).map(id => lotIx[id]).filter(Boolean).join(", ") || "—"}</div>
                    <div>Resp.: {userIx[item.responsible_user] || "—"}</div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Drawer>

      {
        isMobile && !isDrawerOpen && (
          <div className="fab-button" onClick={() => openDrawer()}>
            <PlusOutlined />
          </div>
        )
      }
    </div >
  );
};

export default Planning;


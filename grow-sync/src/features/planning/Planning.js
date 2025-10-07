import React, { useState, useEffect, useCallback } from "react";
import {
  Table, Button, Drawer, Form, Input, InputNumber, Select, DatePicker,
  Dropdown, Space, Row, Col, Tag, Tooltip, notification,
  Calendar as AntCalendar, Segmented, List
} from "antd";
import { MoreOutlined, EditOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Calendar as CalIcon, User as UserIcon, MapPin, Package, Truck } from "phosphor-react";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import { useNavigate } from "react-router-dom";

import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
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

  // catálogos para nombres legibles
  const [users, setUsers] = useState([]);
  const [lots, setLots] = useState([]);
  const [products, setProducts] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  // índices id -> nombre
  const userIx   = Object.fromEntries(users.map(u => [u.id ?? u._id, u.full_name || u.nickname || u.username || u.email]));
  const lotIx    = Object.fromEntries(lots.map(l => [l.id ?? l._id, l.name]));
  const prodIx   = Object.fromEntries(products.map(p => [p.id ?? p._id, p.name]));
  const vehIx    = Object.fromEntries(vehicles.map(v => [v.id ?? v._id, v.name || v.model || v.plate]));

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const isMobile = useIsMobile();
  const navigate = useNavigate();

  //helpers
  // planificaciones que "tocan" un día (inicio/fin inclusivo)
    const eventsOn = (day) => {
    if (!day) return [];
    return list.filter((r) => {
        const start = r.start_at ? dayjs(r.start_at) : null;
        const end   = r.end_at ? dayjs(r.end_at) : null;
        if (!start || !end) return false;
        return day.isBetween(start.startOf("day"), end.endOf("day"), "day", "[]");
    });
    };

    // contenido de cada celda de fecha
    // color por estado (podés cambiarlo por tipo de actividad si querés)
    const statusColor = (s) => ({
        planificado: "#1677ff",
        en_progreso: "#faad14",
        completado:  "#52c41a",
        cancelado:   "#ff4d4f",
    }[s] || "#8c8c8c");

    // parte del span para ese día
    const eventPartForDay = (ev, day) => {
        const s = ev.start_at ? dayjs(ev.start_at).startOf("day") : null;
        const e = ev.end_at   ? dayjs(ev.end_at).endOf("day")   : null;
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
                    title={`${ev.title || "Sin título"} • ${dayjs(ev.start_at).format("DD/MM")} → ${dayjs(ev.end_at).format("DD/MM")}`}
                    onClick={(e) => {
                    e.stopPropagation();
                    // abrimos el drawer de edición que ya tenés
                    openDrawer(ev);
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
      const { data } = await api.get("/planning"); // ?includeDisabled=0&includeCanceled=0 por default
      const items = Array.isArray(data) ? data : data?.items || data?.data || [];
      setList(items);
    } catch (e) {
      console.error("→ planning list error:", e);
      notification.error({ message: "Error al cargar planificaciones" });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch {}
  }, []);
  const fetchLots = useCallback(async () => {
    try {
      const { data } = await api.get("/lots");
      setLots(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch {}
  }, []);
  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await api.get("/products");
      setProducts(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch {}
  }, []);
  const fetchVehicles = useCallback(async () => {
    try {
      const { data } = await api.get("/vehicles");
      setVehicles(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch {}
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
        lot_ids: row.lot_ids || [],
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
      notification.error({ message: "Error al guardar planificación" });
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

  // ---------- table ----------
  const columns = [
    { title: "#", dataIndex: "index", width: 56, render: (_, __, i) => i + 1 },
    { title: "Título", dataIndex: "title" },
    {
      title: "Actividad",
      dataIndex: "activity_type",
      render: (t) => <Tag color="blue">{t ? (t[0].toUpperCase() + t.slice(1)) : "—"}</Tag>,
    },
    {
      title: "Lotes",
      dataIndex: "lot_ids",
      render: (ids = []) => (ids.map(id => lotIx[id]).filter(Boolean).join(", ") || "—"),
    },
    {
      title: "Período",
      key: "period",
      render: (_, r) =>
        r.start_at && r.end_at
          ? `${dayjs(r.start_at).format("DD/MM/YYYY")} → ${dayjs(r.end_at).format("DD/MM/YYYY")}`
          : "—",
    },
    {
      title: "Responsable",
      dataIndex: "responsible_user",
      render: (id) => userIx[id] || "—",
    },
    { title: "Vehículo", dataIndex: "vehicle_id", render: (id) => vehIx[id] || "—" },
    {
      title: "Productos",
      dataIndex: "products",
      render: (arr = []) => (arr.length ? `${arr.length} ítem(s)` : "—"),
    },
    { title: "Estado", dataIndex: "status", render: statusTag },
    {
      title: "Acciones",
      key: "actions",
      width: 140,
      render: (_, record) => {
        const menuItems = [
          { key: "prog", label: "Marcar en progreso", onClick: () => updateStatus(record, "en_progreso") },
          { key: "done", label: "Marcar completado", onClick: () => updateStatus(record, "completado") },
          { type: "divider" },
          {
            key: "cancel",
            label: <span style={{ color: "#ff4d4f" }}>Cancelar</span>,
            onClick: () => handleCancel(record),
          },
        ];
        return (
          <Space size="small">
            <Tooltip title="Editar">
              <Button type="text" shape="circle" icon={<EditOutlined />} onClick={() => openDrawer(record)} />
            </Tooltip>
            <Dropdown menu={{ items: menuItems }} placement="bottomRight">
              <Button type="text" shape="circle" icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  const disabledMenu = [{ key: "1", label: <span onClick={() => navigate("/planificaciones-deshabilitadas")}>Ver Canceladas</span> }];

  // ---------- UI ----------
  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><h2>Planificaciones</h2></Col>
        <Col>
          <Space>
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

                <Segmented
                    size="middle"
                    value={viewMode}
                    onChange={setViewMode}
                    options={[
                      { label: "Tabla", value: "table" },
                      { label: "Calendario", value: "calendar" },
                    ]}
                />
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {/* Tabla (desktop) */}
      {viewMode === "table" && !isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={list}
          loading={loading}
          pagination={{ pageSize: 8, position: ["bottomCenter"] }}
          rowKey={rowKey}
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
        <div className="inventory-cards-container">
          {list.map((r) => {
            const lotsText = (r.lot_ids || []).map(id => lotIx[id]).filter(Boolean).join(", ") || "—";
            const period = (r.start_at && r.end_at)
              ? `${dayjs(r.start_at).format("DD/MM")} → ${dayjs(r.end_at).format("DD/MM")}`
              : "—";
            return (
              <div className="inventory-card" key={rowKey(r)}>
                <div className="card-header">
                  <h3>{r.title}</h3>
                  <div className="card-icons">
                    <EditOutlined onClick={() => openDrawer(r)} />
                    <DeleteOutlined onClick={() => handleCancel(r)} />
                  </div>
                </div>
                <p className="flex-row"><CalIcon size={18} /> <strong>Período:</strong> {period}</p>
                <p className="flex-row"><MapPin size={18} /> <strong>Lotes:</strong> {lotsText}</p>
                <p className="flex-row"><UserIcon size={18} /> <strong>Resp.:</strong> {userIx[r.responsible_user] || "—"}</p>
                <p className="flex-row"><Truck size={18} /> <strong>Vehículo:</strong> {vehIx[r.vehicle_id] || "—"}</p>
                <p className="flex-row"><Package size={18} /> <strong>Productos:</strong> {(r.products?.length || 0)} ítem(s)</p>
                <p><strong>Estado:</strong> {statusTag(r.status)}</p>
              </div>
            );
          })}
        </div>
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
              options={vehicles.map(v => ({ value: v.id ?? v._id, label: vehIx[v.id ?? v._id] }))}
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
                <Button type="link" onClick={() => { setOpenDay(null); openDrawer(item); }}>Editar</Button>,
                <Button type="link" danger onClick={() => { setOpenDay(null); /* podés llamar a handleCancel(item) si querés */ }}>
                    Cancelar
                </Button>,
                ]}
            >
                <List.Item.Meta
                title={<span>{statusTag(item.status)} <strong>{item.title || "Sin título"}</strong></span>}
                description={
                    <div style={{ fontSize: 12 }}>
                    <div>Período: {item.start_at ? dayjs(item.start_at).format("DD/MM") : "—"} → {item.end_at ? dayjs(item.end_at).format("DD/MM") : "—"}</div>
                    <div>Lotes: {(item.lot_ids || []).map(id => lotIx[id]).filter(Boolean).join(", ") || "—"}</div>
                    <div>Resp.: {userIx[item.responsible_user] || "—"}</div>
                    </div>
                }
                />
            </List.Item>
            )}
        />
        </Drawer>

    </div>
  );
};

export default Planning;

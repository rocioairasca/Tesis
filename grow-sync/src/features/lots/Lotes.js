import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dropdown, Table, Button, Drawer, Form, Input, InputNumber, Space, Popconfirm, notification, Row, Col, Tooltip } from "antd";
import { MoreOutlined, EnvironmentOutlined, AimOutlined, EditOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import MapSelector from '../../components/MapSelector';

// -------- helpers --------
const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.name ?? String(Math.random());

const safeParse = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
};
const ensureString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return ""; }
};

const Lotes = () => {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(false);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingLot, setEditingLot] = useState(null);
  const [form] = Form.useForm();

  const [isMapModalOpen, setIsMapModalOpen] = useState(false); 
  const [selectedLocation, setSelectedLocation] = useState(null);
  const mapRef = useRef();

  const isMobile = useIsMobile();

  // cargamos los lotes desde el back
  const fetchLots = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/lots");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setLots(list);
    } catch (error) {
      console.error("→ lots list error:", error);
      notification.error({ message: "Error al cargar los lotes" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLots();
  }, [fetchLots]);

  // Drawer handlers ---
  const openDrawer = (lot = null) => {
    setEditingLot(lot);
    if (lot) {
      form.setFieldsValue({
        name: lot.name ?? "",
        area: lot.area ?? undefined,
        location: ensureString(safeParse(lot.location) || lot.location),
      });
    } else {
      form.resetFields();
    }
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingLot(null);
    form.resetFields();
  };

  // Agregar o Editar Lote
  const handleSubmit = async (values) => {
    const payload = {
      name: values.name?.trim(),
      area: Number(values.area ?? 0),
      location: ensureString(values.location),
    };

    try {
      if (editingLot && getId(editingLot)) {
        await api.put(`/lots/${getId(editingLot)}`, payload);
        notification.success({ message: "Lote actualizado exitosamente" });
      } else {
        await api.post("/lots", payload);
        notification.success({ message: "Lote creado exitosamente" });
      }
      fetchLots();
      closeDrawer();
    } catch (error) {
      console.error("→ save lot error:", error);
      notification.error({ message: "Error al guardar lote" });
    }
  };

  // Eliminar (Deshabilitar) Lote
  const handleDelete = async (id) => {
    try {
      await api.delete(`/lots/${id}`);
      notification.success({ message: "Lote deshabilitado exitosamente" });
      fetchLots();
    } catch (error) {
      console.error("→ disable lot error:", error);
      notification.error({ message: "Error al deshabilitar lote" });
    }
  };

  // Tabla ---
  const columns = [
    {
      title: "#",
      dataIndex: "index",
      key: "index",
      render: (_, __, index) => index + 1,
      width: 64, 
    },
    {
      title: "Nombre del Lote",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "Área Total (ha)",
      dataIndex: "area",
      key: "area",
    },
    {
      title: "Ubicación",
      dataIndex: "location",
      key: "location",
      render: (loc) => {
        const parsed = safeParse(loc);
        if (!parsed) return "Sin ubicación";
        return (
          <Button type="link" onClick={() => setSelectedLocation(parsed)}>
            Ver
          </Button>
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
              onClick={() => openDrawer(record)}
              aria-label="Editar"
            />
          </Tooltip>
          <Popconfirm
            title="¿Deshabilitar este lote?"
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
        <span onClick={() => (window.location.href = "/lotes-deshabilitados")}>
          Ver Lotes Deshabilitados
        </span>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* Título y botones */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Lotes</h2>
        </Col>
        <Col>
          <Space>
            {isMobile ? (
              <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            ) : (
              <Space>
                <Button onClick={() => window.location.href = "/lotes-deshabilitados"}>
                  Ver Lotes Deshabilitados
                </Button>
                <Button type="primary" onClick={() => openDrawer()}>
                  Agregar Lote
                </Button>
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {!isMobile&& (
        <Row gutter={24}>
          <Col span={12}>
            {/* Mapa a la izquierda */}
            <MapSelector lots={lots} selectedLocation={selectedLocation} modalOpen={false} />
          </Col>
          <Col span={12}>
            {/* Tabla de lotes a la derecha */}
            <Table
              scroll={{ x: "max-content" }}
              columns={columns}
              dataSource={lots}
              loading={loading}
              pagination={{ pageSize: 5, position: ['bottomCenter'] }}
              rowKey={rowKey}
            />
          </Col>
        </Row>
      )}

      {isMobile && (
        <>
          <div style={{ marginBottom: 24 }}>
            <MapSelector lots={lots} selectedLocation={selectedLocation} modalOpen={false} />
          </div>

          <div className="inventory-cards-container">
            {lots.map((lot) => (
              <div className="inventory-card" key={rowKey(lot)}>
                <div className="card-header">
                  <h3>{lot.name}</h3>
                  <div className="card-icons">
                    <EditOutlined onClick={() => openDrawer(lot)} />
                    <DeleteOutlined onClick={() => handleDelete(getId(lot))} />
                  </div>
                </div>

                <p>
                  <AimOutlined style={{ marginRight: 8 }} /> <strong>Área:</strong> {lot.area} ha
                </p>
                <p>
                  <EnvironmentOutlined style={{ marginRight: 8 }} /> <strong>Ubicación:</strong>{" "}
                  {safeParse(lot.location) ? (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, marginLeft: 0 }}
                      onClick={() => setSelectedLocation(safeParse(lot.location))}
                    >
                      Ver
                    </Button>
                  ) : (
                    "No asignada"
                  )}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Drawer para agregar/editar */}
      <Drawer
        title={editingLot ? "Editar Lote" : "Agregar Nuevo Lote"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        width={isMobile ? "100%" : 420}
        height={isMobile ? "90vh" : undefined}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnClose
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Nombre del Lote"
            rules={[{ required: true, message: "Por favor ingresá el nombre del lote." }]}
          >
            <Input placeholder="Ej: Lote Norte" />
          </Form.Item>

          <Form.Item
            name="area"
            label="Área Total (hectáreas)"
            rules={[{ required: true, message: "Por favor ingresá la superficie." }]}
            extra="Área calculada automáticamente. Podés modificarla si lo deseás."
          >
            <InputNumber min={0} style={{ width: "100%" }} placeholder="Ej: 12.5" />
          </Form.Item>

          {/* location se guarda como string JSON */}
          <Form.Item name="location" hidden>
            <Input />
          </Form.Item>

          <Form.Item>
            <Button type="default" onClick={() => setIsMapModalOpen(true)} block>
              Seleccionar ubicación en el mapa
            </Button>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingLot ? "Actualizar Lote" : "Guardar Lote"}
            </Button>
          </Form.Item>
        </Form>

        {/* Drawer secundario con el mapa */}
        <Drawer
          title="Seleccioná la ubicación del Lote"
          placement="right"
          open={isMapModalOpen}
          onClose={() => setIsMapModalOpen(false)}
          width={800}
          afterOpenChange={(open) => {
            if (open && mapRef.current) mapRef.current.invalidateSize?.();
          }}
        >
          <MapSelector
            lots={lots}
            initialLocation={editingLot?.location ? safeParse(editingLot.location) : null}
            onSelect={(data) => {
              // data: { location: obj|str, calculatedArea: number }
              form.setFieldsValue({
                location: ensureString(data.location),
                area: Number(data.calculatedArea ?? form.getFieldValue("area") ?? 0),
              });
              setIsMapModalOpen(false);
            }}
            modalOpen={isMapModalOpen}
            mapRef={mapRef}
            insideDrawer={true}
          />
        </Drawer>
      </Drawer>

      {isMobile && !isDrawerOpen && (
        <div className="fab-button" onClick={() => openDrawer()}>
          <PlusOutlined />
        </div>
      )}
    </div>
  );
};

export default Lotes;


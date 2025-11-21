/**
 * Feature: Gestión de Lotes
 * Ubicación: src/features/lots/Lotes.js
 * Descripción:
 *  Contenedor principal para la gestión de lotes.
 *  Maneja el estado de la aplicación (lista de lotes, loading, modales) y la lógica de negocio (CRUD).
 * 
 * Refactorización (Mejoras de Código):
 *  - Se han extraído las vistas de tabla (Desktop) y lista (Mobile) a componentes separados:
 *    1. <LotTable /> -> Para vista de escritorio.
 *    2. <LotListMobile /> -> Para vista móvil.
 *  - Esto reduce la complejidad del renderizado y mejora la legibilidad del archivo principal.
 *  - Se mantiene la lógica de estado y llamadas a API centralizadas aquí.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dropdown, Button, Drawer, Form, Input, InputNumber, Space, notification, Row, Col } from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import MapSelector from '../../components/MapSelector';
import LotTable from "./components/LotTable";
import LotListMobile from "./components/LotListMobile";

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

      {!isMobile ? (
        <Row gutter={24}>
          <Col span={12}>
            {/* Mapa a la izquierda */}
            <MapSelector lots={lots} selectedLocation={selectedLocation} modalOpen={false} />
          </Col>
          <Col span={12}>
            {/* Tabla de lotes a la derecha */}
            <LotTable
              lots={lots}
              loading={loading}
              onEdit={openDrawer}
              onDelete={handleDelete}
              onViewLocation={setSelectedLocation}
              rowKey={rowKey}
              getId={getId}
              safeParse={safeParse}
            />
          </Col>
        </Row>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <MapSelector lots={lots} selectedLocation={selectedLocation} modalOpen={false} />
          </div>
          <LotListMobile
            lots={lots}
            onEdit={openDrawer}
            onDelete={handleDelete}
            onViewLocation={setSelectedLocation}
            rowKey={rowKey}
            getId={getId}
            safeParse={safeParse}
          />
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



/**
 * Feature: Gestión de Vehículos
 * Ubicación: src/features/vehicles/Vehicles.js
 * Descripción:
 *  Contenedor principal para la gestión de maquinaria y vehículos.
 *  Maneja el estado (lista, loading) y la lógica CRUD.
 * 
 * Refactorización:
 *  - Extracción de vistas de tabla (Desktop) y lista (Mobile) a componentes.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Drawer, Form, Input, InputNumber, Select,
  Dropdown, Space, Row, Col, Tag, notification
} from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import VehicleTable from "./components/VehicleTable";
import VehicleListMobile from "./components/VehicleListMobile";

// ---- helpers ----
const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.plate ?? r?.name;

const TYPE_OPTIONS = [
  { value: "tractor", label: "Tractor" },
  { value: "cosechadora", label: "Cosechadora" },
  { value: "camioneta", label: "Camioneta" },
  { value: "camión", label: "Camión" },
  { value: "pulverizadora", label: "Pulverizadora" },
  { value: "sembradora", label: "Sembradora" },
  { value: "otro", label: "Otro" },
];

const STATUS_OPTIONS = [
  { value: "activo", label: "Activo" },
  { value: "mantenimiento", label: "Mantenimiento" },
  { value: "fuera_de_servicio", label: "Fuera de servicio" },
];

const statusTag = (s) => {
  switch (s) {
    case "activo": return <Tag color="green">Activo</Tag>;
    case "mantenimiento": return <Tag color="gold">Mantenimiento</Tag>;
    case "fuera_de_servicio": return <Tag color="red">Fuera de servicio</Tag>;
    default: return <Tag>—</Tag>;
  }
};

const numberFmt = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return x.toLocaleString("es-AR");
};

const Vehicles = () => {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);

  const [form] = Form.useForm();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // ---- API ----
  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/vehicles");
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setVehicles(list);
    } catch (error) {
      console.error("→ vehicles list error:", error);
      notification.error({ message: "Error al cargar vehículos" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  // ---- Drawer handlers ----
  const openDrawer = (veh = null) => {
    setEditingVehicle(veh);
    if (veh) {
      form.setFieldsValue({
        name: veh.name ?? "",
        type: veh.type ?? undefined,
        brand: veh.brand ?? "",
        model: veh.model ?? "",
        plate: veh.plate ?? "",
        capacity: veh.capacity ?? undefined,
        status: veh.status ?? "activo",
      });
    } else {
      form.resetFields();
    }
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingVehicle(null);
    form.resetFields();
  };

  const handleSubmit = async (values) => {
    const payload = {
      name: values.name?.trim(),
      type: values.type,
      brand: values.brand?.trim(),
      model: values.model?.trim(),
      plate: (values.plate || "").toUpperCase().trim(),
      capacity: Number(values.capacity ?? 0),
      status: values.status,
    };

    try {
      if (editingVehicle && getId(editingVehicle)) {
        // Postman usa PATCH para update
        await api.patch(`/vehicles/${getId(editingVehicle)}`, payload);
        notification.success({ message: "Vehículo actualizado" });
      } else {
        await api.post("/vehicles", payload);
        notification.success({ message: "Vehículo creado" });
      }
      fetchVehicles();
      closeDrawer();
    } catch (error) {
      console.error("→ save vehicle error:", error);
      notification.error({ message: "Error al guardar vehículo" });
    }
  };

  const handleDisable = async (id) => {
    try {
      await api.delete(`/vehicles/${id}`); // soft delete
      notification.success({ message: "Vehículo deshabilitado" });
      fetchVehicles();
    } catch (error) {
      console.error("→ disable vehicle error:", error);
      notification.error({ message: "Error al deshabilitar vehículo" });
    }
  };

  const menuItems = [
    {
      key: "1",
      label: <span onClick={() => navigate("/vehiculos-deshabilitados")}>Ver Vehículos Deshabilitados</span>,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Vehículos</h2>
        </Col>
        <Col>
          <Space>
            {isMobile ? (
              <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            ) : (
              <Space>
                <Button onClick={() => navigate("/vehiculos-deshabilitados")}>
                  Ver Vehículos Deshabilitados
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
                  Agregar Vehículo
                </Button>
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {/* Tabla (desktop) */}
      {!isMobile && (
        <VehicleTable
          vehicles={vehicles}
          loading={loading}
          onEdit={openDrawer}
          onDisable={handleDisable}
          rowKey={rowKey}
          getId={getId}
          statusTag={statusTag}
          numberFmt={numberFmt}
        />
      )}

      {/* Cards (mobile) */}
      {isMobile && (
        <VehicleListMobile
          vehicles={vehicles}
          onEdit={openDrawer}
          onDisable={handleDisable}
          rowKey={rowKey}
          getId={getId}
          statusTag={statusTag}
          numberFmt={numberFmt}
        />
      )}

      {/* Drawer crear/editar */}
      <Drawer
        title={editingVehicle ? "Editar Vehículo" : "Agregar Vehículo"}
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
            name="name"
            label="Nombre"
            rules={[{ required: true, message: "Ingresá el nombre del vehículo" }]}
          >
            <Input placeholder="Ej: John Deere 6155M" />
          </Form.Item>

          <Form.Item
            name="type"
            label="Tipo"
            rules={[{ required: true, message: "Seleccioná el tipo" }]}
          >
            <Select placeholder="Seleccioná el tipo" options={TYPE_OPTIONS} />
          </Form.Item>

          <Form.Item name="brand" label="Marca">
            <Input placeholder="Ej: John Deere" />
          </Form.Item>

          <Form.Item name="model" label="Modelo">
            <Input placeholder="Ej: 6155M" />
          </Form.Item>

          <Form.Item name="plate" label="Patente">
            <Input
              placeholder="Ej: ABC123"
              onChange={(e) => form.setFieldsValue({ plate: e.target.value?.toUpperCase() })}
            />
          </Form.Item>

          <Form.Item name="capacity" label="Capacidad">
            <InputNumber min={0} style={{ width: "100%" }} placeholder="Ej: 1500" />
          </Form.Item>

          <Form.Item
            name="status"
            label="Estado"
            rules={[{ required: true, message: "Seleccioná el estado" }]}
          >
            <Select placeholder="Seleccioná el estado" options={STATUS_OPTIONS} />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingVehicle ? "Actualizar Vehículo" : "Guardar Vehículo"}
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

export default Vehicles;


import React, { useState, useRef } from 'react';
import { Button, Drawer, Form, Input, InputNumber, notification } from 'antd';
import api from '../../services/apiClient';
import useIsMobile from '../../hooks/useIsMobile';
import MapSelector from '../../components/MapSelector';
import { PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from '../../utils/permissions';
import { getUserFriendlyError } from '../../utils/userFriendlyErrors';
import LotsOverview from './LotsOverview';

const getId = (r) => r?.id ?? r?._id;

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

export default function Lotes({ initialState = 'enabled' }) {
  const [lots, setLots] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingLot, setEditingLot] = useState(null);
  const [form] = Form.useForm();
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const mapRef = useRef();
  const isMobile = useIsMobile();
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const canCreate = hasPermission(currentUser, PERMISSIONS.LOTS_CREATE);
  const canEdit = hasPermission(currentUser, PERMISSIONS.LOTS_EDIT);
  // Drawer handlers ---
  const openDrawer = (lot = null) => {
    if (lot ? !canEdit : !canCreate) return;
    setEditingLot(lot);
    if (lot) {
      form.setFieldsValue({
        name: lot.name ?? "",
        area: lot.area ?? undefined,
        location: ensureString(safeParse(lot.location) || lot.location),
      });
    } else {
      form.resetFields();

      navigator.geolocation?.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;

          const userLocation = {
            type: "Point",
            coordinates: [longitude, latitude],
          };

          form.setFieldsValue({
            location: JSON.stringify(userLocation),
          });

          
        },
        (error) => {
          console.warn("No se pudo obtener la ubicación del usuario:", error.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
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
      setRefresh(value => value + 1);
      closeDrawer();
    } catch (error) {
      console.error("→ save lot error:", error);
      notification.error({ message: getUserFriendlyError(error, "No se pudo guardar el lote.") });
    }
  };


  const changeEnabled = async (lot, enabled) => {
    const permission = enabled ? PERMISSIONS.LOTS_ENABLE : PERMISSIONS.LOTS_DISABLE;
    if (!hasPermission(currentUser, permission)) return;
    if (enabled) await api.put('/lots/enable/' + getId(lot));
    else await api.delete('/lots/' + getId(lot));
    notification.success({ message: enabled ? 'Lote habilitado exitosamente' : 'Lote deshabilitado exitosamente' });
    setRefresh(value => value + 1);
  };
  return <>
    <LotsOverview user={currentUser} initialState={initialState} refresh={refresh} onLotsLoaded={setLots} onCreate={() => openDrawer()} onEdit={openDrawer} onDisable={lot => changeEnabled(lot, false)} onEnable={lot => changeEnabled(lot, true)} />
      {/* Drawer para agregar/editar */}
      <Drawer
        title={editingLot ? "Editar Lote" : "Agregar Nuevo Lote"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        width={isMobile ? "100%" : 420}
        height={isMobile ? "90vh" : undefined}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnHidden
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
        >
          <MapSelector
            lots={lots.filter(lot => lot.enabled !== false)}
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

  </>;
}


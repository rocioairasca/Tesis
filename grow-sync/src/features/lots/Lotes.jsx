import React, { useState, useRef, useCallback } from 'react';
import { Button, Drawer, Form, Input, Alert, notification } from 'antd';
import api from '../../services/apiClient';
import useIsMobile from '../../hooks/useIsMobile';
import MapSelector from '../../components/MapSelector';
import { PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from '../../utils/permissions';
import { getUserFriendlyError } from '../../utils/userFriendlyErrors';
import LotsOverview from './LotsOverview';
import { displayGeometry } from '../../utils/mapGeometry.mjs';

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
  const [calculatedArea, setCalculatedArea] = useState(null);
  const [mapLocation, setMapLocation] = useState(null);
  const location = Form.useWatch('location', form);
  const hasStoredGeometry = Boolean(editingLot?.geom);
  const hasPolygon = displayGeometry(location)?.type === 'Polygon';
  const canSaveGeometry = hasPolygon || hasStoredGeometry;
  const selectPolygon = useCallback(data => {
    form.setFieldsValue({ location: ensureString(data.location) });
    setCalculatedArea(Number(data.calculatedArea));
  }, [form]);
  const isMobile = useIsMobile();
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const canCreate = hasPermission(currentUser, PERMISSIONS.LOTS_CREATE);
  const canEdit = hasPermission(currentUser, PERMISSIONS.LOTS_EDIT);
  // Drawer handlers ---
  const openDrawer = (lot = null) => {
    if (lot ? !canEdit : !canCreate) return;
    setEditingLot(lot);
    setCalculatedArea(lot?.geom ? Number(lot.area_ha) : null);
    form.resetFields();
    if (lot) form.setFieldsValue({ name: lot.name ?? '' });
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsMapModalOpen(false);
    setMapLocation(null);
    setIsDrawerOpen(false);
    setEditingLot(null);
    form.resetFields();
  };

  // Agregar o Editar Lote
  const handleSubmit = async (values) => {
    if (!canSaveGeometry) return;
    const payload = {
      name: values.name?.trim(),
      ...(values.location ? { location: ensureString(values.location) } : {}),
    };

    try {
      const isEditing = editingLot && getId(editingLot);
      const { data } = isEditing
        ? await api.put(`/lots/${getId(editingLot)}`, payload)
        : await api.post('/lots', payload);
      // Turf is only a drawing estimate. Adopt the committed PostGIS value before closing;
      // the overview/context are then reloaded from the backend, including area_ha.
      setCalculatedArea(Number(data.lot.area_ha));
      form.setFieldsValue({ location: undefined });
      notification.success({ message: isEditing ? 'Lote actualizado exitosamente' : 'Lote creado exitosamente' });
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

          {editingLot && !hasStoredGeometry && !hasPolygon && <Alert type="warning" showIcon
            message="Este lote todavía no tiene una superficie geográfica definida. Dibujala en el mapa para continuar." />}
          <Form.Item label="Superficie" style={{ marginTop: 16 }}>
            <output aria-label="Superficie calculada">{canSaveGeometry && calculatedArea > 0
              ? `${hasPolygon ? 'Superficie estimada' : 'Superficie calculada'}: ${calculatedArea.toLocaleString('es-AR', { maximumFractionDigits: 4 })} ha`
              : 'Superficie: pendiente de dibujar'}</output>
          </Form.Item>
          {!canSaveGeometry && <p>Dibujá la superficie del lote en el mapa antes de guardarlo.</p>}

          <Form.Item name="location" hidden>
            <Input />
          </Form.Item>

          <Form.Item>
            <Button type="default" onClick={() => {
              setMapLocation(safeParse(form.getFieldValue('location')) || safeParse(editingLot?.geom));
              setIsMapModalOpen(true);
            }} block>
              Seleccionar ubicación en el mapa
            </Button>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" disabled={!canSaveGeometry} block>
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
          width={isMobile ? '100%' : 800}
          destroyOnHidden
          footer={<Button type="primary" onClick={() => setIsMapModalOpen(false)}>Listo</Button>}
        >
          {isMapModalOpen && <MapSelector
            lots={lots.filter(lot => lot.enabled !== false && getId(lot) !== getId(editingLot))}
            initialLocation={mapLocation}
            onSelect={selectPolygon}
            mapRef={mapRef}
          />}

        </Drawer>
      </Drawer>

  </>;
}


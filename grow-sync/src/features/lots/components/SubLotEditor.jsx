import * as turf from '@turf/turf';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import { Alert, Button, Empty, List, Space, Statistic, Tag, Typography, notification } from 'antd';
import '@geoman-io/leaflet-geoman-free';
import 'leaflet/dist/leaflet.css';

import { DeleteOutlined, Ruler, SaveOutlined } from '../../../components/AppIcons';

const { Text } = Typography;

const SUB_LOT_COLORS = ['#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00a8a8'];

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatHa = (value) => toNumber(value).toFixed(2);

const getParentFeature = (layout) => {
  const geometry = layout?.parent_geom_snapshot;
  if (!geometry) return null;
  return geometry.type === 'Feature'
    ? geometry
    : { type: 'Feature', properties: {}, geometry };
};

const getFeature = (subLot) => {
  const geometry = subLot?.geom;
  if (!geometry) return null;
  return geometry.type === 'Feature'
    ? geometry
    : { type: 'Feature', properties: {}, geometry };
};

const geoJsonToPositions = (geometry) => {
  const rawGeometry = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  const ring = rawGeometry?.coordinates?.[0];
  if (!Array.isArray(ring)) return [];
  return ring.map(([lng, lat]) => [lat, lng]);
};

const layerToGeoJsonPolygon = (layer) => {
  const latlngs = layer.getLatLngs();
  const ring = Array.isArray(latlngs?.[0]) ? latlngs[0] : latlngs;
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const coordinates = ring.map((point) => [
    Number(point.lng.toFixed(7)),
    Number(point.lat.toFixed(7)),
  ]);

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([...first]);
  }

  return {
    type: 'Polygon',
    coordinates: [coordinates],
  };
};

const nextCode = (subLots = []) => {
  const used = new Set(subLots.map((subLot) => String(subLot.code || '').toUpperCase()));
  for (let index = 0; index < 26; index += 1) {
    const code = String.fromCharCode(65 + index);
    if (!used.has(code)) return code;
  }
  return String(subLots.length + 1);
};

const FitBounds = ({ parentGeometry }) => {
  const map = useMap();

  useEffect(() => {
    const positions = geoJsonToPositions(parentGeometry);
    if (positions.length) {
      map.fitBounds(positions, { padding: [36, 36] });
    }
  }, [map, parentGeometry]);

  return null;
};

const DrawControls = ({ enabled, drawing, onDrawingChange, onCreate }) => {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !map?.pm) return undefined;

    map.pm.addControls({
      position: 'topright',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawCircle: false,
      drawText: false,
      dragMode: false,
      cutPolygon: false,
      rotateMode: false,
      removalMode: false,
      editMode: false,
      drawPolygon: true,
    });

    map.pm.setGlobalOptions({
      continueDrawing: false,
      pathOptions: {
        color: '#2f80ed',
        weight: 2,
        fillOpacity: 0.2,
      },
    });

    const handleCreate = (event) => {
      onDrawingChange(false);
      onCreate(event.layer);
      if (map.hasLayer(event.layer)) {
        map.removeLayer(event.layer);
      }
    };

    const setDrawing = () => onDrawingChange(true);
    const clearDrawing = () => onDrawingChange(false);

    map.on('pm:create', handleCreate);
    map.on('pm:drawstart', setDrawing);
    map.on('pm:drawend', clearDrawing);

    return () => {
      map.off('pm:create', handleCreate);
      map.off('pm:drawstart', setDrawing);
      map.off('pm:drawend', clearDrawing);
      map.pm.removeControls();
    };
  }, [enabled, map, onCreate, onDrawingChange]);

  useEffect(() => {
    if (!enabled || !map?.pm) return;
    if (!drawing && typeof map.pm.globalDrawModeEnabled === 'function' && map.pm.globalDrawModeEnabled()) {
      map.pm.disableDraw();
    }
  }, [drawing, enabled, map]);

  return null;
};

const EditableSubLotPolygon = ({ subLot, index, editable, drawing, onEdit }) => {
  const ref = useRef(null);
  const positions = useMemo(() => geoJsonToPositions(subLot.geom), [subLot.geom]);
  const color = SUB_LOT_COLORS[index % SUB_LOT_COLORS.length];

  useEffect(() => {
    const layer = ref.current;
    if (!layer?.pm) return undefined;

    if (editable) {
      layer.pm.enable({
        allowSelfIntersection: false,
      });
    } else {
      layer.pm.disable();
    }

    const handleEdit = () => onEdit(subLot, layer);
    layer.on('pm:edit', handleEdit);

    return () => {
      layer.off('pm:edit', handleEdit);
      layer.pm?.disable();
    };
  }, [editable, onEdit, subLot]);

  if (!positions.length) return null;

  return (
    <Polygon
      ref={ref}
      positions={positions}
      pathOptions={{
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.28,
      }}
    >
      {!drawing && (
        <Tooltip direction="center" opacity={0.95}>
          {subLot.name} - {formatHa(subLot.area_ha)} ha
        </Tooltip>
      )}
    </Polygon>
  );
};

const SubLotEditor = ({
  lot,
  layout,
  editable,
  validation,
  saving,
  onCreateSubLot,
  onUpdateSubLot,
  onDeleteSubLot,
  onValidate,
  onActivate,
  isMobile = false,
}) => {
  const [drawing, setDrawing] = useState(false);
  const parentFeature = useMemo(() => getParentFeature(layout), [layout]);
  const parentGeometry = parentFeature?.geometry;
  const subLots = layout?.sub_lots || [];
  const parentArea = toNumber(layout?.parent_area_ha_snapshot || lot?.area_ha || lot?.area);

  const assignedArea = useMemo(() => (
    subLots.reduce((acc, subLot) => acc + toNumber(subLot.area_ha), 0)
  ), [subLots]);

  const visualAreas = useMemo(() => {
    const parentApprox = parentFeature ? turf.area(parentFeature) / 10000 : parentArea;
    const assignedApprox = subLots.reduce((acc, subLot) => {
      const feature = getFeature(subLot);
      return acc + (feature ? turf.area(feature) / 10000 : toNumber(subLot.area_ha));
    }, 0);

    return {
      parent: parentApprox,
      assigned: assignedApprox,
      remaining: Math.max(parentApprox - assignedApprox, 0),
    };
  }, [parentArea, parentFeature, subLots]);

  const handleCreate = useCallback(async (layer) => {
    const geom = layerToGeoJsonPolygon(layer);
    if (!geom) {
      notification.error({ message: 'No se pudo leer el polígono dibujado' });
      return;
    }

    const code = nextCode(subLots);
    await onCreateSubLot({
      code,
      name: `${lot.name}-${code}`,
      geom,
      sort_order: subLots.length,
    });
  }, [lot.name, onCreateSubLot, subLots]);

  const handleEdit = useCallback(async (subLot, layer) => {
    const geom = layerToGeoJsonPolygon(layer);
    if (!geom) {
      notification.error({ message: 'No se pudo leer el polígono editado' });
      return;
    }

    await onUpdateSubLot(subLot.id, { geom });
  }, [onUpdateSubLot]);

  if (!parentGeometry) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Este lote no tiene geometría normalizada para editar divisiones."
      />
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(280px, 340px)',
        gap: 16,
      }}
      className="sub-lot-editor"
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ height: isMobile ? 420 : 580, width: '100%', border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden' }}>
          <MapContainer
            center={geoJsonToPositions(parentGeometry)?.[0] || [-32.4082, -63.2402]}
            zoom={14}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <TileLayer
              attribution="Imagery © Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              opacity={0.45}
            />
            <Polygon
              positions={geoJsonToPositions(parentGeometry)}
              pathOptions={{
                color: '#1f3b2d',
                weight: 3,
                fillOpacity: 0.06,
                dashArray: '8 6',
              }}
            />
            {subLots.map((subLot, index) => (
              <EditableSubLotPolygon
                key={subLot.id}
                subLot={subLot}
                index={index}
                editable={editable}
                drawing={drawing}
                onEdit={handleEdit}
              />
            ))}
            <DrawControls
              enabled={editable}
              drawing={drawing}
              onDrawingChange={setDrawing}
              onCreate={handleCreate}
            />
            <FitBounds parentGeometry={parentGeometry} />
          </MapContainer>
        </div>
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Statistic title="Lote total" value={formatHa(visualAreas.parent)} suffix="ha" />
          <Statistic title="Asignado" value={formatHa(assignedArea || visualAreas.assigned)} suffix="ha" />
          <Statistic title="Restante" value={formatHa(visualAreas.remaining)} suffix="ha" />
          <Statistic title="Sublotes" value={subLots.length} />
        </div>

        {editable ? (
          <Alert
            type="info"
            showIcon
            message="Dibujá cada sublote con la herramienta de polígono. Las áreas definitivas las calcula el backend."
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            message={`Este layout está ${layout.status}; no permite edición geométrica.`}
          />
        )}

        <List
          size="small"
          bordered
          dataSource={subLots}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sin sublotes" /> }}
          renderItem={(subLot, index) => (
            <List.Item
              actions={editable ? [
                <Button
                  key="delete"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => onDeleteSubLot(subLot.id)}
                />,
              ] : []}
            >
              <List.Item.Meta
                title={(
                  <Space size={8} wrap>
                    <Tag color="blue">{subLot.code}</Tag>
                    <Text strong>{subLot.name}</Text>
                  </Space>
                )}
                description={(
                  <Space size={6}>
                    <Ruler size={15} />
                    <span>{formatHa(subLot.area_ha)} ha</span>
                    <span style={{ color: SUB_LOT_COLORS[index % SUB_LOT_COLORS.length] }}>●</span>
                  </Space>
                )}
              />
            </List.Item>
          )}
        />

        {validation?.issues?.length ? (
          <Alert
            type="error"
            showIcon
            message="La división todavía no es válida"
            description={(
              <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            )}
          />
        ) : validation?.valid ? (
          <Alert
            type="success"
            showIcon
            message="La división cubre correctamente el 100% del lote."
          />
        ) : null}

        <Space wrap>
          <Button onClick={onValidate} loading={saving} icon={<SaveOutlined />}>
            Validar división
          </Button>
          <Button
            type="primary"
            disabled={!validation?.valid || !editable}
            loading={saving}
            onClick={onActivate}
          >
            Activar división
          </Button>
        </Space>
      </Space>
    </div>
  );
};

export default SubLotEditor;

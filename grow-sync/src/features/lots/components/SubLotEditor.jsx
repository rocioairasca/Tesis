import * as turf from '@turf/turf';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  Polygon,
  GeoJSON,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import { Alert, Button, Empty, List, Space, Statistic, Tag, Typography, notification } from 'antd';
import L from '../../../utils/leafletGeoman';
import { useLeafletGeoman } from '../../../hooks/useLeafletGeoman';
import 'leaflet/dist/leaflet.css';

import { DeleteOutlined, PlusOutlined, Ruler, SaveOutlined } from '../../../components/AppIcons';

const { Text } = Typography;

const SUB_LOT_COLORS = ['#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00a8a8'];
const SNAP_DISTANCE_PX = 40;
const SHARED_BORDER_TOLERANCE_METERS = 0.75;
const SMALL_REMAINING_AREA_HA = 0.05;
const COVERAGE_TOLERANCE_HA = 0.10;
const COVERAGE_TOLERANCE_PERCENT = 0.5;
const SNAP_OPTIONS = {
  snappable: true,
  snapDistance: SNAP_DISTANCE_PX,
  snapVertex: true,
  snapMiddle: true,
  snapSegment: true,
  requireSnapToFinish: false,
  allowSelfIntersection: false,
  tooltips: false,
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatHa = (value) => toNumber(value).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const formatPercent = (value) => toNumber(value).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const isCoverageWithinTolerance = (remainingHa, parentAreaHa) => {
  const missingHa = Math.max(toNumber(remainingHa), 0);
  const parentHa = toNumber(parentAreaHa);
  const missingPercent = parentHa > 0 ? (missingHa / parentHa) * 100 : 0;

  return missingHa <= COVERAGE_TOLERANCE_HA
    || missingPercent <= COVERAGE_TOLERANCE_PERCENT;
};

const statusEditMessage = {
  active: 'Esta división ya está en uso. Para realizar cambios, creá una nueva división.',
  locked: 'Esta división es histórica y no puede modificarse.',
  archived: 'Esta división está archivada y no puede modificarse.',
};

const issueMessage = {
  invalid_geometry: 'Hay un sublote con un contorno que necesita ajustes.',
  not_contained: 'Parte de un sublote quedó fuera de los límites del lote.',
  scope_mismatch: 'Hay un sublote que no corresponde a este lote.',
  overlap: 'Hay sublotes que se superponen.',
  area_sum_mismatch: 'La suma de superficies no coincide con la superficie total del lote.',
  coverage_mismatch: 'Todavía queda superficie del lote sin asignar.',
};

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

const roundCoord = ([lng, lat]) => [
  Number(lng.toFixed(7)),
  Number(lat.toFixed(7)),
];

const sameCoord = (a, b) => (
  a && b && a[0] === b[0] && a[1] === b[1]
);

const closeRing = (coordinates) => {
  if (!coordinates.length) return coordinates;
  const closed = [...coordinates];
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (!sameCoord(first, last)) closed.push([...first]);
  return closed;
};

const getGeometryRing = (geometry) => {
  const rawGeometry = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  const ring = rawGeometry?.coordinates?.[0];
  return Array.isArray(ring) ? ring.map(roundCoord) : [];
};

const getReferenceRings = (layout, ignoreSubLotId = null) => {
  const rings = [];
  const parentRing = getGeometryRing(layout?.parent_geom_snapshot);
  if (parentRing.length) rings.push(parentRing);

  (layout?.sub_lots || []).forEach((subLot) => {
    if (ignoreSubLotId && subLot.id === ignoreSubLotId) return;
    const ring = getGeometryRing(subLot.geom);
    if (ring.length) rings.push(ring);
  });

  return rings;
};

const coordDistanceMeters = (a, b) => {
  if (!a || !b) return Infinity;
  return turf.distance(turf.point(a), turf.point(b), { units: 'meters' });
};

const snapCoordToReferences = (coord, referenceRings) => {
  let best = { coord, distance: Infinity };
  let parentBest = { coord, distance: Infinity };

  referenceRings.forEach((ring, ringIndex) => {
    ring.forEach((referenceCoord) => {
      const distance = coordDistanceMeters(coord, referenceCoord);
      if (distance < best.distance) {
        best = { coord: referenceCoord, distance };
      }
      if (ringIndex === 0 && distance < parentBest.distance) {
        parentBest = { coord: referenceCoord, distance };
      }
    });

    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      const line = turf.lineString([start, end]);
      const snapped = turf.nearestPointOnLine(line, turf.point(coord), { units: 'meters' });
      const distance = Number(snapped?.properties?.dist ?? Infinity);
      if (distance < best.distance) {
        best = { coord: roundCoord(snapped.geometry.coordinates), distance };
      }
      if (ringIndex === 0 && distance < parentBest.distance) {
        parentBest = { coord: roundCoord(snapped.geometry.coordinates), distance };
      }
    }
  });

  if (parentBest.distance <= SHARED_BORDER_TOLERANCE_METERS) {
    return roundCoord(parentBest.coord);
  }

  return best.distance <= SHARED_BORDER_TOLERANCE_METERS
    ? roundCoord(best.coord)
    : roundCoord(coord);
};

const locationOnEdge = (coord, edgeStart, edgeEnd) => {
  const edge = turf.lineString([edgeStart, edgeEnd]);
  const snapped = turf.nearestPointOnLine(edge, turf.point(coord), { units: 'meters' });
  const distance = Number(snapped?.properties?.dist ?? Infinity);
  if (distance > SHARED_BORDER_TOLERANCE_METERS) return null;

  const total = turf.length(edge, { units: 'meters' });
  const location = Number(snapped?.properties?.location ?? 0);
  if (location < -0.01 || location > total + 0.01) return null;
  return Math.max(0, Math.min(total, location));
};

const withSharedBorderVertices = (ring, referenceRings) => {
  if (ring.length < 4) return ring;

  const output = [];
  const openRing = ring.slice(0, -1);

  for (let index = 0; index < openRing.length; index += 1) {
    const start = openRing[index];
    const end = openRing[(index + 1) % openRing.length];
    output.push(start);

    const sharedVertices = [];
    referenceRings.forEach((referenceRing) => {
      referenceRing.slice(0, -1).forEach((referenceCoord) => {
        if (sameCoord(referenceCoord, start) || sameCoord(referenceCoord, end)) return;
        const location = locationOnEdge(referenceCoord, start, end);
        if (location == null) return;
        sharedVertices.push({ coord: referenceCoord, location });
      });
    });

    sharedVertices
      .sort((a, b) => a.location - b.location)
      .forEach(({ coord }) => {
        if (!sameCoord(output[output.length - 1], coord)) output.push(coord);
      });
  }

  return closeRing(output);
};

const normalizePolygonToReferences = (geom, layout, ignoreSubLotId = null) => {
  const ring = geom?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return geom;

  const referenceRings = getReferenceRings(layout, ignoreSubLotId);
  if (!referenceRings.length) return geom;

  const openRing = ring.slice(0, -1).map((coord) => snapCoordToReferences(coord, referenceRings));
  const withInsertedVertices = withSharedBorderVertices(closeRing(openRing), referenceRings);

  return {
    ...geom,
    coordinates: [withInsertedVertices],
  };
};

const getRemainingFeature = (parentFeature, subLots) => {
  if (!parentFeature || !subLots.length) return null;
  const assignedFeatures = subLots.map(getFeature).filter(Boolean);
  if (!assignedFeatures.length) return null;

  try {
    return turf.difference(turf.featureCollection([parentFeature, ...assignedFeatures]));
  } catch (error) {
    console.warn('No se pudo calcular la superficie restante visualmente:', error);
    return null;
  }
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

const SnapReferencePolygon = ({ geometry }) => {
  const ref = useRef(null);
  const positions = useMemo(() => geoJsonToPositions(geometry), [geometry]);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return undefined;

    layer.options.pmIgnore = false;
    layer.pm?.disable();
    L.PM?.reInitLayer?.(layer);

    return () => {
      layer.pm?.disable();
    };
  }, []);

  if (!positions.length) return null;

  return (
    <Polygon
      ref={ref}
      positions={positions}
      pathOptions={{
        color: '#1f3b2d',
        weight: 3,
        fillOpacity: 0.06,
        dashArray: '8 6',
      }}
      interactive={false}
    />
  );
};

const DrawControls = ({ enabled, drawing, onDrawingChange, onSnapChange, onCreate }) => {
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
      ...SNAP_OPTIONS,
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
    const setSnap = () => onSnapChange(true);
    const clearSnap = () => onSnapChange(false);

    map.on('pm:create', handleCreate);
    map.on('pm:drawstart', setDrawing);
    map.on('pm:drawend', clearDrawing);
    map.on('pm:snap', setSnap);
    map.on('pm:unsnap', clearSnap);

    return () => {
      map.off('pm:create', handleCreate);
      map.off('pm:drawstart', setDrawing);
      map.off('pm:drawend', clearDrawing);
      map.off('pm:snap', setSnap);
      map.off('pm:unsnap', clearSnap);
      map.pm.removeControls();
      onSnapChange(false);
    };
  }, [enabled, map, onCreate, onDrawingChange, onSnapChange]);

  useEffect(() => {
    if (!enabled || !map?.pm) return;
    if (!drawing && typeof map.pm.globalDrawModeEnabled === 'function' && map.pm.globalDrawModeEnabled()) {
      map.pm.disableDraw();
    }
  }, [drawing, enabled, map]);

  return null;
};

const EditableSubLotPolygon = ({ subLot, index, editable, drawing, onEdit, onSnapChange }) => {
  const ref = useRef(null);
  const positions = useMemo(() => geoJsonToPositions(subLot.geom), [subLot.geom]);
  const color = SUB_LOT_COLORS[index % SUB_LOT_COLORS.length];

  useEffect(() => {
    const layer = ref.current;
    if (!layer?.pm) return undefined;

    if (editable) {
      layer.pm.enable({
        ...SNAP_OPTIONS,
      });
    } else {
      layer.pm.disable();
    }

    const handleEdit = () => onEdit(subLot, layer);
    const setSnap = () => onSnapChange(true);
    const clearSnap = () => onSnapChange(false);
    layer.on('pm:edit', handleEdit);
    layer.on('pm:snap', setSnap);
    layer.on('pm:unsnap', clearSnap);

    return () => {
      layer.off('pm:edit', handleEdit);
      layer.off('pm:snap', setSnap);
      layer.off('pm:unsnap', clearSnap);
      layer.pm?.disable();
      onSnapChange(false);
    };
  }, [editable, onEdit, onSnapChange, subLot]);

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

const RemainingAreaLayer = ({ feature }) => {
  const ref = useRef(null);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    layer.options.pmIgnore = true;
    L.PM?.reInitLayer?.(layer);
  }, []);

  if (!feature?.geometry || turf.area(feature) <= 0) return null;

  return (
    <GeoJSON
      ref={ref}
      key={JSON.stringify(feature.geometry.coordinates)}
      data={feature}
      interactive={false}
      style={{
        color: '#d46b08',
        weight: 1,
        dashArray: '4 5',
        fillColor: '#faad14',
        fillOpacity: 0.18,
      }}
    />
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
  onFillRemaining,
  onValidate,
  onActivate,
  isMobile = false,
}) => {
  const [drawing, setDrawing] = useState(false);
  const [snapActive, setSnapActive] = useState(false);
  const geomanReady = useLeafletGeoman(editable);
  const parentFeature = useMemo(() => getParentFeature(layout), [layout]);
  const parentGeometry = parentFeature?.geometry;
  const subLots = layout?.sub_lots || [];
  const parentArea = toNumber(layout?.parent_area_ha_snapshot || lot?.area_ha || lot?.area);
  const remainingFeature = useMemo(() => getRemainingFeature(parentFeature, subLots), [parentFeature, subLots]);

  const assignedArea = useMemo(() => (
    subLots.reduce((acc, subLot) => acc + toNumber(subLot.area_ha), 0)
  ), [subLots]);

  const visualAreas = useMemo(() => {
    const parentApprox = parentArea || (parentFeature ? turf.area(parentFeature) / 10000 : 0);
    const assignedApprox = assignedArea;

    return {
      parent: parentApprox,
      assigned: assignedApprox,
      remaining: Math.max(parentApprox - assignedApprox, 0),
      coverage: parentApprox > 0 ? (assignedApprox / parentApprox) * 100 : 0,
    };
  }, [assignedArea, parentArea, parentFeature]);

  const hasSmallRemainingArea = visualAreas.remaining > 0.005
    && visualAreas.remaining <= SMALL_REMAINING_AREA_HA;
  const validationSummary = validation?.summary || {};
  const coverageMissingHa = validationSummary.coverage_missing_ha != null
    ? toNumber(validationSummary.coverage_missing_ha)
    : visualAreas.remaining;
  const coverageWithinTolerance = validationSummary.coverage_within_tolerance === true
    || isCoverageWithinTolerance(coverageMissingHa, visualAreas.parent);
  const showCoverageTolerance = visualAreas.remaining > 0.005 && coverageWithinTolerance;

  const handleCreate = useCallback(async (layer) => {
    const geom = layerToGeoJsonPolygon(layer);
    if (!geom) {
      notification.error({ message: 'No se pudo leer el polígono dibujado' });
      return;
    }

    const normalizedGeom = normalizePolygonToReferences(geom, layout);
    const code = nextCode(subLots);
    await onCreateSubLot({
      code,
      name: `${lot.name}-${code}`,
      geom: normalizedGeom,
      sort_order: subLots.length,
    });
  }, [layout, lot.name, onCreateSubLot, subLots]);

  const handleEdit = useCallback(async (subLot, layer) => {
    const geom = layerToGeoJsonPolygon(layer);
    if (!geom) {
      notification.error({ message: 'No se pudo leer el polígono editado' });
      return;
    }

    const normalizedGeom = normalizePolygonToReferences(geom, layout, subLot.id);
    await onUpdateSubLot(subLot.id, { geom: normalizedGeom });
  }, [layout, onUpdateSubLot]);

  if (!parentGeometry) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Este lote todavía no tiene un contorno listo para editar divisiones."
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
            <SnapReferencePolygon
              key={`parent-${geomanReady ? 'geoman' : 'plain'}`}
              geometry={parentGeometry}
            />
            <RemainingAreaLayer
              key={`remaining-${geomanReady ? 'geoman' : 'plain'}`}
              feature={remainingFeature}
            />
            {subLots.map((subLot, index) => (
              <EditableSubLotPolygon
                key={`${subLot.id}-${geomanReady ? 'geoman' : 'plain'}`}
                subLot={subLot}
                index={index}
                editable={editable && geomanReady}
                drawing={drawing}
                onEdit={handleEdit}
                onSnapChange={setSnapActive}
              />
            ))}
            {geomanReady ? (
              <DrawControls
                enabled={editable}
                drawing={drawing}
                onDrawingChange={setDrawing}
                onSnapChange={setSnapActive}
                onCreate={handleCreate}
              />
            ) : null}
            <FitBounds parentGeometry={parentGeometry} />
          </MapContainer>
        </div>
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Statistic title="Superficie total" value={formatHa(visualAreas.parent)} suffix="ha" />
          <Statistic title="Asignada" value={formatHa(assignedArea || visualAreas.assigned)} suffix="ha" />
          <Statistic title="Sin asignar" value={formatHa(visualAreas.remaining)} suffix="ha" />
          <Statistic title="Cobertura" value={formatPercent(visualAreas.coverage)} suffix="%" />
        </div>

        {showCoverageTolerance ? (
          <Tag color="green" style={{ alignSelf: 'flex-start' }}>
            Dentro de tolerancia
          </Tag>
        ) : null}

        {editable && snapActive ? (
          <Alert
            type="success"
            showIcon
            message="Punto alineado con un borde o vértice existente."
          />
        ) : null}

        {editable ? (
          <Alert
            type="info"
            showIcon
            message="Dibujá cada sublote con la herramienta de polígono. Las superficies se recalculan al guardar."
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            message={statusEditMessage[layout.status] || 'Esta división no puede modificarse.'}
          />
        )}

        {hasSmallRemainingArea && !coverageWithinTolerance ? (
          <Alert
            type="warning"
            showIcon
            message="Queda una pequeña superficie sin asignar."
            description={`Sin asignar: ${formatHa(visualAreas.remaining)} ha.`}
          />
        ) : null}

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
                  <li key={`${issue.code}-${index}`}>{issueMessage[issue.code] || issue.message}</li>
                ))}
              </ul>
            )}
          />
        ) : validation?.valid ? (
          <Alert
            type="success"
            showIcon
            message={showCoverageTolerance
              ? 'La división está dentro de la tolerancia de cobertura.'
              : 'La división cubre correctamente el lote.'}
          />
        ) : null}

        <Space wrap>
          {editable && subLots.length > 0 ? (
            <Button
              onClick={onFillRemaining}
              loading={saving}
              icon={<PlusOutlined />}
              disabled={visualAreas.remaining <= 0.005}
            >
              Crear sublote con superficie restante
            </Button>
          ) : null}
          <Button onClick={onValidate} loading={saving} icon={<SaveOutlined />}>
            Comprobar división
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

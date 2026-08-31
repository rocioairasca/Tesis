import * as turf from '@turf/turf';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  Polygon,
  Polyline,
  GeoJSON,
  TileLayer,
  Tooltip as LeafletTooltip,
  useMap,
} from 'react-leaflet';
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  notification,
} from 'antd';
import L from '../../../utils/leafletGeoman';
import { ensureLeafletGeoman } from '../../../utils/leafletGeoman';
import { useLeafletGeoman } from '../../../hooks/useLeafletGeoman';
import 'leaflet/dist/leaflet.css';

import {
  AimOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
} from '../../../components/AppIcons';

const { Text } = Typography;

const SUB_LOT_COLORS = ['#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00a8a8'];
const SNAP_DISTANCE_PX = 40;
const SHARED_BORDER_TOLERANCE_METERS = 0.75;
const SMALL_REMAINING_AREA_HA = 0.05;
const COVERAGE_TOLERANCE_HA = 0.10;
const COVERAGE_TOLERANCE_PERCENT = 0.5;
const AREA_TOLERANCE_HA = 0.03;
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

const getDraftId = (subLot) => subLot?.client_id || subLot?.id;

const getGeometryAreaHa = (geom) => {
  if (!geom) return 0;
  const feature = geom.type === 'Feature' ? geom : { type: 'Feature', properties: {}, geometry: geom };
  try {
    return turf.area(feature) / 10000;
  } catch {
    return 0;
  }
};

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
  coverage_excess: 'La superficie asignada excede la superficie total del lote.',
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
    if (ignoreSubLotId && getDraftId(subLot) === ignoreSubLotId) return;
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

const createTempId = () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ensureMapGeomanReady = async (map) => {
  if (!map) return false;
  await ensureLeafletGeoman();
  L.PM?.reInitLayer?.(map);

  if (!map.pm || typeof map.pm.setGlobalOptions !== 'function') {
    return false;
  }

  const currentOptions = typeof map.pm.getGlobalOptions === 'function'
    ? map.pm.getGlobalOptions()
    : {};
  map.pm.setGlobalOptions(currentOptions || {});
  return true;
};

const ensureLayerGeomanReady = (layer, map) => {
  if (!layer || !map?.pm || !L.PM) return false;
  layer.options.pmIgnore = false;
  L.PM.reInitLayer?.(layer);
  return Boolean(layer.pm && typeof layer.pm.enable === 'function' && typeof layer.pm.disable === 'function');
};

const withDraftFields = (subLot) => ({
  ...subLot,
  client_id: subLot.client_id || subLot.id || createTempId(),
  area_ha: getGeometryAreaHa(subLot.geom) || toNumber(subLot.area_ha),
  target_area_ha: subLot.target_area_ha ?? null,
  isNew: Boolean(subLot.isNew),
  isDirty: Boolean(subLot.isDirty),
});

const mapDraftSubLotToApiDto = (subLot, index) => {
  const geom = subLot.geom?.type === 'Feature' ? subLot.geom.geometry : subLot.geom;
  if (!geom?.type || !Array.isArray(geom?.coordinates)) {
    throw new Error(`El contorno de ${subLot.name || subLot.code || 'un sublote'} no es válido.`);
  }

  return {
    id: subLot.id || null,
    clientId: subLot.id ? undefined : getDraftId(subLot),
    code: subLot.code,
    name: subLot.name,
    geom,
    sort_order: Number.isInteger(Number(subLot.sort_order)) ? Number(subLot.sort_order) : index,
    enabled: subLot.enabled !== undefined ? subLot.enabled : true,
  };
};

const getSinglePolygonGeometry = (feature) => {
  const geometry = feature?.geometry || feature;
  if (geometry?.type === 'Polygon') return geometry;
  if (geometry?.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates)) return null;

  const largest = geometry.coordinates
    .map((coordinates) => ({
      coordinates,
      area: getGeometryAreaHa({ type: 'Polygon', coordinates }),
    }))
    .sort((a, b) => b.area - a.area)[0];

  return largest?.coordinates ? { type: 'Polygon', coordinates: largest.coordinates } : null;
};

const getPolygonGeometryContainingPoint = (feature, lngLat) => {
  const geometry = feature?.geometry || feature;
  if (geometry?.type === 'Polygon') return geometry;
  if (geometry?.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates)) return null;

  const point = turf.point(lngLat);
  return geometry.coordinates
    .map((coordinates) => ({ type: 'Polygon', coordinates }))
    .filter((geom) => getGeometryAreaHa(geom) > 0.0001)
    .find((geom) => turf.booleanPointInPolygon(point, geom))
    || null;
};

const getAvailablePolygonForCut = (feature, lngLat) => {
  const geometry = feature?.geometry || feature;
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return turf.booleanPointInPolygon(turf.point(lngLat), geometry) ? geometry : null;
  }
  return getPolygonGeometryContainingPoint(geometry, lngLat);
};

const getPolygonGeometriesFromFeature = (feature) => {
  const geometry = feature?.geometry || feature;
  if (geometry?.type === 'Polygon') return [geometry];
  if (geometry?.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates)) return [];

  return geometry.coordinates
    .map((coordinates) => ({ type: 'Polygon', coordinates }))
    .filter((geom) => getGeometryAreaHa(geom) > 0.0001)
    .sort((a, b) => getGeometryAreaHa(b) - getGeometryAreaHa(a));
};

const intersectFeatures = (featureA, featureB) => {
  try {
    return turf.intersect(turf.featureCollection([featureA, featureB]));
  } catch (error) {
    try {
      return turf.intersect(featureA, featureB);
    } catch {
      console.warn('No se pudo calcular la intersección local:', error);
      return null;
    }
  }
};

const getProjectionRange = (geometry, normal) => {
  const [minX, minY, maxX, maxY] = turf.bbox(geometry);
  const margin = Math.max(maxX - minX, maxY - minY, 0.001) * 4;
  const corners = [
    [minX - margin, minY - margin],
    [minX - margin, maxY + margin],
    [maxX + margin, minY - margin],
    [maxX + margin, maxY + margin],
  ];
  const projections = corners.map(([lng, lat]) => lng * normal[0] + lat * normal[1]);
  return {
    min: Math.min(...projections),
    max: Math.max(...projections),
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
  };
};

const makeHalfPlanePolygon = (range, normal, threshold, side) => {
  const corners = [
    [range.minX, range.minY],
    [range.maxX, range.minY],
    [range.maxX, range.maxY],
    [range.minX, range.maxY],
  ];
  const inside = ([lng, lat]) => {
    const projection = lng * normal[0] + lat * normal[1];
    return side === 'low' ? projection <= threshold : projection >= threshold;
  };
  const intersectEdge = (a, b) => {
    const projectionA = a[0] * normal[0] + a[1] * normal[1];
    const projectionB = b[0] * normal[0] + b[1] * normal[1];
    const ratio = (threshold - projectionA) / (projectionB - projectionA);
    return [
      a[0] + (b[0] - a[0]) * ratio,
      a[1] + (b[1] - a[1]) * ratio,
    ];
  };

  const clipped = [];
  corners.forEach((current, index) => {
    const previous = corners[(index + corners.length - 1) % corners.length];
    const currentInside = inside(current);
    const previousInside = inside(previous);

    if (currentInside && !previousInside) clipped.push(intersectEdge(previous, current));
    if (currentInside) clipped.push(current);
    if (!currentInside && previousInside) clipped.push(intersectEdge(previous, current));
  });

  return clipped.length >= 3 ? turf.polygon([closeRing(clipped)]) : null;
};

const getClippedAreaCandidate = (availableFeature, range, normal, threshold, side) => {
  const halfPlane = makeHalfPlanePolygon(range, normal, threshold, side);
  if (!halfPlane) return null;
  const clipped = intersectFeatures(availableFeature, halfPlane);
  const geom = getSinglePolygonGeometry(clipped);
  if (!geom) return null;
  return {
    geom,
    areaHa: getGeometryAreaHa(geom),
  };
};

const findCutCandidate = ({ availableFeature, normal, targetAreaHa, side }) => {
  const range = getProjectionRange(availableFeature.geometry || availableFeature, normal);
  let low = range.min;
  let high = range.max;
  let best = null;

  for (let index = 0; index < 28; index += 1) {
    const threshold = (low + high) / 2;
    const candidate = getClippedAreaCandidate(availableFeature, range, normal, threshold, side);
    const areaHa = candidate?.areaHa || 0;

    if (candidate && (!best || Math.abs(areaHa - targetAreaHa) < Math.abs(best.areaHa - targetAreaHa))) {
      best = candidate;
    }

    if (Math.abs(areaHa - targetAreaHa) <= targetAreaHa * 0.01) break;

    if (side === 'low') {
      if (areaHa < targetAreaHa) low = threshold;
      else high = threshold;
    } else if (areaHa < targetAreaHa) {
      high = threshold;
    } else {
      low = threshold;
    }
  }

  return best;
};

const generateSurfaceGeometry = ({ availableFeature, cutStartLngLat, cutEndLngLat, targetAreaHa }) => {
  if (!availableFeature || toNumber(targetAreaHa) <= 0) return null;
  const dx = cutEndLngLat[0] - cutStartLngLat[0];
  const dy = cutEndLngLat[1] - cutStartLngLat[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length <= 0) return null;

  const normal = [-dy / length, dx / length];
  const polygonGeometry = getAvailablePolygonForCut(availableFeature, cutStartLngLat);
  if (!polygonGeometry) return null;

  const polygonFeature = turf.feature(polygonGeometry);
  const componentAreaHa = getGeometryAreaHa(polygonGeometry);
  if (toNumber(targetAreaHa) > componentAreaHa + AREA_TOLERANCE_HA) return null;

  const lowSide = findCutCandidate({ availableFeature: polygonFeature, normal, targetAreaHa, side: 'low' });
  const highSide = findCutCandidate({ availableFeature: polygonFeature, normal, targetAreaHa, side: 'high' });
  const candidates = [lowSide, highSide].filter(Boolean);
  const firstPoint = turf.point(cutStartLngLat);
  candidates.sort((a, b) => {
    const areaDiffA = Math.abs(a.areaHa - targetAreaHa);
    const areaDiffB = Math.abs(b.areaHa - targetAreaHa);
    if (Math.abs(areaDiffA - areaDiffB) > targetAreaHa * 0.01) return areaDiffA - areaDiffB;
    return turf.distance(firstPoint, turf.centerOfMass(turf.feature(a.geom)))
      - turf.distance(firstPoint, turf.centerOfMass(turf.feature(b.geom)));
  });

  return candidates[0]?.geom || null;
};

const computeLocalIssues = (parentFeature, subLots, parentAreaHa) => {
  const issues = [];
  const features = subLots.map((subLot) => ({ subLot, feature: getFeature(subLot) })).filter((item) => item.feature);

  features.forEach(({ subLot, feature }) => {
    if (getGeometryAreaHa(feature) <= 0.0001) {
      issues.push({ code: 'invalid_geometry', message: `${subLot.name}: superficie inválida.` });
      return;
    }

    try {
      const outside = turf.difference(turf.featureCollection([feature, parentFeature]));
      if (outside && getGeometryAreaHa(outside) > AREA_TOLERANCE_HA) {
        issues.push({ code: 'not_contained', message: `${subLot.name}: parte del sublote queda fuera del lote.` });
      }
    } catch {
      issues.push({ code: 'invalid_geometry', message: `${subLot.name}: no se pudo validar el contorno localmente.` });
    }
  });

  for (let a = 0; a < features.length; a += 1) {
    for (let b = a + 1; b < features.length; b += 1) {
      const overlap = intersectFeatures(features[a].feature, features[b].feature);
      if (overlap && getGeometryAreaHa(overlap) > AREA_TOLERANCE_HA) {
        issues.push({
          code: 'overlap',
          message: `${features[a].subLot.name} se superpone con ${features[b].subLot.name}.`,
        });
      }
    }
  }

  const assignedHa = subLots.reduce((acc, subLot) => acc + toNumber(subLot.area_ha), 0);
  const remainingHa = Math.max(toNumber(parentAreaHa) - assignedHa, 0);
  if (remainingHa > COVERAGE_TOLERANCE_HA && !isCoverageWithinTolerance(remainingHa, parentAreaHa)) {
    issues.push({ code: 'coverage_mismatch', message: `Quedan ${formatHa(remainingHa)} ha sin asignar.` });
  }

  return issues;
};

const getCompactIssueMessages = (issues) => (
  issues
    .filter((issue) => issue.code !== 'coverage_mismatch')
    .slice(0, 3)
    .map((issue) => issue.message)
);

const FitBounds = ({ parentGeometry, fitKey }) => {
  const map = useMap();
  const lastFitKeyRef = useRef(null);

  useEffect(() => {
    if (lastFitKeyRef.current === fitKey) return;
    const positions = geoJsonToPositions(parentGeometry);
    if (positions.length) {
      map.fitBounds(positions, { padding: [36, 36] });
      lastFitKeyRef.current = fitKey;
    }
  }, [fitKey, map, parentGeometry]);

  return null;
};

const MapRefBinder = ({ mapRef }) => {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) {
        mapRef.current = null;
      }
    };
  }, [map, mapRef]);

  return null;
};

const MapGeomanInitializer = ({ enabled, onReadyChange, onError }) => {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      onReadyChange(false);
      return () => {
        cancelled = true;
      };
    }

    onReadyChange(false);
    ensureMapGeomanReady(map)
      .then((ready) => {
        if (cancelled) return;
        onReadyChange(ready);
        if (!ready) {
          onError?.(new Error('Leaflet Geoman no dejó disponible map.pm.'));
        }
      })
      .catch((error) => {
        console.error('No se pudo iniciar Leaflet Geoman en el mapa:', error);
        if (!cancelled) {
          onReadyChange(false);
          onError?.(error);
        }
      });

    return () => {
      cancelled = true;
      map.pm?.disableDraw?.();
    };
  }, [enabled, map, onError, onReadyChange]);

  return null;
};

const SurfacePlacementHandler = ({ enabled, onPick, onMove }) => {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return undefined;
    const handleClick = (event) => onPick([event.latlng.lng, event.latlng.lat]);
    const handleMove = (event) => onMove?.([event.latlng.lng, event.latlng.lat]);
    map.on('click', handleClick);
    map.on('mousemove', handleMove);
    return () => {
      map.off('click', handleClick);
      map.off('mousemove', handleMove);
    };
  }, [enabled, map, onMove, onPick]);

  return null;
};

const SnapReferencePolygon = ({ geometry }) => {
  const ref = useRef(null);
  const positions = useMemo(() => geoJsonToPositions(geometry), [geometry]);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return undefined;

    try {
      layer.options.pmIgnore = false;
      layer.pm?.disable?.();
      L.PM?.reInitLayer?.(layer);
    } catch (error) {
      console.warn('No se pudo preparar la referencia de snapping:', error);
    }

    return () => {
      layer.pm?.disable?.();
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

const DrawControls = ({ enabled, drawing, onDrawingChange, onSnapChange, onCreate, onError }) => {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !map?.pm) return undefined;

    try {
      map.pm.setGlobalOptions({
        continueDrawing: false,
        ...SNAP_OPTIONS,
        pathOptions: {
          color: '#2f80ed',
          weight: 2,
          fillOpacity: 0.2,
        },
      });
    } catch (error) {
      console.error('No se pudo configurar Leaflet Geoman:', error);
      onError?.(error);
      return undefined;
    }

    const handleCreate = (event) => {
      onDrawingChange(false);
      onCreate(event.layer);
      if (map.hasLayer(event.layer)) {
        map.removeLayer(event.layer);
      }
    };

    const setSnap = () => onSnapChange(true);
    const clearSnap = () => onSnapChange(false);

    map.on('pm:create', handleCreate);
    map.on('pm:snap', setSnap);
    map.on('pm:unsnap', clearSnap);

    return () => {
      map.off('pm:create', handleCreate);
      map.off('pm:snap', setSnap);
      map.off('pm:unsnap', clearSnap);
      map.pm.disableDraw?.();
      onSnapChange(false);
    };
  }, [enabled, map, onCreate, onDrawingChange, onError, onSnapChange]);

  useEffect(() => {
    if (!enabled || !map?.pm) return;
    try {
      if (drawing) {
        map.pm.enableDraw('Polygon', {
          ...SNAP_OPTIONS,
          pathOptions: {
            color: '#2f80ed',
            weight: 2,
            fillOpacity: 0.2,
          },
        });
      } else if (typeof map.pm.globalDrawModeEnabled !== 'function' || map.pm.globalDrawModeEnabled()) {
        map.pm.disableDraw();
      }
    } catch (error) {
      console.error('No se pudo activar el dibujo del sublote:', error);
      onDrawingChange(false);
      onError?.(error);
    }
  }, [drawing, enabled, map, onDrawingChange, onError]);

  return null;
};

const EditableSubLotPolygon = ({ subLot, index, editable, geomanReady, drawing, onEdit, onSnapChange, onError }) => {
  const map = useMap();
  const ref = useRef(null);
  const frameRef = useRef(null);
  const positions = useMemo(() => geoJsonToPositions(subLot.geom), [subLot.geom]);
  const color = SUB_LOT_COLORS[index % SUB_LOT_COLORS.length];
  const draftId = getDraftId(subLot);

  useEffect(() => {
    const layer = ref.current;
    if (!geomanReady || !ensureLayerGeomanReady(layer, map)) return undefined;

    try {
      if (editable) {
        layer.pm.enable({
          ...SNAP_OPTIONS,
        });
      } else {
        layer.pm.disable();
      }
    } catch (error) {
      console.error('No se pudo habilitar edición del sublote:', error);
      onError?.(error);
      return undefined;
    }

    const emitEdit = () => {
      if (frameRef.current) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        onEdit(subLot, layer);
      });
    };
    const setSnap = () => onSnapChange(true);
    const clearSnap = () => onSnapChange(false);

    layer.on('pm:edit', emitEdit);
    layer.on('pm:update', emitEdit);
    layer.on('pm:markerdrag', emitEdit);
    layer.on('pm:markerdragend', emitEdit);
    layer.on('pm:snap', setSnap);
    layer.on('pm:unsnap', clearSnap);

    return () => {
      layer.off('pm:edit', emitEdit);
      layer.off('pm:update', emitEdit);
      layer.off('pm:markerdrag', emitEdit);
      layer.off('pm:markerdragend', emitEdit);
      layer.off('pm:snap', setSnap);
      layer.off('pm:unsnap', clearSnap);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      try {
        layer.pm?.disable?.();
      } catch (error) {
        console.warn('No se pudo limpiar edición Geoman del sublote:', error);
      }
      onSnapChange(false);
    };
  }, [draftId, editable, geomanReady, map, onEdit, onError, onSnapChange, subLot]);

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
        <LeafletTooltip direction="center" opacity={0.95}>
          {subLot.name} - {formatHa(subLot.area_ha)} ha
        </LeafletTooltip>
      )}
    </Polygon>
  );
};

const RemainingAreaLayer = ({ feature }) => {
  const ref = useRef(null);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    try {
      layer.options.pmIgnore = true;
      L.PM?.reInitLayer?.(layer);
    } catch (error) {
      console.warn('No se pudo preparar la capa de superficie restante:', error);
    }
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
  onValidate,
  onActivate,
  onSaveChanges,
  onDirtyChange,
  isMobile = false,
}) => {
  const [drawing, setDrawing] = useState(false);
  const [snapActive, setSnapActive] = useState(false);
  const [draftSubLots, setDraftSubLots] = useState([]);
  const [deletedSubLotIds, setDeletedSubLotIds] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [surfaceModalOpen, setSurfaceModalOpen] = useState(false);
  const [surfacePlacement, setSurfacePlacement] = useState(null);
  const [surfacePreviewPoint, setSurfacePreviewPoint] = useState(null);
  const [mapGeomanReady, setMapGeomanReady] = useState(false);
  const [geomanError, setGeomanError] = useState(null);
  const [surfaceForm] = Form.useForm();
  const mapRef = useRef(null);
  const lastLayoutIdRef = useRef(null);
  const packageGeomanReady = useLeafletGeoman(editable);
  const geomanReady = editable && packageGeomanReady && mapGeomanReady && !geomanError;
  const parentFeature = useMemo(() => getParentFeature(layout), [layout]);
  const parentGeometry = parentFeature?.geometry;
  const parentArea = toNumber(layout?.parent_area_ha_snapshot || lot?.area_ha || lot?.area);
  const draftLayout = useMemo(() => ({
    ...layout,
    sub_lots: draftSubLots,
  }), [draftSubLots, layout]);
  const remainingFeature = useMemo(() => getRemainingFeature(parentFeature, draftSubLots), [draftSubLots, parentFeature]);
  const layoutSubLots = layout?.sub_lots;

  useEffect(() => {
    const layoutChanged = lastLayoutIdRef.current !== layout?.id;
    if (!layoutChanged && dirty) return;
    lastLayoutIdRef.current = layout?.id;
    setDraftSubLots((layoutSubLots || []).map(withDraftFields));
    setDeletedSubLotIds([]);
    setDrawing(false);
    setSurfacePlacement(null);
  }, [dirty, layout?.id, layoutSubLots]);

  useEffect(() => {
    setGeomanError(null);
  }, [layout?.id]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = 'Tenés cambios sin guardar. ¿Querés descartarlos?';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!surfacePlacement) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSurfacePlacement(null);
        setSurfacePreviewPoint(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [surfacePlacement]);

  const assignedArea = useMemo(() => (
    draftSubLots.reduce((acc, subLot) => acc + toNumber(subLot.area_ha), 0)
  ), [draftSubLots]);

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
  const remainingAreaHa = useMemo(() => (
    remainingFeature ? getGeometryAreaHa(remainingFeature) : 0
  ), [remainingFeature]);
  const availableAreaHa = remainingFeature ? remainingAreaHa : (draftSubLots.length ? 0 : visualAreas.parent);
  const canFillRemaining = editable && remainingAreaHa > AREA_TOLERANCE_HA;
  const canCreateBySurface = editable && availableAreaHa > AREA_TOLERANCE_HA;

  const localIssues = useMemo(() => (
    parentFeature ? computeLocalIssues(parentFeature, draftSubLots, visualAreas.parent) : []
  ), [draftSubLots, parentFeature, visualAreas.parent]);

  const hasSmallRemainingArea = visualAreas.remaining > 0.005
    && visualAreas.remaining <= SMALL_REMAINING_AREA_HA;
  const validationSummary = validation?.summary || {};
  const coverageMissingHa = validationSummary.coverage_missing_ha != null
    ? toNumber(validationSummary.coverage_missing_ha)
    : visualAreas.remaining;
  const coverageWithinTolerance = validationSummary.coverage_within_tolerance === true
    || isCoverageWithinTolerance(coverageMissingHa, visualAreas.parent);
  const showCoverageTolerance = visualAreas.remaining > 0.005 && coverageWithinTolerance;
  const compactIssueMessages = useMemo(() => getCompactIssueMessages(localIssues), [localIssues]);
  const actionStateLabel = dirty
    ? 'Cambios sin guardar'
    : validation?.valid
      ? 'División válida'
      : 'Guardado';

  const setDirtyDraftSubLots = useCallback((updater) => {
    setDraftSubLots(updater);
    setDirty(true);
  }, []);

  const handleGeomanError = useCallback((error) => {
    console.error('Error en Leaflet Geoman:', error);
    setGeomanError(error);
    notification.error({
      message: 'No se pudo iniciar la edición del mapa. Intentá volver a abrir el editor.',
    });
  }, []);

  const handleCenterMap = useCallback(() => {
    const positions = geoJsonToPositions(parentGeometry);
    if (positions.length) {
      mapRef.current?.fitBounds(positions, { padding: [36, 36] });
    }
  }, [parentGeometry]);

  const startDrawing = useCallback(() => {
    if (!geomanReady) {
      notification.info({ message: 'El editor del mapa todavía se está preparando.' });
      return;
    }
    setSurfacePlacement(null);
    setDrawing(true);
  }, [geomanReady]);

  const handleCreate = useCallback((layer) => {
    const geom = layerToGeoJsonPolygon(layer);
    if (!geom) {
      notification.error({ message: 'No se pudo leer el polígono dibujado' });
      return;
    }

    const code = nextCode(draftSubLots);
    const normalizedGeom = normalizePolygonToReferences(geom, draftLayout);
    const areaHa = getGeometryAreaHa(normalizedGeom);
    setDirtyDraftSubLots((current) => [
      ...current,
      withDraftFields({
        id: null,
        client_id: createTempId(),
        code,
        name: `${lot.name}-${code}`,
        geom: normalizedGeom,
        area_ha: areaHa,
        sort_order: current.length,
        isNew: true,
        isDirty: true,
      }),
    ]);
  }, [draftLayout, draftSubLots, lot.name, setDirtyDraftSubLots]);

  const handleEdit = useCallback((subLot, layer) => {
    const geom = layerToGeoJsonPolygon(layer);
    if (!geom) {
      notification.error({ message: 'No se pudo leer el polígono editado' });
      return;
    }

    const draftId = getDraftId(subLot);
    const normalizedGeom = normalizePolygonToReferences(geom, draftLayout, draftId);
    const areaHa = getGeometryAreaHa(normalizedGeom);
    setDirtyDraftSubLots((current) => current.map((item) => (
      getDraftId(item) === draftId
        ? {
          ...item,
          geom: normalizedGeom,
          area_ha: areaHa,
          isDirty: true,
        }
        : item
    )));
  }, [draftLayout, setDirtyDraftSubLots]);

  const handleNameChange = useCallback((draftId, value) => {
    setDirtyDraftSubLots((current) => current.map((item) => (
      getDraftId(item) === draftId
        ? { ...item, name: value, isDirty: true }
        : item
    )));
  }, [setDirtyDraftSubLots]);

  const handleDeleteDraft = useCallback((subLot) => {
    Modal.confirm({
      title: 'Eliminar sublote',
      content: subLot.id
        ? 'El sublote se quitará de esta división cuando guardes los cambios.'
        : 'El sublote se quitará del borrador.',
      okText: 'Eliminar',
      cancelText: 'Cancelar',
      okButtonProps: { danger: true },
      onOk: () => {
        if (subLot.id) {
          setDeletedSubLotIds((current) => current.includes(subLot.id) ? current : [...current, subLot.id]);
        }
        setDraftSubLots((current) => current.filter((item) => getDraftId(item) !== getDraftId(subLot)));
        setDirty(true);
      },
    });
  }, []);

  const resetDraft = useCallback(() => {
    setDraftSubLots((layoutSubLots || []).map(withDraftFields));
    setDeletedSubLotIds([]);
    setDirty(false);
    setDrawing(false);
    setSurfacePlacement(null);
    setSurfacePreviewPoint(null);
  }, [layoutSubLots]);

  const confirmDiscard = useCallback(() => {
    Modal.confirm({
      title: 'Tenés cambios sin guardar. ¿Querés descartarlos?',
      okText: 'Descartar cambios',
      cancelText: 'Seguir editando',
      okButtonProps: { danger: true },
      onOk: resetDraft,
    });
  }, [resetDraft]);

  const openSurfaceModal = useCallback(() => {
    surfaceForm.setFieldsValue({
      name: `${lot.name}-${nextCode(draftSubLots)}`,
      target_area_ha: Math.max(Math.min(availableAreaHa, visualAreas.parent), 0.01),
    });
    setSurfaceModalOpen(true);
  }, [availableAreaHa, draftSubLots, lot.name, surfaceForm, visualAreas.parent]);

  const handleSurfaceSubmit = useCallback(async () => {
    const values = await surfaceForm.validateFields();
    const targetAreaHa = toNumber(values.target_area_ha);
    if (targetAreaHa > availableAreaHa + AREA_TOLERANCE_HA) {
      notification.warning({
        message: `Quedan aproximadamente ${formatHa(availableAreaHa)} ha disponibles en el lote.`,
      });
      return;
    }

    setSurfacePlacement({ ...values, cutPoints: [] });
    setSurfacePreviewPoint(null);
    setSurfaceModalOpen(false);
    setDrawing(false);
  }, [availableAreaHa, surfaceForm]);

  const handleSurfacePick = useCallback((lngLat) => {
    if (!surfacePlacement || !parentFeature) return;
    const point = turf.point(lngLat);
    if (!turf.booleanPointInPolygon(point, parentFeature)) {
      notification.warning({ message: 'Elegí un punto dentro del lote.' });
      return;
    }

    const availableFeature = remainingFeature || parentFeature;
    if (remainingFeature && !turf.booleanPointInPolygon(point, remainingFeature)) {
      notification.warning({ message: 'Esa zona ya está asignada a otro sublote.' });
      return;
    }

    if (toNumber(surfacePlacement.target_area_ha) > availableAreaHa + AREA_TOLERANCE_HA) {
      notification.warning({
        message: `Quedan aproximadamente ${formatHa(availableAreaHa)} ha disponibles en el lote.`,
      });
      return;
    }

    const cutPoints = surfacePlacement.cutPoints || [];
    if (!cutPoints.length) {
      const polygonGeometry = getAvailablePolygonForCut(availableFeature, lngLat);
      const componentAreaHa = getGeometryAreaHa(polygonGeometry);
      if (toNumber(surfacePlacement.target_area_ha) > componentAreaHa + AREA_TOLERANCE_HA) {
        notification.warning({
          message: `Quedan aproximadamente ${formatHa(componentAreaHa)} ha disponibles en esta zona.`,
        });
        return;
      }

      setSurfacePlacement((current) => current ? { ...current, cutPoints: [lngLat] } : current);
      setSurfacePreviewPoint(null);
      return;
    }

    if (turf.distance(turf.point(cutPoints[0]), point) < 0.005) {
      notification.warning({ message: 'Marcá un segundo punto distinto para definir la dirección del corte.' });
      return;
    }

    const rawGeom = generateSurfaceGeometry({
      availableFeature,
      cutStartLngLat: cutPoints[0],
      cutEndLngLat: lngLat,
      targetAreaHa: surfacePlacement.target_area_ha,
    });

    if (!rawGeom) {
      notification.error({ message: 'No se pudo generar un corte para esa superficie.' });
      return;
    }

    const code = nextCode(draftSubLots);
    const normalizedGeom = normalizePolygonToReferences(rawGeom, draftLayout);
    const areaHa = getGeometryAreaHa(normalizedGeom);

    setDirtyDraftSubLots((current) => [
      ...current,
      withDraftFields({
        id: null,
        client_id: createTempId(),
        code,
        name: surfacePlacement.name || `${lot.name}-${code}`,
        geom: normalizedGeom,
        area_ha: areaHa,
        target_area_ha: toNumber(surfacePlacement.target_area_ha),
        sort_order: current.length,
        isNew: true,
        isDirty: true,
      }),
    ]);
    setSurfacePlacement(null);
    setSurfacePreviewPoint(null);
    notification.success({
      message: 'Sublote generado',
      description: `Objetivo: ${formatHa(surfacePlacement.target_area_ha)} ha. Actual: ${formatHa(areaHa)} ha.`,
    });
  }, [availableAreaHa, draftLayout, draftSubLots, lot.name, parentFeature, remainingFeature, setDirtyDraftSubLots, surfacePlacement]);

  const handleFillRemainingLocal = useCallback(() => {
    const remainingGeometries = getPolygonGeometriesFromFeature(remainingFeature);
    if (!remainingGeometries.length) {
      notification.info({ message: 'No queda superficie sin asignar para completar.' });
      return;
    }

    setDirtyDraftSubLots((current) => {
      const nextSubLots = [...current];
      remainingGeometries.forEach((rawGeom) => {
        const code = nextCode(nextSubLots);
        const normalizedGeom = normalizePolygonToReferences(rawGeom, {
          ...draftLayout,
          sub_lots: nextSubLots,
        });
        nextSubLots.push(withDraftFields({
          id: null,
          client_id: createTempId(),
          code,
          name: `${lot.name}-${code}`,
          geom: normalizedGeom,
          area_ha: getGeometryAreaHa(normalizedGeom),
          sort_order: nextSubLots.length,
          isNew: true,
          isDirty: true,
        }));
      });
      return nextSubLots;
    });

    if (remainingGeometries.length > 1) {
      notification.warning({
        message: `Quedan ${remainingGeometries.length} sectores sin asignar.`,
        description: 'Se agregaron como sublotes separados para evitar una geometría inválida.',
      });
    }
  }, [draftLayout, lot.name, remainingFeature, setDirtyDraftSubLots]);

  const handleSaveChanges = useCallback(async () => {
    if (!dirty || !editable) return;
    let subLots;

    try {
      subLots = draftSubLots.map(mapDraftSubLotToApiDto);
    } catch (error) {
      notification.error({
        message: 'No pudimos guardar la división.',
        description: error.message,
      });
      return;
    }

    try {
      await onSaveChanges?.({
        subLots,
      });
      setDirty(false);
      setDeletedSubLotIds([]);
    } catch {
      // El contenedor muestra el error amigable y conserva el borrador local.
    }
  }, [dirty, draftSubLots, editable, onSaveChanges]);

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
    <>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(300px, 370px)',
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
            <MapRefBinder mapRef={mapRef} />
            <MapGeomanInitializer
              enabled={editable && packageGeomanReady}
              onReadyChange={setMapGeomanReady}
              onError={handleGeomanError}
            />
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
              key={`parent-${layout?.id || lot?.id}`}
              geometry={parentGeometry}
            />
            {draftSubLots.map((subLot, index) => (
              <EditableSubLotPolygon
                key={getDraftId(subLot)}
                subLot={subLot}
                index={index}
                editable={editable && geomanReady}
                geomanReady={geomanReady}
                drawing={drawing}
                onEdit={handleEdit}
                onSnapChange={setSnapActive}
                onError={handleGeomanError}
              />
            ))}
            {geomanReady ? (
              <DrawControls
                enabled={editable && geomanReady}
                drawing={drawing}
                onDrawingChange={setDrawing}
                onSnapChange={setSnapActive}
                onCreate={handleCreate}
                onError={handleGeomanError}
              />
            ) : null}
            <SurfacePlacementHandler
              enabled={editable && Boolean(surfacePlacement)}
              onPick={handleSurfacePick}
              onMove={setSurfacePreviewPoint}
            />
            {surfacePlacement?.cutPoints?.length === 1 && surfacePreviewPoint ? (
              <Polyline
                positions={[
                  [surfacePlacement.cutPoints[0][1], surfacePlacement.cutPoints[0][0]],
                  [surfacePreviewPoint[1], surfacePreviewPoint[0]],
                ]}
                pathOptions={{ color: '#1677ff', weight: 2, dashArray: '6 6' }}
              />
            ) : null}
            <FitBounds parentGeometry={parentGeometry} fitKey={layout?.id || lot?.id} />
          </MapContainer>
        </div>
      </div>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Tooltip title="Centrar mapa en el lote">
            <Button icon={<AimOutlined />} onClick={handleCenterMap}>
              Centrar mapa
            </Button>
          </Tooltip>
          {editable ? (
            <Button
              icon={<PlusOutlined />}
              onClick={startDrawing}
              disabled={!geomanReady}
            >
              Dibujar sublote
            </Button>
          ) : null}
          {canCreateBySurface ? (
            <Button
              icon={<PlusOutlined />}
              onClick={openSurfaceModal}
            >
              Dividir por superficie
            </Button>
          ) : null}
          {canFillRemaining ? (
            <Button
              icon={<PlusOutlined />}
              onClick={handleFillRemainingLocal}
            >
              Completar superficie restante ({formatHa(remainingAreaHa)} ha)
            </Button>
          ) : null}
        </Space>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
            padding: '8px 0',
            borderTop: '1px solid #f0f0f0',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <div>
            <Text type="secondary">Asignada</Text>
            <div><Text strong>{formatHa(assignedArea || visualAreas.assigned)} ha</Text></div>
          </div>
          <div>
            <Text type="secondary">Sin asignar</Text>
            <div><Text strong>{formatHa(visualAreas.remaining)} ha</Text></div>
          </div>
          <div>
            <Text type="secondary">Cobertura</Text>
            <div><Text strong>{formatPercent(visualAreas.coverage)} %</Text></div>
          </div>
        </div>

        {editable && !geomanReady && !geomanError ? (
          <Text type="secondary">El editor del mapa todavía se está preparando.</Text>
        ) : null}

        {geomanError ? (
          <Alert
            type="error"
            showIcon
            message="No se pudo iniciar la edición del mapa. Intentá volver a abrir el editor."
          />
        ) : null}

        {surfacePlacement ? (
          <Text type="secondary">
            {surfacePlacement.cutPoints?.length
              ? 'Marcá el segundo punto para definir la dirección del corte.'
              : `Marcá el primer punto de la dirección del corte para el sublote de ${formatHa(surfacePlacement.target_area_ha)} ha.`}
          </Text>
        ) : null}

        {!editable ? (
          <Alert
            type="warning"
            showIcon
            message={statusEditMessage[layout.status] || 'Esta división no puede modificarse.'}
          />
        ) : null}

        {compactIssueMessages.map((message, index) => (
          <Text key={`${message}-${index}`} type="warning">{message}</Text>
        ))}

        <List
          size="small"
          bordered
          dataSource={draftSubLots}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sin sublotes" /> }}
          renderItem={(subLot) => {
            const targetAreaHa = toNumber(subLot.target_area_ha);
            const targetDiffPercent = targetAreaHa > 0
              ? Math.abs(toNumber(subLot.area_ha) - targetAreaHa) / targetAreaHa * 100
              : 0;

            return (
              <List.Item
                actions={editable ? [
                  <Button
                    key="delete"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Eliminar sublote"
                    onClick={() => handleDeleteDraft(subLot)}
                  />,
                ] : []}
              >
                <List.Item.Meta
                  title={(
                    <Space size={8} wrap style={{ width: '100%' }}>
                      <Tag color="blue">{subLot.code}</Tag>
                      {editable ? (
                        <Input
                          size="small"
                          value={subLot.name}
                          onChange={(event) => handleNameChange(getDraftId(subLot), event.target.value)}
                          style={{ maxWidth: 220 }}
                        />
                      ) : (
                        <Text strong>{subLot.name}</Text>
                      )}
                    </Space>
                  )}
                  description={(
                    <Space size={6} wrap>
                      <Text type="secondary">{formatHa(subLot.area_ha)} ha</Text>
                      {targetAreaHa > 0 ? (
                        <Text type="secondary">Objetivo {formatHa(targetAreaHa)} ha</Text>
                      ) : null}
                      {targetAreaHa > 0 && targetDiffPercent > 3 ? (
                        <Tag color="gold">Ajustar</Tag>
                      ) : null}
                    </Space>
                  )}
                />
              </List.Item>
            );
          }}
        />

        {validation?.issues?.length ? (
          <Space direction="vertical" size={2}>
            {validation.issues.slice(0, 3).map((issue, index) => (
              <Text key={`${issue.code}-${index}`} type="danger">
                {issueMessage[issue.code] || issue.message}
              </Text>
            ))}
          </Space>
        ) : validation?.valid ? (
          <Space direction="vertical" size={2}>
            <Text type="success" strong>✓ División válida</Text>
            <Text type="secondary">
              {formatPercent(validationSummary.coverage_percent ?? visualAreas.coverage)} % de cobertura
            </Text>
            {showCoverageTolerance ? (
              <Text type="secondary">Diferencia dentro de la tolerancia permitida.</Text>
            ) : null}
          </Space>
        ) : null}

        <Space wrap>
          {editable && dirty ? (
            <>
              <Text type="warning">● Cambios sin guardar</Text>
              <Text type="secondary">Guardá los cambios antes de comprobar la división.</Text>
              <Button onClick={confirmDiscard} disabled={!dirty || saving}>
                Descartar cambios
              </Button>
              <Button
                type="primary"
                onClick={handleSaveChanges}
                loading={saving}
                disabled={!dirty || localIssues.some((issue) => issue.code === 'invalid_geometry')}
                icon={<SaveOutlined />}
              >
                Guardar cambios
              </Button>
            </>
          ) : null}
          {editable && !dirty && !validation?.valid ? (
            <Button onClick={onValidate} loading={saving} icon={<SaveOutlined />}>
              Comprobar división
            </Button>
          ) : null}
          {editable && !dirty && validation?.valid ? (
            <Button
              type="primary"
              loading={saving}
              onClick={onActivate}
            >
              Activar división
            </Button>
          ) : null}
        </Space>
      </Space>
    </div>
    <Modal
      title="Dividir por superficie"
      open={surfaceModalOpen}
      onCancel={() => {
        setSurfaceModalOpen(false);
        setSurfacePlacement(null);
        setSurfacePreviewPoint(null);
      }}
      onOk={handleSurfaceSubmit}
      okText="Definir corte"
      cancelText="Cancelar"
      destroyOnHidden
    >
      <Form layout="vertical" form={surfaceForm}>
        <Form.Item
          name="name"
          label="Nombre"
          rules={[{ required: true, message: 'Ingresá un nombre.' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="target_area_ha"
          label="Superficie deseada"
          rules={[{ required: true, message: 'Ingresá la superficie deseada.' }]}
        >
          <InputNumber
            min={0.01}
            max={Math.max(availableAreaHa, 0.01)}
            decimalSeparator=","
            precision={2}
            step={0.1}
            addonAfter="ha"
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Text type="secondary">Después marcá en el mapa la dirección del corte.</Text>
      </Form>
    </Modal>
    </>
  );
};

export default SubLotEditor;

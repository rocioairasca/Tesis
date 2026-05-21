import * as turf from '@turf/turf';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  useMap,
  Tooltip,
  LayersControl,
} from 'react-leaflet';
import { Button } from 'antd';
import { AimOutlined } from './AppIcons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';

const FALLBACK_POSITION = [-32.4082, -63.2402];

const parseLocation = (location) => {
  if (!location) return null;
  if (typeof location === "object") return location;
  try {
    return JSON.parse(location);
  } catch {
    return null;
  }
};

const getLocationRing = (location) => {
  const parsed = parseLocation(location);
  return Array.isArray(parsed) && Array.isArray(parsed[0]) && parsed[0].length
    ? parsed[0]
    : null;
};

const MapSelector = ({
  lots = [],
  selectedLocation = null,
  initialLocation = null,
  onSelect,
  modalOpen,
  insideDrawer = false,
  mapRef: externalMapRef,
}) => {
  const [userPosition, setUserPosition] = useState(null);
  const internalMapRef = useRef(null);
  const mapRef = externalMapRef || internalMapRef;
  const activeLocation = selectedLocation || initialLocation;

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        if (import.meta.env.DEV) {
          console.warn('No se pudo obtener la ubicación del navegador:', error?.message || error);
        }
        return;
        console.error('Error al obtener ubicación:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    );
  }, []);

  useEffect(() => {
    if ((modalOpen || insideDrawer) && mapRef.current) {
      setTimeout(() => {
        mapRef.current.invalidateSize();
      }, 350);
    }
  }, [modalOpen, insideDrawer, mapRef]);

  const roundCoord = useCallback((coord) => ({
    lat: parseFloat(coord.lat.toFixed(6)),
    lng: parseFloat(coord.lng.toFixed(6)),
  }), []);

  const normalizePolygon = useCallback((latlngs) => {
    if (!Array.isArray(latlngs) || latlngs.length === 0) return null;

    const ring = Array.isArray(latlngs[0]) ? [...latlngs[0]] : [...latlngs];
    if (ring.length === 0) return null;

    const normalized = ring.map(roundCoord);

    const first = normalized[0];
    const last = normalized[normalized.length - 1];

    if (first.lat !== last.lat || first.lng !== last.lng) {
      normalized.push(first);
    }

    return normalized;
  }, [roundCoord]);

  const emitPolygonData = useCallback((layer) => {
    const latlngs = layer.getLatLngs();
    const polygon = normalizePolygon(latlngs);

    if (!polygon || polygon.length < 4) return;

    const geojsonPolygon = {
      type: 'Polygon',
      coordinates: [polygon.map((coord) => [coord.lng, coord.lat])],
    };

    const areaInMeters = turf.area(geojsonPolygon);
    const areaInHectares = areaInMeters / 10000;

    if (onSelect) {
      onSelect({
        location: JSON.stringify([polygon]),
        calculatedArea: areaInHectares.toFixed(2),
      });
    }
  }, [normalizePolygon, onSelect]);

  const initialCenter = useMemo(() => {
    if (activeLocation?.[0]?.[0]) {
      return [activeLocation[0][0].lat, activeLocation[0][0].lng];
    }

    const firstLotWithCoords = lots.find((lot) => {
      const ring = getLocationRing(lot.location);
      return ring?.[0];
    });

    if (firstLotWithCoords) {
      const ring = getLocationRing(firstLotWithCoords.location);
      return [ring[0].lat, ring[0].lng];
    }

    if (userPosition) {
      return [userPosition.lat, userPosition.lng];
    }

    return FALLBACK_POSITION;
  }, [activeLocation, lots, userPosition]);

  const handleRecenter = () => {
    if (!mapRef.current) return;

    if (activeLocation?.[0]?.length) {
      const bounds = activeLocation[0].map(({ lat, lng }) => [lat, lng]);
      mapRef.current.fitBounds(bounds, { padding: [40, 40] });
      return;
    }

    if (userPosition) {
      mapRef.current.setView([userPosition.lat, userPosition.lng], 15);
      return;
    }

    const allCoordinates = lots.flatMap((lot) => {
      const ring = getLocationRing(lot.location);
      return ring?.map(({ lat, lng }) => [lat, lng]) || [];
    });

    if (allCoordinates.length > 0) {
      mapRef.current.fitBounds(allCoordinates, { padding: [50, 50] });
      return;
    }

    mapRef.current.setView(FALLBACK_POSITION, 13);
  };

  return (
    <div style={{ height: '500px', width: '100%', position: 'relative' }}>
      <Button
        type="primary"
        size="small"
        icon={<AimOutlined />}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 1000,
        }}
        onClick={handleRecenter}
      />

      <MapContainer
        ref={mapRef}
        center={initialCenter}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        whenReady={() => {
          if (mapRef.current) {
            setTimeout(() => {
              mapRef.current.invalidateSize();
            }, 250);
          }
        }}
      >
        <GeomanControls
          enabled={!!onSelect}
          selectedLocation={selectedLocation}
          initialLocation={initialLocation}
          emitPolygonData={emitPolygonData}
        />

        <AutoFitMap
          selectedLocation={activeLocation}
          lots={lots}
          userPosition={userPosition}
        />

        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Mapa Callejero">
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Satélite">
            <TileLayer
              attribution="Imagery © Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {activeLocation && (
          <Polygon
            positions={activeLocation}
            pathOptions={{ color: '#FF5733', weight: 2 }}
          />
        )}

        {lots.map((lot, index) => {
          if (!lot.location) return null;

          const ring = getLocationRing(lot.location);

          if (!ring) return null;

          if (!ring) {
            console.warn('Coordenadas inválidas para el lote:', lot.id);
            return null;
          }

          const colors = [
            '#437118',
            '#FF5733',
            '#3498db',
            '#f39c12',
            '#9b59b6',
            '#1abc9c',
            '#e74c3c',
          ];
          const color = colors[index % colors.length];

          return (
            <Polygon
              key={lot.id}
              positions={[ring]}
              pathOptions={{ color, weight: 2, smoothFactor: 1 }}
            >
              <Tooltip permanent direction="center" offset={[0, 0]} opacity={1}>
                {lot.name}
              </Tooltip>
            </Polygon>
          );
        })}
      </MapContainer>
    </div>
  );
};

const GeomanControls = ({ enabled, selectedLocation, initialLocation, emitPolygonData }) => {
  const map = useMap();
  const editableLayerRef = useRef(null);
  const activeLocation = selectedLocation || initialLocation;

  useEffect(() => {
    if (!enabled || !map?.pm) return;

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
      editMode: true,
      drawPolygon: true,
    });

    map.pm.setGlobalOptions({
      continueDrawing: false,
      pathOptions: {
        color: '#437118',
        weight: 2,
      },
    });

    const clearEditableLayer = () => {
      if (editableLayerRef.current && map.hasLayer(editableLayerRef.current)) {
        map.removeLayer(editableLayerRef.current);
      }
      editableLayerRef.current = null;
    };

    const createEditableLayerFromSelected = () => {
      if (!activeLocation?.[0]?.length) return;

      clearEditableLayer();

      const latlngs = activeLocation[0].map(({ lat, lng }) => [lat, lng]);
      const polygon = L.polygon(latlngs, { color: '#437118', weight: 2 }).addTo(map);
      polygon.pm.enable();

      editableLayerRef.current = polygon;
    };

    const handleCreate = (e) => {
      clearEditableLayer();

      editableLayerRef.current = e.layer;
      editableLayerRef.current.pm.enable();

      emitPolygonData(e.layer);
    };

    const handleEdit = (e) => {
      emitPolygonData(e.layer);
    };

    createEditableLayerFromSelected();

    map.on('pm:create', handleCreate);
    map.on('pm:edit', handleEdit);

    return () => {
      map.off('pm:create', handleCreate);
      map.off('pm:edit', handleEdit);

      if (map.pm) {
        map.pm.removeControls();
      }

      clearEditableLayer();
    };
  }, [map, enabled, activeLocation, emitPolygonData]);

  return null;
};

const AutoFitMap = ({ selectedLocation, lots, userPosition }) => {
  const map = useMap();

  useEffect(() => {
    if (selectedLocation?.[0]?.length) {
      const bounds = selectedLocation[0].map(({ lat, lng }) => [lat, lng]);
      map.fitBounds(bounds, { padding: [40, 40] });
      return;
    }

    if (userPosition) {
      map.setView([userPosition.lat, userPosition.lng], 15);
      return;
    }

    const allCoordinates = lots.flatMap((lot) => {
      const ring = getLocationRing(lot.location);
      return ring?.map(({ lat, lng }) => [lat, lng]) || [];
    });

    if (allCoordinates.length > 0) {
      map.fitBounds(allCoordinates, { padding: [50, 50] });
    }
  }, [map, selectedLocation, lots, userPosition]);

  return null;
};

export default MapSelector;

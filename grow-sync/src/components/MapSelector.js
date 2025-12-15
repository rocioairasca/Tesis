import * as turf from '@turf/turf';
import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, FeatureGroup, useMap, Tooltip, LayersControl } from 'react-leaflet';
import { Button } from 'antd';
import { AimOutlined } from '@ant-design/icons';
import { EditControl } from 'react-leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import useIsMobile from '../hooks/useIsMobile';

const MapSelector = ({ lots = [], selectedLocation = null, onSelect, modalOpen, insideDrawer = false }) => {
  const [userPosition, setUserPosition] = useState(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  const mapRef = useRef(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const pos = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserPosition(pos);
        setIsLoadingLocation(false);
      },
      (error) => {
        console.error("Error al obtener ubicación:", error);
        // Si falla la geolocalización, usar posición por defecto de Argentina
        setUserPosition({ lat: -32.4082, lng: -63.2402 });
        setIsLoadingLocation(false);
      }
    );
  }, []);

  useEffect(() => {
    if ((modalOpen || insideDrawer) && mapRef.current) {
      setTimeout(() => {
        mapRef.current.invalidateSize();
      }, 100);
      // Second call to ensure tiles load
      setTimeout(() => {
        mapRef.current.invalidateSize();
      }, 500);
    }
  }, [modalOpen, insideDrawer]);

  const roundCoord = (coord) => ({
    lat: parseFloat(coord.lat.toFixed(6)),
    lng: parseFloat(coord.lng.toFixed(6))
  });

  const _onCreated = (e) => {
    const layer = e.layer;
    let drawnCoords = layer.getLatLngs();

    if (Array.isArray(drawnCoords) && drawnCoords.length > 0) {
      const polygon = drawnCoords[0];

      if (polygon.length > 0) {
        const first = roundCoord(polygon[0]);
        const last = roundCoord(polygon[polygon.length - 1]);

        // Comparar lat y lng redondeados
        if (first.lat !== last.lat || first.lng !== last.lng) {
          polygon.push(first); // Agregamos el primer punto al final para cerrar
        }

        // Transformamos a GeoJSON
        const geojsonPolygon = {
          type: "Polygon",
          coordinates: [
            polygon.map(coord => [coord.lng, coord.lat]) // Atención: [lng, lat] para turf
          ]
        };

        // Calculamos el área
        const areaInMeters = turf.area(geojsonPolygon);
        const areaInHectares = areaInMeters / 10000; // Convertimos a hectáreas

        console.log("Área calculada:", areaInHectares.toFixed(2), "ha");

        if (onSelect) {
          // Enviamos tanto el polígono como el área
          onSelect({
            location: JSON.stringify(drawnCoords),
            calculatedArea: areaInHectares.toFixed(2) // dejamos 2 decimales
          });
        }
      }
    }
  };

  const handleRecenter = () => {
    if (mapRef.current && lots.length > 0) {
      const allCoordinates = lots.flatMap(lot => {
        try {
          const parsed = JSON.parse(lot.location);
          return parsed[0].map(({ lat, lng }) => [lat, lng]);
        } catch (e) {
          return [];
        }
      });

      if (allCoordinates.length > 0) {
        mapRef.current.fitBounds(allCoordinates, { padding: [50, 50] });
      }
    }
  };

  // Mostrar loading mientras se obtiene la ubicación
  if (isLoadingLocation) {
    return (
      <div style={{ height: '500px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', marginBottom: '8px', fontWeight: '500' }}>Obteniendo ubicación...</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Por favor, permite el acceso a tu ubicación</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '500px', width: '100%', position: 'relative' }}>
      <Button
        type="primary"
        size="small"
        icon={<AimOutlined />}
        style={{
          position: "absolute",
          top: insideDrawer
            ? 250
            : isMobile
              ? 60
              : 60,
          right: insideDrawer
            ? 10
            : isMobile
              ? 10
              : 10,
          zIndex: 1000
        }}
        onClick={handleRecenter}
      />

      <MapContainer
        ref={mapRef}
        center={[userPosition.lat, userPosition.lng]}
        zoom={13}
        style={{ height: '100%', width: '100%', zIndex: 1 }}
        whenReady={() => {
          if (mapRef.current) {
            setTimeout(() => {
              mapRef.current.invalidateSize();
            }, 100);
          }
        }}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Mapa Callejero">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Satélite">
            <TileLayer
              attribution='Imagery © NASA'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {selectedLocation && (
          <Polygon
            positions={selectedLocation}
            pathOptions={{ color: "#FF5733", weight: 2 }}
          />
        )}

        {lots.map((lot, index) => {
          if (!lot.location) return null;

          let coordinates;
          try {
            coordinates = JSON.parse(lot.location);
          } catch (error) {
            console.error("Error al parsear coordenadas del lote:", error);
            return null;
          }

          if (!Array.isArray(coordinates) || coordinates.length === 0 || !coordinates[0][0]) {
            console.warn("Coordenadas inválidas para el lote:", lot.id);
            return null;
          }

          const colors = ["#437118", "#FF5733", "#3498db", "#f39c12", "#9b59b6", "#1abc9c", "#e74c3c"];
          const color = colors[index % colors.length];

          return (
            <Polygon
              key={lot.id}
              positions={coordinates}
              pathOptions={{ color: color, weight: 2, smoothFactor: 1 }}
            >
              <Tooltip permanent direction="center" offset={[0, 0]} opacity={1}>
                {lot.name}
              </Tooltip>
            </Polygon>
          );
        })}

        {selectedLocation && <FlyToSelectedLocation selectedLocation={selectedLocation} />}

        {onSelect && (
          <FeatureGroup>
            <EditControl
              position="topright"
              draw={{
                rectangle: false,
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false,
                polygon: { shapeOptions: { color: '#437118' } },
              }}
              edit={{ edit: false, remove: false }}
              onCreated={_onCreated}
            />
          </FeatureGroup>
        )}
      </MapContainer>
    </div>
  );
};

const FlyToSelectedLocation = ({ selectedLocation }) => {
  const map = useMap();

  useEffect(() => {
    if (selectedLocation && selectedLocation.length > 0) {
      const bounds = selectedLocation[0].map(({ lat, lng }) => [lat, lng]);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [selectedLocation, map]);

  return null;
};

export default MapSelector;



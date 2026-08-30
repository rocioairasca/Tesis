import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const parseJsonValue = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const normalizeLegacyPositions = (value) => {
    if (!Array.isArray(value)) return null;
    if (!value.length) return null;

    const normalizePoint = (point) => {
        if (!point) return null;
        if (point.lat !== undefined && point.lng !== undefined) {
            const lat = Number(point.lat);
            const lng = Number(point.lng);
            return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
        }
        if (Array.isArray(point) && point.length >= 2) {
            const lat = Number(point[0]);
            const lng = Number(point[1]);
            return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
        }
        return null;
    };

    if (value[0]?.lat !== undefined || (Array.isArray(value[0]) && typeof value[0][0] !== 'object')) {
        const ring = value.map(normalizePoint).filter(Boolean);
        return ring.length >= 3 ? ring : null;
    }

    const rings = value
        .map((ring) => Array.isArray(ring) ? ring.map(normalizePoint).filter(Boolean) : [])
        .filter((ring) => ring.length >= 3);

    return rings.length ? rings : null;
};

const locationToPositions = (location) => {
    const parsed = parseJsonValue(location);
    return normalizeLegacyPositions(parsed);
};

const geoJsonToPositions = (geometry) => {
    const parsed = parseJsonValue(geometry);
    const rawGeometry = parsed?.type === 'Feature' ? parsed.geometry : parsed;

    if (rawGeometry?.type === 'FeatureCollection') {
        const polygons = (rawGeometry.features || [])
            .map((feature) => geoJsonToPositions(feature))
            .filter(Boolean);
        return polygons.length ? polygons : null;
    }

    const convertRing = (ring) => (
        Array.isArray(ring)
            ? ring
                .map(([lng, lat]) => {
                    const parsedLat = Number(lat);
                    const parsedLng = Number(lng);
                    return Number.isFinite(parsedLat) && Number.isFinite(parsedLng)
                        ? [parsedLat, parsedLng]
                        : null;
                })
                .filter(Boolean)
            : []
    );

    if (rawGeometry?.type === 'Polygon') {
        const rings = rawGeometry.coordinates;
        if (!Array.isArray(rings) || !Array.isArray(rings[0])) return null;
        const positions = rings.map(convertRing).filter((ring) => ring.length >= 3);
        return positions.length ? positions : null;
    }

    if (rawGeometry?.type === 'MultiPolygon') {
        const polygons = rawGeometry.coordinates
            .map((polygon) => polygon.map(convertRing).filter((ring) => ring.length >= 3))
            .filter((polygon) => polygon.length);
        return polygons.length ? polygons : null;
    }

    return null;
};

const getPositionsBounds = (positions = []) => {
    const points = [];
    const collect = (value) => {
        if (!value) return;
        if (value.lat !== undefined && value.lng !== undefined) {
            points.push([Number(value.lat), Number(value.lng)]);
            return;
        }
        if (!Array.isArray(value)) return;
        if (value.length === 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
            points.push([Number(value[0]), Number(value[1])]);
            return;
        }
        value.forEach(collect);
    };

    collect(positions);
    return points;
};

const getSelectionGeometry = (selection) => {
    if (selection?.sub_lot_id) {
        const subLotPositions = geoJsonToPositions(selection.sub_lot_geom);
        if (subLotPositions?.length) return subLotPositions;

        if (import.meta.env.DEV) {
            console.warn('La planificación referencia un sublote sin geometría renderizable.', {
                hasSubLotId: Boolean(selection.sub_lot_id),
                hasSubLotGeom: Boolean(selection.sub_lot_geom),
            });
        }
    }

    return geoJsonToPositions(selection?.lot_geom)
        || locationToPositions(selection?.lot_location || selection?.location);
};

const getParentGeometry = (selection) => (
    selection?.sub_lot_id
        ? geoJsonToPositions(selection?.lot_geom)
            || locationToPositions(selection?.lot_location || selection?.location)
        : null
);

// Componente auxiliar para ajustar el zoom al polígono
const FitBounds = ({ bounds }) => {
    const map = useMap();

    useEffect(() => {
        if (bounds && bounds.length > 0) {
            // Pequeño delay para asegurar que el mapa esté completamente renderizado
            const timer = setTimeout(() => {
                try {
                    if (bounds.length > 0) {
                        map.fitBounds(bounds, {
                            padding: [40, 40],
                            maxZoom: 18
                        });
                    }
                } catch (e) {
                    console.error("Error fitting bounds:", e);
                }
            }, 300);

            return () => clearTimeout(timer);
        }
    }, [bounds, map]);

    return null;
};

// Componente para invalidar tamaño del mapa al montar (fix rendering en drawer)
const MapInvalidator = () => {
    const map = useMap();
    useEffect(() => {
        const timer = setTimeout(() => {
            map.invalidateSize();
        }, 200);
        return () => clearTimeout(timer);
    }, [map]);
    return null;
};

const LotMapPreview = ({ location, allLots = [], selections = [] }) => {
    const selectedGeometries = useMemo(() => {
        if (Array.isArray(selections) && selections.length) {
            return selections
                .map((selection) => ({
                    id: selection.sub_lot_id || selection.lot_id || selection.id,
                    name: selection.sub_lot_name
                        ? `${selection.lot_name || selection.name} / ${selection.sub_lot_name}`
                        : (selection.lot_name || selection.name),
                    positions: getSelectionGeometry(selection),
                    parentPositions: getParentGeometry(selection),
                }))
                .filter((item) => item.positions?.length);
        }

        const positions = locationToPositions(location);
        return positions?.length ? [{ id: 'selected', name: 'Lote seleccionado', positions }] : [];
    }, [location, selections]);

    const contextGeometries = useMemo(() => {
        const parentContexts = selectedGeometries
            .filter((item) => item.parentPositions?.length)
            .map((item) => ({
                id: `parent-${item.id}`,
                positions: item.parentPositions,
            }));

        if (parentContexts.length) return parentContexts;

        return allLots
            .map((lot) => ({
                id: lot.id || lot._id,
                positions: locationToPositions(lot.location),
            }))
            .filter((item) => item.positions?.length);
    }, [allLots, selectedGeometries]);

    const bounds = useMemo(() => (
        selectedGeometries.flatMap((item) => getPositionsBounds(item.positions))
    ), [selectedGeometries]);

    if (!selectedGeometries.length) {
        return <div style={{ background: '#f0f0f0', height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sin ubicación</div>;
    }

    const center = bounds[0];

    if (!center || (Array.isArray(center) && center.length !== 2)) {
        return <div style={{ background: '#f0f0f0', height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Ubicación inválida</div>;
    }

    return (
        <div style={{ height: '200px', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid #d9d9d9' }}>
            <MapContainer
                center={center}
                zoom={15}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={false}
                dragging={false}
                zoomControl={false}
                doubleClickZoom={false}
                attributionControl={false}
            >
                <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                />

                {contextGeometries.map((item) => (
                    <Polygon
                        key={item.id}
                        positions={item.positions}
                        pathOptions={{ color: '#ffd666', weight: 2, fillOpacity: 0.04, dashArray: '6, 6' }}
                    />
                ))}

                {selectedGeometries.map((item) => (
                    <Polygon
                        key={item.id}
                        positions={item.positions}
                        pathOptions={{ color: '#FF5733', weight: 4, fillOpacity: 0.42 }}
                    >
                        <Tooltip>{item.name}</Tooltip>
                    </Polygon>
                ))}

                <FitBounds bounds={bounds} />
                <MapInvalidator />
            </MapContainer>
        </div>
    );
};

export default LotMapPreview;

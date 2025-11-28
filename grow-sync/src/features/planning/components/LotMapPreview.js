import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Componente auxiliar para ajustar el zoom al polígono
const FitBounds = ({ coords }) => {
    const map = useMap();

    useEffect(() => {
        if (coords && coords.length > 0) {
            // Pequeño delay para asegurar que el mapa esté completamente renderizado
            const timer = setTimeout(() => {
                try {
                    // Extraer coordenadas en formato [lat, lng]
                    let allCoordinates = [];

                    // Si coords es un array de arrays (polígono con anillos)
                    if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
                        // coords = [[[{lat, lng}, ...]], ...]
                        allCoordinates = coords[0].map(point =>
                            point.lat ? [point.lat, point.lng] : point
                        );
                    } else if (Array.isArray(coords[0]) && coords[0].lat) {
                        // coords = [{lat, lng}, ...]
                        allCoordinates = coords.map(point => [point.lat, point.lng]);
                    } else {
                        // coords ya está en formato [[lat, lng], ...]
                        allCoordinates = coords;
                    }

                    if (allCoordinates.length > 0) {
                        map.fitBounds(allCoordinates, {
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
    }, [coords, map]);

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

const LotMapPreview = ({ location, allLots = [] }) => {
    const coordinates = useMemo(() => {
        if (!location) return null;
        try {
            const parsed = typeof location === 'string' ? JSON.parse(location) : location;
            return parsed;
        } catch (e) {
            return null;
        }
    }, [location]);

    if (!coordinates || coordinates.length === 0) {
        return <div style={{ background: '#f0f0f0', height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sin ubicación</div>;
    }

    // Calcular centro: manejar array de puntos o array de arrays de puntos
    let firstPoint = coordinates[0];
    if (Array.isArray(firstPoint) && !Number.isFinite(firstPoint)) {
        // Es un array de arrays (ej: [[{lat, lng}, ...]])
        firstPoint = firstPoint[0];
    }

    const center = firstPoint && firstPoint.lat ? [firstPoint.lat, firstPoint.lng] : firstPoint;

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

                {/* Renderizar otros lotes como contexto (bordes visibles) */}
                {allLots.map((lot) => {
                    if (!lot.location || lot.location === location) return null;
                    try {
                        const otherCoords = typeof lot.location === 'string' ? JSON.parse(lot.location) : lot.location;
                        return (
                            <Polygon
                                key={lot.id || lot._id}
                                positions={otherCoords}
                                pathOptions={{ color: '#FFEB3B', weight: 2, fillOpacity: 0.15, dashArray: '5, 5' }}
                            />
                        );
                    } catch { return null; }
                })}

                {/* Lote principal resaltado (borde grueso, relleno visible) */}
                <Polygon positions={coordinates} pathOptions={{ color: '#FF5733', weight: 4, fillOpacity: 0.4 }} />

                <FitBounds coords={coordinates} />
                <MapInvalidator />
            </MapContainer>
        </div>
    );
};

export default LotMapPreview;

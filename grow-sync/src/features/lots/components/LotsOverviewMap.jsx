import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Tooltip, ZoomControl, LayersControl, useMap, useMapEvents } from 'react-leaflet';
import { Button, Empty } from 'antd';
import MapViewport from '../../../components/MapViewport';
import { geometryBounds, leafletBounds } from '../../../utils/mapGeometry.mjs';
import L from '../../../utils/leafletGeoman';
import { tokens } from '../../../theme/tokens';
import { flattenRows } from '../lotsOverviewModel.mjs';
import { initialLotViewport } from '../lotsMapViewport.mjs';
import 'leaflet/dist/leaflet.css';

function polygonStyle(row, selected, hover = false) {
  return {
    color: !row.enabled ? tokens.textDisabled : selected ? tokens.brand.navigation : hover ? tokens.info : row.subLot ? tokens.info : tokens.brand.primary,
    fillColor: selected ? tokens.brand.accent : row.subLot ? tokens.surfaceSelected : tokens.brand.lime,
    weight: selected ? 4 : row.children?.length ? 3 : hover ? 3 : 2,
    fillOpacity: !row.enabled ? 0.06 : selected ? 0.5 : row.children?.length ? 0.02 : 0.16,
    opacity: row.enabled ? 1 : 0.55,
    dashArray: row.children?.length ? '8 5' : !row.enabled ? '4 5' : undefined,
  };
}
function Shape({ row, selected, onSelect, showLabel }) {
  const ref = useRef();
  const decorate = layer => {
    const element = layer.getElement?.();
    if (!element) return;
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', `Seleccionar ${row.name}${row.subLot ? ' (división)' : ''}`);
    element.setAttribute('aria-pressed', String(selected));
    element.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(row.key); }
    };
  };
  useEffect(() => { ref.current?.eachLayer(decorate); }, [selected, row.key, onSelect]);
  return <GeoJSON ref={ref} data={row.geometry} style={() => polygonStyle(row, selected)}
    pointToLayer={(_, latlng) => L.circleMarker(latlng, { radius: 8 })}
    onEachFeature={(_, layer) => { layer.on('add', () => decorate(layer)); }}
    eventHandlers={{ click: () => onSelect(row.key), mouseover: () => ref.current?.setStyle(polygonStyle(row, selected, true)), mouseout: () => ref.current?.setStyle(polygonStyle(row, selected)) }}>
    <Tooltip key={String(showLabel || selected)} permanent={showLabel || selected} direction="center" opacity={0.95}>{row.name}{selected ? ' · Seleccionado' : ''}</Tooltip>
  </GeoJSON>;
}
function MapContents({ rows, selection, onSelect, fitRequest }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const shapes = flattenRows(rows).filter(row => row.geometry);
  const bounds = fitRequest.all ? geometryBounds(shapes.map(row => row.geometry)) : selection?.geometry ? geometryBounds([selection.geometry]) : initialLotViewport(rows).bounds;
  return <>
    <MapViewport bounds={leafletBounds(bounds)} requestKey={fitRequest.id} />
    {shapes.map(row => <Shape key={`${row.key}:${JSON.stringify(row.geometry)}`} row={row} selected={selection?.key === row.key} onSelect={onSelect} showLabel={zoom >= 15 && shapes.length <= 15 && !row.children?.length && !(row.subLot && selection?.key === `lot:${row.lot.id}`)} />)}
  </>;
}
export default function LotsOverviewMap({ rows, selection, onSelect, selectionRequest = 0, tiles = true }) {
  const [fitRequest, setFitRequest] = useState({ id: 0, all: false, selectionKey: null });
  const initial = initialLotViewport(rows);
  const bounds = leafletBounds(initial.bounds);
  const request = { ...fitRequest, id: `${fitRequest.id}:${selectionRequest}`, all: fitRequest.all && fitRequest.selectionKey === selection?.key && fitRequest.selectionRequest === selectionRequest };
  const choose = key => { setFitRequest(value => ({ id: value.id + 1, all: false })); onSelect(key); };
  if (!bounds) return <div className="gs-lots-map gs-lots-map-empty"><Empty description="No hay geometrías válidas para mostrar. Consultá los lotes en la vista Lista." /></div>;
  return <div className="gs-lots-map" aria-label="Mapa de lotes">
    {!selection && !request.all && initial.omittedCount > 0 && <span className="gs-lots-map-extent">{initial.omittedCount} {initial.omittedCount === 1 ? 'lote fuera' : 'lotes fuera'} del encuadre inicial</span>}
    <Button className="gs-lots-map-fit" onClick={() => setFitRequest(value => ({ id: value.id + 1, all: true, selectionKey: selection?.key, selectionRequest }))}>Ver todos en el mapa</Button>
    <MapContainer bounds={bounds} boundsOptions={{ padding: [30, 30], maxZoom: 16 }} zoomControl={false} scrollWheelZoom={false} style={{ width: '100%', height: '100%' }}>
      <ZoomControl position="topleft" zoomInTitle="Acercar mapa" zoomOutTitle="Alejar mapa" />
      {tiles && <LayersControl position="topright"><LayersControl.BaseLayer checked name="Mapa callejero"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' /></LayersControl.BaseLayer><LayersControl.BaseLayer name="Satélite"><TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Imagery © Esri" /></LayersControl.BaseLayer></LayersControl>}
      <MapContents rows={rows} selection={selection} onSelect={choose} fitRequest={request} />
    </MapContainer>
  </div>;
}


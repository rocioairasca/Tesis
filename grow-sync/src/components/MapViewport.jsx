import { useCallback, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

// Observe the actual map box: sidebar transitions, grid, drawers and view switches.
export default function MapViewport({ bounds, requestKey = '', maxZoom = 16 }) {
  const map = useMap();
  const target = useRef(bounds);
  target.current = bounds;
  const boundsKey = JSON.stringify(bounds);
  const update = useCallback(() => {
    const container = map.getContainer();
    if (!container.clientWidth || !container.clientHeight) return;
    map.invalidateSize({ pan: false, debounceMoveend: true });
    if (target.current) {
      const padding = Math.min(30, container.clientWidth / 8, container.clientHeight / 8);
      map.fitBounds(target.current, { padding: [padding, padding], maxZoom, animate: false });
    }
  }, [map, maxZoom]);
  useEffect(() => {
    const frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [update, boundsKey, requestKey]);
  useEffect(() => {
    let settle;
    const container = map.getContainer();
    let previousWidth = container.clientWidth, previousHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth, height = container.clientHeight;
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width; previousHeight = height;
      // Coalesce CSS transition frames, not an arbitrary post-mount delay.
      clearTimeout(settle);
      settle = setTimeout(update, 120);
    });
    observer.observe(container);
    return () => { observer.disconnect(); clearTimeout(settle); };
  }, [map, update]);
  return null;
}

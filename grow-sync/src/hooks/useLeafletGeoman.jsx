import { useEffect, useState } from 'react';

import L, { ensureLeafletGeoman } from '../utils/leafletGeoman';

export const useLeafletGeoman = (enabled = true) => {
  const [ready, setReady] = useState(() => !enabled || Boolean(L.PM));

  useEffect(() => {
    let mounted = true;

    if (!enabled || L.PM) {
      setReady(true);
      return () => {
        mounted = false;
      };
    }

    setReady(false);

    ensureLeafletGeoman()
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch((error) => {
        console.error('No se pudo inicializar Leaflet Geoman:', error);
        if (mounted) setReady(false);
      });

    return () => {
      mounted = false;
    };
  }, [enabled]);

  return ready;
};

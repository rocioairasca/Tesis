import L from 'leaflet';

if (typeof globalThis !== 'undefined') {
  globalThis.L = L;
}

if (typeof window !== 'undefined') {
  window.L = L;
}

let geomanPromise = null;

export const ensureLeafletGeoman = () => {
  if (!geomanPromise) {
    geomanPromise = import('@geoman-io/leaflet-geoman-free').then(() => L);
  }

  return geomanPromise;
};

export default L;

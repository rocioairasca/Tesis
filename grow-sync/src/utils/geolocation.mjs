// Browser-managed cache only: no coordinates are persisted by this helper.
export const GEOLOCATION_OPTIONS = Object.freeze({ enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
export class GeolocationError extends Error {
  constructor(code, message) { super(message); this.name = 'GeolocationError'; this.code = code; }
}
const messages = {
  permission_denied: 'GrowSync necesita permiso de ubicación. Habilitalo en la configuración del navegador.',
  position_unavailable: 'No se pudo determinar la ubicación de este dispositivo.',
  timeout: 'Se agotó el tiempo para obtener la ubicación.',
  unsupported: 'La ubicación no está disponible en este navegador o contexto. Usá una conexión HTTPS.',
};
export function getCurrentLocation({ signal, geolocation = globalThis.navigator?.geolocation,
  permissions = globalThis.navigator?.permissions, secureContext = globalThis.isSecureContext,
  options = GEOLOCATION_OPTIONS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const fail = code => finish(new GeolocationError(code, messages[code]));
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) return abort();
    if (secureContext === false || !geolocation?.getCurrentPosition) return fail('unsupported');
    signal?.addEventListener('abort', abort, { once: true });
    const settings = { ...GEOLOCATION_OPTIONS, ...options };
    timer = setTimeout(() => fail('timeout'), settings.timeout);
    const locate = () => {
      if (settled) return;
      try {
        geolocation.getCurrentPosition(position => {
          const { latitude, longitude, accuracy } = position.coords || {};
          if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return fail('position_unavailable');
          finish(null, { latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : null,
            obtainedAt: Number.isFinite(position.timestamp) ? position.timestamp : Date.now() });
        }, error => fail(({ 1: 'permission_denied', 2: 'position_unavailable', 3: 'timeout' })[error?.code] || 'position_unavailable'), settings);
      } catch { fail('position_unavailable'); }
    };
    // Unsupported/throwing Permissions API must still allow the standard browser prompt.
    Promise.resolve().then(() => permissions?.query({ name: 'geolocation' })).then(
      permission => { if (!settled) { if (permission?.state === 'denied') fail('permission_denied'); else locate(); } }, locate,
    );
  });
}

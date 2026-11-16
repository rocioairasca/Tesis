const prefix = 'growsync_registration:';
const activeKey = 'growsync_registration_active_reference';
const key = (provider, reference) => `${prefix}${provider}:${reference}`;
const missing = () => new Error('No encontramos la sesión privada de este pago. Volvé a la pestaña donde lo iniciaste.');

export function saveRegistrationToken(provider, reference, token) {
  if (!reference || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw missing();
  sessionStorage.setItem(key(provider, reference), token);
  if (provider === 'mercadopago') sessionStorage.setItem(activeKey, reference);
}
export function activeRegistrationReference() {
  return sessionStorage.getItem(activeKey);
}
export function registrationHeaders(provider, reference) {
  const token = reference && sessionStorage.getItem(key(provider, reference));
  if (!token) throw missing();
  return { 'X-Registration-Token': token, 'X-Registration-Reference': reference };
}
export function clearRegistrationToken(provider, reference) {
  sessionStorage.removeItem(key(provider, reference));
  if (sessionStorage.getItem(activeKey) === reference) sessionStorage.removeItem(activeKey);
}

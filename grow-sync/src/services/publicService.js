import publicApi from './publicApi';
import { saveRegistrationToken, registrationHeaders, activeRegistrationReference, clearRegistrationToken } from './registrationSession.mjs';

export const registerCompany = async (payload) => {
  const provider = payload.paymentId ? 'simulated' : 'mercadopago';
  const reference = payload.paymentId || payload.mercadoPagoExternalReference;
  const { data } = await publicApi.post('/public/register-company', payload,
    { headers: registrationHeaders(provider, reference) });
  clearRegistrationToken(provider, reference);
  return data;
};

export const createSimulatedPayment = async (payload) => {
  const { data } = await publicApi.post('/public/payments', payload);
  const { registrationToken, ...result } = data;
  saveRegistrationToken('simulated', result.payment.id, registrationToken);
  return result;
};

export const confirmSimulatedPayment = async (paymentId) => {
  const { data } = await publicApi.post(`/public/payments/${paymentId}/confirm`, undefined,
    { headers: registrationHeaders('simulated', paymentId) });
  return data;
};

export const getSimulatedPayment = async (paymentId) => {
  const { data } = await publicApi.get(`/public/payments/${paymentId}`,
    { headers: registrationHeaders('simulated', paymentId) });
  return data;
};

export const createMercadoPagoPreference = async ({ plan }) => {
  const { data } = await publicApi.post('/public/payments/mercadopago/preference', { plan });
  const { registrationToken, ...result } = data;
  saveRegistrationToken('mercadopago', result.preference.externalReference, registrationToken);
  return result;
};

export const getMercadoPagoPaymentByReference = async (externalReference) => {
  const { data } = await publicApi.get(
    `/public/payments/mercadopago/reference/${encodeURIComponent(externalReference)}`,
    { headers: registrationHeaders('mercadopago', externalReference) });
  return data;
};

export const getMercadoPagoPaymentStatus = async (paymentId, externalReference = activeRegistrationReference()) => {
  if (!paymentId) throw new Error('Falta el identificador del pago');
  const { data } = await publicApi.get(`/public/payments/mercadopago/payment/${encodeURIComponent(paymentId)}`,
    { headers: registrationHeaders('mercadopago', externalReference) });
  return data;
};

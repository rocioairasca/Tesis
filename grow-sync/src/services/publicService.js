import publicApi from './publicApi';

export const registerCompany = async (payload) => {
  const { data } = await publicApi.post(
    "/public/register-company",
    payload
  );

  return data;
};

export const createSimulatedPayment = async (payload) => {
  const { data } = await publicApi.post("/public/payments", payload);
  return data;
};

export const confirmSimulatedPayment = async (paymentId) => {
  const { data } = await publicApi.post(`/public/payments/${paymentId}/confirm`);
  return data;
};

export const getSimulatedPayment = async (paymentId) => {
  const { data } = await publicApi.get(`/public/payments/${paymentId}`);
  return data;
};

export const createMercadoPagoPreference = async ({ plan }) => {
  console.log("[publicService] POST /public/payments/mercadopago/preference", {
    plan,
  });

  const response = await publicApi.post(
    "/public/payments/mercadopago/preference",
    { plan }
  );

  return response.data;
};

export const getMercadoPagoPaymentByReference = async (
  externalReference
) => {
  if (!externalReference) {
    throw new Error("Falta la referencia externa del pago");
  }

  const response = await publicApi.get(
    `/public/payments/mercadopago/reference/${encodeURIComponent(
      externalReference
    )}`
  );

  return response.data;
};

export const getMercadoPagoPaymentStatus = async (paymentId) => {
  if (!paymentId) {
    throw new Error("Falta el identificador del pago");
  }

  const response = await publicApi.get(
    `/public/payments/mercadopago/payment/${encodeURIComponent(
      paymentId
    )}`
  );

  return response.data;
};

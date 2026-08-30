const DEFAULT_ERROR_MESSAGE = "No se pudo completar la operación. Intentá nuevamente.";
const NETWORK_ERROR_MESSAGE = "No pudimos conectarnos con GrowSync. Verificá tu conexión e intentá nuevamente.";

const KNOWN_BUSINESS_MESSAGES = [
  [/conflicto de fechas en lotes/i, "Ya existe una planificación para ese lote o sublote en el mismo período."],
  [/vehículo ya asignado/i, "El vehículo ya está asignado en ese período."],
  [/fecha seleccionada no corresponde/i, "La fecha seleccionada no corresponde a la campaña elegida."],
  [/layout activo|divisi[oó]n vigente/i, "El sublote seleccionado ya no corresponde a la división vigente del lote."],
  [/duplicate key.*campaign|campaigns.*unique|ya existe.*campaña|campaña.*ya existe/i, "Ya existe una campaña con ese nombre."],
  [/duplicate key.*crop|crops.*unique|unicidad.*cultivo|ya existe.*cultivo|cultivo.*ya existe/i, "Ya existe un cultivo con ese nombre."],
  [/duplicate key.*product|products.*unique|ya existe.*producto|producto.*ya existe/i, "Ya existe un producto con ese nombre."],
  [/producto.*stock|stock insuficiente/i, "No hay stock suficiente para registrar esa operación."],
  [/sublote.*superpone|superpone con otro/i, "El sublote se superpone con otra división."],
  [/superficie.*sin asignar|no queda superficie/i, "No queda superficie disponible para crear otro sublote."],
  [/varias superficies separadas|multiplieremainingregions/i, "Quedan varias superficies separadas. Revisá el dibujo antes de completar automáticamente."],
  [/division.*observaciones|layoutvalidationerror/i, "La división todavía necesita ajustes antes de usarse."],
];

const TECHNICAL_PATTERNS = [
  /\/api\//i,
  /\b(endpoint|request|response|backend|frontend|controller|route|stack|trace)\b/i,
  /\b(jwt|token|bearer|unauthorized|badrequest|internalservererror)\b/i,
  /\b(status\s*)?(400|401|403|404|409|500|502)\b/i,
  /\b(uuid|sql|postgres|postg|supabase|constraint|violates|duplicate key|null value|foreign key|not null)\b/i,
  /\b(company_id|crop_id|lot_id|sub_lot_id|planning_id|layout_id|product_id|vehicle_id|user_id)\b/i,
  /\b(PGRST|ECONN|ENOTFOUND|ETIMEDOUT|Network Error|Failed to fetch|CORS)\b/i,
];

const STATUS_MESSAGES = {
  400: "Revisá los datos ingresados e intentá nuevamente.",
  401: "Tu sesión venció. Iniciá sesión nuevamente.",
  403: "No tenés permiso para realizar esta acción.",
  404: "No encontramos el registro solicitado.",
  409: "No se pudo guardar porque hay un conflicto con datos existentes.",
};

const normalizeText = (value) => (
  typeof value === "string" ? value.trim() : ""
);

export const looksTechnical = (value) => {
  const text = normalizeText(value);
  return Boolean(text && TECHNICAL_PATTERNS.some((pattern) => pattern.test(text)));
};

export const sanitizeUserText = (value, fallback = DEFAULT_ERROR_MESSAGE) => {
  const text = normalizeText(value);
  if (!text) return fallback;

  const known = KNOWN_BUSINESS_MESSAGES.find(([pattern]) => pattern.test(text));
  if (known) return known[1];

  if (looksTechnical(text)) return fallback;
  return text;
};

const getPayloadMessage = (payload) => {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  if (Array.isArray(payload.details)) {
    const detail = payload.details.find((item) => typeof item?.message === "string");
    return detail?.message || "";
  }
  return "";
};

export const getUserFriendlyError = (error, fallback = DEFAULT_ERROR_MESSAGE) => {
  if (!error) return fallback;

  const status = error?.response?.status || error?.status;
  const payload = error?.response?.data || error?.data;
  const rawMessage = getPayloadMessage(payload) || error?.userMessage || error?.message;

  const known = KNOWN_BUSINESS_MESSAGES.find(([pattern]) => pattern.test(rawMessage || ""));
  if (known) return known[1];

  if (!error?.response && (
    error?.request ||
    /network error|failed to fetch|load failed/i.test(rawMessage || "")
  )) {
    return NETWORK_ERROR_MESSAGE;
  }

  if (status === 401) return STATUS_MESSAGES[401];
  if (status === 403) return STATUS_MESSAGES[403];
  if (status === 404) return STATUS_MESSAGES[404];
  if (status === 409) return sanitizeUserText(rawMessage, STATUS_MESSAGES[409]);
  if (status >= 500) return "No se pudo completar la operación. Intentá nuevamente en unos minutos.";
  if (status === 400) return sanitizeUserText(rawMessage, STATUS_MESSAGES[400]);

  return sanitizeUserText(rawMessage, fallback);
};

export const enrichUserFriendlyError = (error) => {
  if (error && typeof error === "object") {
    error.userMessage = getUserFriendlyError(error);
  }
  return error;
};

export const sanitizeNotification = (notification) => ({
  ...notification,
  title: sanitizeUserText(notification?.title, "Notificación de GrowSync"),
  message: sanitizeUserText(
    notification?.message || notification?.body,
    "Abrí GrowSync para revisar el detalle."
  ),
});

export const ACTIVITY_LABELS = {
  siembra: "Siembra",
  fumigacion: "Fumigación",
  fertilizacion: "Fertilización",
  cosecha: "Cosecha",
  riego: "Riego",
  mantenimiento: "Mantenimiento",
  otro: "Otra",
};

export const ACTIVITY_TAG_STYLES = {
  siembra: { color: "#2f6b3f", background: "#eef8ee", borderColor: "#cfe8d2" },
  fumigacion: { color: "#245f88", background: "#edf6ff", borderColor: "#c9e4ff" },
  fertilizacion: { color: "#6b641f", background: "#fbf8df", borderColor: "#ece3a5" },
  cosecha: { color: "#8a5a16", background: "#fff4e5", borderColor: "#f3d0a2" },
  riego: { color: "#1f6f78", background: "#eafafa", borderColor: "#bfe9ec" },
  mantenimiento: { color: "#3f5870", background: "#eef3f7", borderColor: "#d4dee8" },
  otro: { color: "#625075", background: "#f4f0f8", borderColor: "#ded2ea" },
};

export const ACTIVITY_EVENT_STYLES = {
  siembra: { color: "#2f6b3f", background: "#dff2df", borderColor: "#9dcf9f" },
  fumigacion: { color: "#245f88", background: "#dcefff", borderColor: "#8fc6f0" },
  fertilizacion: { color: "#6b641f", background: "#f5edb8", borderColor: "#d4c95c" },
  cosecha: { color: "#8a5a16", background: "#ffe1b8", borderColor: "#e6aa55" },
  riego: { color: "#1f6f78", background: "#d7f4f6", borderColor: "#86cfd7" },
  mantenimiento: { color: "#3f5870", background: "#e4edf4", borderColor: "#a6b9ca" },
  otro: { color: "#625075", background: "#ede4f5", borderColor: "#c3aed8" },
};

export const STATUS_COLORS = {
  planificado: "default",
  pendiente: "default",
  en_progreso: "processing",
  completado: "success",
  cancelado: "default",
  en_demora: "error",
};

export const STATUS_LABELS = {
  planificado: "Planificado",
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completado: "Completado",
  cancelado: "Cancelado",
  en_demora: "En demora",
};

export const formatActivity = (activityType) => (
  ACTIVITY_LABELS[activityType]
  || (activityType ? activityType.replaceAll("_", " ").replace(/^\w/, (char) => char.toUpperCase()) : "Actividad")
);

export const statusLabel = (status) => STATUS_LABELS[status] || "—";

export const getPlanningLotName = (lot) => (
  lot?.sub_lot_name ? `${lot.lot_name || lot.name} / ${lot.sub_lot_name}` : (lot?.lot_name || lot?.name)
);

export const getPlanningLotShortName = (lot) => (
  lot?.sub_lot_name || lot?.lot_name || lot?.name
);

export const summarizePlanningLots = (lots = []) => {
  const names = lots.map(getPlanningLotName).filter(Boolean);
  if (!names.length) return { text: "—", tooltip: "" };
  const [first, ...rest] = names;
  return {
    text: rest.length ? `${first} + ${rest.length} más` : first,
    tooltip: names.join("\n"),
  };
};

export const summarizePlanningLotsShort = (lots = []) => {
  const names = lots.map(getPlanningLotShortName).filter(Boolean);
  if (!names.length) return { text: "—", tooltip: "" };
  const [first, ...rest] = names;
  return {
    text: rest.length ? `${first} + ${rest.length} más` : first,
    tooltip: names.join("\n"),
  };
};

export const getCropDisplayName = (row, cropIx = {}) => {
  const cropName = row?.crop_name || cropIx[row?.crop_id];
  if (cropName) return cropName;
  if (row?.crop_id) return "Cultivo";
  return row?.title || formatActivity(row?.activity_type);
};

export const getPlanningDisplayName = (row, cropIx = {}) => {
  const activity = formatActivity(row?.activity_type);
  const cropName = row?.crop_name || cropIx[row?.crop_id];
  if (cropName) return `${cropName} - ${activity}`;
  if (row?.crop_id) return `Cultivo - ${activity}`;
  return row?.title || activity;
};

export const getPlanningEventLabel = (row, cropIx = {}) => {
  const primary = getCropDisplayName(row, cropIx);
  const lots = summarizePlanningLotsShort(row?.lots || []);
  return lots.text !== "—" ? `${primary} · ${lots.text}` : primary;
};

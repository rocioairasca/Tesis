export const numberValue = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export const formatNumber = (value, digits = 2) => numberValue(value) == null ? '—' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits }).format(Number(value));

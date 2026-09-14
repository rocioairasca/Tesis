export const calculateYieldKgHa = (productionKg, harvestedAreaHa) => {
  const production = Number(productionKg || 0);
  const area = Number(harvestedAreaHa || 0);

  if (!area || area <= 0) return 0;

  return production / area;
};

export const formatNumber = (value, decimals = 2) => {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

export const formatCropLabel = (value) => {
  if (!value) return '-';

  const normalized = String(value).toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const formatHectares = (value) => `${formatNumber(value, 2)} ha`;

// Input accepts either decimal separator, without thousands separators.
// Round before returning a number so form state/payload never contains extra decimals.
export const parseHectaresInput = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:[.,]\d*)?$/.test(text)) return '';
  const number = Number(text.replace(',', '.'));
  if (!Number.isFinite(number)) return '';
  return Number(number.toLocaleString('en-US', {
    useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }));
};

export const formatHectaresInput = (value, { userTyping, input } = {}) => {
  // Preserve the unfinished decimal separator while typing; normalize on blur.
  if (userTyping) return input;
  const number = parseHectaresInput(value);
  return number === '' ? '' : number.toLocaleString('es-AR', {
    useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
};

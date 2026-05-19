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
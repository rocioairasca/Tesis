export const convertYield = (value, unit) => {
    if (!value) return 0;

    switch (unit) {
        case 'qq':
            return value / 100;
        case 'tn':
            return value / 1000;
        case 'kg':
        default:
            return value;
    }
};

export const formatUnitLabel = (unit) => {
    switch (unit) {
        case 'qq':
            return 'qq/ha';
        case 'tn':
            return 'tn/ha';
        default:
            return 'kg/ha';
    }
};

export const formatCropLabel = (value) => {
  if (!value) return '-';

  const normalized = String(value).toLowerCase();

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const formatNumber = (value, decimals = 2) => {
    return Number(value || 0).toLocaleString('es-AR', {
        minimumFractionDigists: decimals,
        maximumFractionDigits: decimals
    });
};

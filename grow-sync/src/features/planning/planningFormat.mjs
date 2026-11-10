export const formatPlanningNumber = (value) => {
    const numericValue = Number(value ?? 0);

    return (Number.isFinite(numericValue) ? numericValue : 0).toLocaleString(
        "es-AR",
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }
    );
};

export const formatHa = (value) => `${formatPlanningNumber(value)} ha`;

export const formatPercent = (value) => `${formatPlanningNumber(value)} %`;
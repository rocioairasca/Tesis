// Operative hectares use integer hundredths; decimal rounding matches PostgreSQL.
function areaCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw fail('La superficie debe ser un número positivo.');
  const [whole, fraction = ''] = text.split('.');
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
    + (Number(fraction[2] || 0) >= 5 ? 1n : 0n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('Superficie fuera de rango.');
  return Number(cents);
}

function areaValue(cents) { return (cents / 100).toFixed(2); }
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function dateKey(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10); }

function cycleBalance(area, entries) {
  const total = areaCents(area);
  const valid = entries.filter((entry) => entry.enabled);
  const harvested = valid.reduce((sum, entry) => sum + areaCents(entry.harvested_area_ha), 0);
  const remaining = total - harvested;
  const endDate = remaining === 0 && valid.length
    ? valid.map((entry) => dateKey(entry.harvest_date)).sort().at(-1) : null;
  return { total, harvested, remaining, endDate };
}

const CLOSURE_REASONS = ['measurement_difference', 'unharvested_area', 'loss', 'weather', 'other'];
function validateManualClosure(reason, notes) {
  if (!CLOSURE_REASONS.includes(reason)) throw fail('Seleccioná un motivo de finalización válido.');
  if (reason === 'other' && !String(notes || '').trim()) throw fail('Para Otro, explicá el motivo en observaciones.');
  if (notes != null && (typeof notes !== 'string' || notes.length > 2000)) throw fail('La observación admite hasta 2000 caracteres.');
}

module.exports = { areaCents, areaValue, fail, dateKey, cycleBalance, CLOSURE_REASONS, validateManualClosure };

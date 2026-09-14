const { fail } = require('./harvestAreas');
const REASONS = ['pending_record', 'historical_regularization', 'information_correction', 'other'];
function localToday(timeZone = 'America/Argentina/Buenos_Aires', now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { throw fail('Zona horaria inválida.'); }
}
function validateEffectiveDate(date, timeZone, now) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail('La fecha debe tener formato YYYY-MM-DD.');
  const [y,m,d] = date.split('-').map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][m-1]) throw fail('Fecha de calendario inválida.');
  const today = localToday(timeZone, now);
  if (date > today) throw fail('No se permiten fechas futuras.');
  return today;
}
function validateRegistration(body, now) {
  const timezone = body.registration_timezone || 'America/Argentina/Buenos_Aires';
  const today = validateEffectiveDate(body.harvest_date, timezone, now);
  const historical = body.registered_retroactively;
  if (typeof historical !== 'boolean') throw fail('Seleccioná cosecha actual o histórica.');
  const reason = body.retroactive_reason || null;
  const notes = body.retroactive_notes == null ? null : body.retroactive_notes;
  if (notes !== null && (typeof notes !== 'string' || notes.length > 2000)) throw fail('La observación admite hasta 2000 caracteres.');
  if (historical) {
    if (body.harvest_date >= today) throw fail('La cosecha histórica requiere una fecha pasada.');
    if (!REASONS.includes(reason)) throw fail('Seleccioná un motivo retroactivo válido.');
    if (reason === 'other' && !notes?.trim()) throw fail('Para Otro, explicá el motivo retroactivo.');
  } else {
    if (body.harvest_date !== today) throw fail('Para una fecha pasada, cambiá al modo histórico.');
    if (reason || notes?.trim()) throw fail('El motivo retroactivo corresponde al modo histórico.');
  }
  return { historical, reason, notes: notes?.trim() || null, timezone };
}
module.exports = { REASONS, localToday, validateEffectiveDate, validateRegistration };

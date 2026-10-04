import {getUserFriendlyError, sanitizeUserText} from '../../utils/userFriendlyErrors.js';
import {formatCalendarDate} from '../../utils/calendarDate.js';

// Presentation only: keep server validation, payloads and audit untouched.
const messages = [
  [/movimientos? (?:de inventario|V1)|movimiento V1 asociado/i, 'Esta planificación ya modificó el inventario y no puede marcarse como histórica.'],
  [/relaciones.*inconsistentes|relaciones, empresa|relaciones inconsistentes/i, 'Encontramos datos relacionados que necesitan revisión antes de continuar.'],
  [/fecha debe ser anterior|fecha posterior al inicio/i, 'Solo pueden marcarse como históricas las actividades realizadas antes del inicio del control de inventario.'],
  [/cosechas? o cierres|cosecha\/cierre/i, 'Esta planificación tiene una cosecha relacionada y necesita una revisión antes de poder marcarse como histórica.'],
  [/registro inexistente o de otra empresa/i, 'No encontramos esta planificación entre los registros de tu empresa.'],
  [/configurá primero el inicio/i, 'Primero indicá desde qué fecha comenzaste a controlar el inventario.'],
  [/planificación debe estar completada/i, 'Solo pueden marcarse como históricas las planificaciones completadas.'],
  [/ya es histórico o pertenece a una importación/i, 'Esta planificación ya está marcada como histórica o fue incorporada al cargar registros anteriores. No puede volver a marcarse.'],
  [/tipo de actividad requiere revisión/i, 'Este tipo de actividad necesita una revisión antes de poder marcarse como histórica.'],
  [/clave ya corresponde a otra operación/i, 'Esta solicitud corresponde a otra planificación. Cerrá esta ventana y volvé a seleccionar la que querés marcar.'],
  [/confirmación explícita y clave de idempotencia|revisá los registros y la confirmación/i, 'Revisá la planificación y marcá la casilla de confirmación antes de continuar.'],
  [/hay operaciones en curso/i, 'Se están realizando otros cambios. Esperá unos momentos y volvé a intentarlo.'],
  [/base modificaría datos|efecto secundario modificaría|relación cambiaría|Adoption cannot change productive data/i, 'No se realizó el cambio porque podría alterar los datos de la planificación. Necesita una revisión antes de continuar.'],
  [/inventario cambió.*adopción cancelada/i, 'No se realizó el cambio porque podría modificar las existencias del inventario. Revisá la planificación antes de continuar.'],
  [/Inventory impact mode|Historical productive cycles/i, 'Este registro histórico no admite ese cambio. Revisá la planificación antes de continuar.'],
  [/Se requiere Admin|permisos para adoptar antecedentes/i, 'No tenés permiso para marcar esta planificación como histórica. Consultá a quien administra GrowSync en tu empresa.'],
];
const fallback = 'No podemos marcar esta planificación como histórica. Encontramos un problema que necesita revisión antes de continuar.';
export function historicalAdoptionMessage(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const known = messages.find(([pattern])=>pattern.test(text));
  if (known) return known[1];
  // Keep unknown errors visible, without displaying internal field names or IDs.
  if (/\b(Usage|completions?|persisted|inventory_impact_mode|historical_import\w*|stock_movements|stock_batches|planning_\w*|idempotenc\w*|trigger|JSONB|servicio|tabla|IDs?|ciclos? técnicos?)\b|[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(text)) return fallback;
  return sanitizeUserText(text,fallback).replace(/\b\d{4}-\d{2}-\d{2}\b/g,date=>formatCalendarDate(date,'Fecha no disponible'));
}
export function historicalAdoptionError(error, message) {
  const status=error?.response?.status||error?.status;
  const payload=error?.response?.data||error?.data;
  const raw=payload?.message||payload?.error||error?.message;
  // Preserve the application's session, connection and server-error handling.
  if ((error?.response || status) && status<500 && messages.some(([pattern])=>pattern.test(raw||''))) return historicalAdoptionMessage(raw);
  return historicalAdoptionMessage(getUserFriendlyError(error,message));
}
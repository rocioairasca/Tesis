import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

// Only for calendar fields. The ISO suffix supports older API responses that
// serialized PostgreSQL DATE as midnight UTC; never use this for timestamps.
export const calendarDateKey = (value) => {
  const text = dayjs.isDayjs(value) ? value.format('YYYY-MM-DD') : value;
  if (typeof text !== 'string') return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T00:00:00(?:\.000)?Z$)/);
  if (!match || !dayjs(match[1], 'YYYY-MM-DD', true).isValid()) return null;
  return match[1];
};

export const parseCalendarDate = (value) => {
  const key = calendarDateKey(value);
  return key ? dayjs(key, 'YYYY-MM-DD', true) : null;
};

export const formatCalendarDate = (value, fallback = '-') => {
  const key = calendarDateKey(value);
  if (!key) return fallback;
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
};

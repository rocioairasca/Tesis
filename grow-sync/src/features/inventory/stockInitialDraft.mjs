import dayjs from 'dayjs';

const prefix = company => `growsync:stock-initial:v1:${encodeURIComponent(company)}:`;
const key = (company, date) => `${prefix(company)}${date}`;
export function saveInitialDraft(company, date, rows, storage = globalThis.localStorage) {
  if (!company || !date) return false;
  try {
    const entries = rows.map(row => ({ product_id: row.product_id, quantity: row.quantity, unit: row.unit,
      expiration_month: row.expiration_period?.isValid?.() ? row.expiration_period.month() + 1 : null,
      expiration_year: row.expiration_period?.isValid?.() ? row.expiration_period.year() : null }));
    storage.setItem(key(company, date), JSON.stringify({ version: 1, entries }));
    return true;
  } catch { return false; }
}
export function readInitialDraft(company, date, storage = globalThis.localStorage) {
  if (!company || !date) return null;
  try {
    const draft = JSON.parse(storage.getItem(key(company, date)));
    if (draft?.version !== 1 || !Array.isArray(draft.entries) || draft.entries.length > 10000) return null;
    return draft.entries.map(row => {
      // InputNumber emits null when cleared; new rows use ''. Both are valid
      // unfinished quantities and must round-trip without becoming zero.
      if (!row || typeof row.product_id !== 'string' || typeof row.unit !== 'string'
        || (row.quantity !== null && !['string', 'number'].includes(typeof row.quantity))) throw new Error('Invalid draft');
      const month = row.expiration_month, year = row.expiration_year;
      if ((month != null || year != null) && (!Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2000 || year > 2100)) throw new Error('Invalid date');
      return { product_id: row.product_id, quantity: row.quantity, unit: row.unit,
        expiration_period: month == null ? null : dayjs(`${year}-${String(month).padStart(2, '0')}-01`) };
    });
  } catch { return null; }
}
export function clearInitialDrafts(company, date, storage = globalThis.localStorage) {
  if (!company) return;
  try {
    if (date) storage.removeItem(key(company, date));
    else for (const item of Object.keys(storage)) if (item.startsWith(prefix(company))) storage.removeItem(item);
  } catch { /* Unavailable device storage must not prevent confirmation. */ }
}

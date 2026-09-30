// Monthly precision is persisted as year/month only. This SQL expression is for
// comparison and ordering, never for writing expiration_date.
const effectiveExpirationSql = `COALESCE(expiration_date,
  (make_date(expiration_year,expiration_month,1) + INTERVAL '1 month - 1 day')::date)`;

function expirationFields(value) {
  const expiration_date=value.expiration_date??null;
  const expiration_year=value.expiration_year??null;
  const expiration_month=value.expiration_month??null;
  const fail=message=>Object.assign(new Error(message),{status:400});
  if((expiration_year===null)!==(expiration_month===null)) throw fail('El vencimiento mensual requiere año y mes juntos.');
  if(expiration_date!==null && expiration_year!==null) throw fail('Indicá fecha exacta o año/mes de vencimiento, no ambos.');
  if(expiration_year!==null) {
    if(!Number.isInteger(expiration_year)||expiration_year<2000||expiration_year>2100) throw fail('El año de vencimiento debe ser un entero entre 2000 y 2100.');
    if(!Number.isInteger(expiration_month)||expiration_month<1||expiration_month>12) throw fail('El mes de vencimiento debe ser un entero entre 1 y 12.');
  }
  if(expiration_date!==null) require('./stock').calendarDate(expiration_date);
  return {expiration_date,expiration_year,expiration_month};
}

module.exports={expirationFields,effectiveExpirationSql};

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRegistration, validateEffectiveDate, localToday } = require('../services/harvestRegistration');
const now = new Date('2026-09-06T12:00:00Z');
const body = { harvest_date: '2026-09-06', registered_retroactively: false };
test('current, historical and strict retroactive reason/description validation', () => {
  assert.equal(validateRegistration(body, now).historical, false);
  const historic = { harvest_date: '2026-09-05', registered_retroactively: true, retroactive_reason: 'pending_record' };
  assert.equal(validateRegistration(historic, now).reason, 'pending_record');
  assert.throws(() => validateRegistration({ ...historic, retroactive_reason: null }, now), /motivo/);
  assert.throws(() => validateRegistration({ ...historic, retroactive_reason: 'other', retroactive_notes: ' ' }, now), /Otro/);
  assert.equal(validateRegistration({ ...historic, retroactive_reason: 'other', retroactive_notes: ' cuaderno ' }, now).notes, 'cuaderno');
  assert.throws(() => validateRegistration({ ...body, harvest_date: '2026-09-07' }, now), /futuras/);
  assert.throws(() => validateRegistration({ ...body, harvest_date: '2026-09-05' }, now), /histórico/);
  assert.throws(() => validateRegistration({ ...historic, harvest_date: '2026-09-06' }, now), /pasada/);
  assert.throws(() => validateRegistration({ ...body, registered_retroactively: undefined }, now), /actual o histórica/);
  assert.throws(() => validateEffectiveDate('2026-02-30', undefined, now), /inválida/);
});
test('local today is evaluated by server in the supplied IANA zone, not server timezone', () => {
  const midnight = new Date('2026-09-06T01:00:00Z');
  assert.equal(localToday('America/Argentina/Buenos_Aires', midnight), '2026-09-05');
  assert.equal(localToday('Etc/GMT-2', midnight), '2026-09-06');
  for (const zone of ['America/Argentina/Buenos_Aires', 'Etc/GMT-2']) {
    assert.equal(validateRegistration({ ...body, harvest_date: localToday(zone, midnight), registration_timezone: zone }, midnight).historical, false);
  }
  assert.throws(() => localToday('invalid'), /inválida/);
});

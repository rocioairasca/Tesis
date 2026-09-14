-- PENDING: do not run automatically. NULL preserves unknown legacy provenance.
BEGIN;
ALTER TABLE harvest_records
  ADD COLUMN registered_retroactively boolean,
  ADD COLUMN retroactive_reason text,
  ADD COLUMN retroactive_notes text,
  ADD COLUMN registration_timezone text;
ALTER TABLE harvest_records ADD CONSTRAINT harvest_registration_trace_check CHECK (
  (registered_retroactively IS NULL AND retroactive_reason IS NULL AND retroactive_notes IS NULL AND registration_timezone IS NULL)
  OR (registered_retroactively IS FALSE AND retroactive_reason IS NULL AND retroactive_notes IS NULL AND registration_timezone IS NOT NULL)
  OR (registered_retroactively IS TRUE AND registration_timezone IS NOT NULL
    AND retroactive_reason IS NOT NULL
    AND retroactive_reason IN ('pending_record','historical_regularization','information_correction','other')
    AND (retroactive_reason <> 'other' OR COALESCE(length(btrim(retroactive_notes)),0)>0))
), ADD CONSTRAINT harvest_retroactive_notes_length CHECK (length(retroactive_notes)<=2000);
COMMIT;

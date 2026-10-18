-- Metadata of the current assignment only. Apply before deploying the API.
-- No backfill: created_by cannot prove who last reassigned an existing planning.
ALTER TABLE public.planning ADD COLUMN IF NOT EXISTS assigned_by uuid NULL REFERENCES public.users(id);
ALTER TABLE public.planning ADD COLUMN IF NOT EXISTS assigned_at timestamptz NULL;

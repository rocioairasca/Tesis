-- Phase 1: manual laboratory reports. Review only; do not apply automatically.
BEGIN;
CREATE TABLE public.soil_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 report_number text, laboratory text, received_date date,
 storage_bucket text NOT NULL CHECK(storage_bucket='soil-reports'),
 storage_path text NOT NULL,
 original_filename text NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 255),
 mime_type text NOT NULL CHECK(mime_type='application/pdf'),
 file_size bigint NOT NULL CHECK(file_size>0 AND file_size<=10485760),
 notes text, enabled boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,storage_path), UNIQUE(id,company_id),
 CHECK(storage_path=company_id::text||'/'||id::text||'/report.pdf')
);
CREATE TABLE public.soil_samples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid NOT NULL, company_id uuid NOT NULL,
 lot_id uuid NOT NULL REFERENCES public.lots(id), sub_lot_id uuid REFERENCES public.sub_lots(id),
 sample_date date NOT NULL,
 depth_from_cm numeric(8,2) CHECK(depth_from_cm>=0 AND depth_from_cm<>'NaN'::numeric),
 depth_to_cm numeric(8,2) CHECK(depth_to_cm>=0 AND depth_to_cm<>'NaN'::numeric),
 sample_name text, position_description text, sampled_by text, notes text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,company_id),
 FOREIGN KEY(report_id,company_id) REFERENCES public.soil_reports(id,company_id) ON DELETE RESTRICT,
 CHECK(depth_to_cm IS NULL OR depth_from_cm IS NULL OR depth_to_cm>=depth_from_cm)
);
CREATE TABLE public.soil_sample_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sample_id uuid NOT NULL, company_id uuid NOT NULL,
 parameter_name text NOT NULL CHECK(length(btrim(parameter_name)) BETWEEN 1 AND 200),
 method text, unit text, raw_value text NOT NULL CHECK(length(btrim(raw_value))>0),
 numeric_value numeric(20,6) CHECK(numeric_value<>'NaN'::numeric),
 result_status text NOT NULL DEFAULT 'measured' CHECK(result_status IN ('measured','not_requested','qualitative')),
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(sample_id,company_id) REFERENCES public.soil_samples(id,company_id) ON DELETE CASCADE,
 CHECK(result_status<>'not_requested' OR numeric_value IS NULL)
);
CREATE INDEX soil_reports_company_received_idx ON public.soil_reports(company_id,received_date DESC);
CREATE INDEX soil_samples_company_lot_date_idx ON public.soil_samples(company_id,lot_id,sample_date DESC);
CREATE INDEX soil_samples_report_idx ON public.soil_samples(report_id);
CREATE INDEX soil_results_sample_order_idx ON public.soil_sample_results(sample_id,sort_order);
CREATE FUNCTION public.soil_reports_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
  OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
  OR NEW.original_filename IS DISTINCT FROM OLD.original_filename OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
  OR NEW.file_size IS DISTINCT FROM OLD.file_size) THEN
  RAISE EXCEPTION 'Report ownership and document are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Report creator must belong to company' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER soil_reports_guard BEFORE INSERT OR UPDATE ON public.soil_reports FOR EACH ROW EXECUTE FUNCTION public.soil_reports_guard();
CREATE FUNCTION public.soil_samples_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.report_id IS DISTINCT FROM OLD.report_id) THEN
  RAISE EXCEPTION 'Sample ownership is immutable' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM lots WHERE id=NEW.lot_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Sample lot must belong to company' USING ERRCODE='23514';
 END IF;
 IF NEW.sub_lot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sub_lots sl JOIN lot_layouts ll ON ll.id=sl.layout_id AND ll.company_id=sl.company_id AND ll.lot_id=sl.lot_id WHERE sl.id=NEW.sub_lot_id AND sl.lot_id=NEW.lot_id AND sl.company_id=NEW.company_id AND ll.status IN ('active','locked','archived')) THEN
  RAISE EXCEPTION 'Sample division must belong to lot and company' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER soil_samples_guard BEFORE INSERT OR UPDATE ON public.soil_samples FOR EACH ROW EXECUTE FUNCTION public.soil_samples_guard();
CREATE FUNCTION public.soil_results_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.sample_id IS DISTINCT FROM OLD.sample_id) THEN
  RAISE EXCEPTION 'Result ownership is immutable' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER soil_results_guard BEFORE INSERT OR UPDATE ON public.soil_sample_results FOR EACH ROW EXECUTE FUNCTION public.soil_results_guard();
-- Access only through the authenticated API and its privileged SQL connection.
ALTER TABLE public.soil_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soil_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soil_sample_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.soil_reports,public.soil_samples,public.soil_sample_results FROM PUBLIC,anon,authenticated;
COMMIT;

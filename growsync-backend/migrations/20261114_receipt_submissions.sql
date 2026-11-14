-- P2A only. Review before applying; no inventory writes and no production execution.
BEGIN;
CREATE TABLE receipt_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_validation','rejected')),
 supplier_name text, supplier_tax_id text, document_number text, document_date date, document_type text,
 source_filename text, source_mime_type text, source_storage_key text,
 notes text, submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid REFERENCES users(id),
 rejected_at timestamptz, rejected_by uuid REFERENCES users(id), rejection_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,company_id),
 CHECK (status='draft' OR submitted_at IS NOT NULL),
 CHECK (status<>'rejected' OR (rejected_at IS NOT NULL AND rejected_by IS NOT NULL AND rejection_reason IS NOT NULL AND length(trim(rejection_reason))>0))
);
CREATE INDEX receipt_submissions_mine ON receipt_submissions(company_id,created_by,created_at DESC,id);
CREATE INDEX receipt_submissions_review ON receipt_submissions(company_id,status,document_date,created_at DESC);
CREATE INDEX receipt_submissions_document ON receipt_submissions(company_id,document_number) WHERE status<>'rejected';
CREATE TABLE receipt_submission_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, receipt_id uuid NOT NULL,
 line_number int NOT NULL CHECK (line_number>0), raw_description text NOT NULL,
 quantity numeric(20,6) CHECK (quantity>0), unit text, presentation text, supplier_batch text, expiration_date date,
 matched_product_id uuid REFERENCES products(id), match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','proposed')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(receipt_id,company_id) REFERENCES receipt_submissions(id,company_id) ON DELETE CASCADE,
 UNIQUE(receipt_id,line_number),
 CHECK ((matched_product_id IS NULL AND match_status='unmatched') OR (matched_product_id IS NOT NULL AND match_status='proposed'))
);
CREATE INDEX receipt_submission_lines_tenant ON receipt_submission_lines(company_id,receipt_id);
-- Never joined by operational queries. No P2A write endpoint for these values.
CREATE TABLE receipt_submission_economics (
 receipt_id uuid PRIMARY KEY, company_id uuid NOT NULL,
 currency text, subtotal numeric, discounts numeric, taxes numeric, total numeric, raw_extraction jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(receipt_id,company_id) REFERENCES receipt_submissions(id,company_id) ON DELETE CASCADE
);
ALTER TABLE receipt_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_submission_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_submission_economics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON receipt_submissions,receipt_submission_lines,receipt_submission_economics FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON receipt_submissions,receipt_submission_lines,receipt_submission_economics FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON receipt_submissions,receipt_submission_lines,receipt_submission_economics FROM authenticated;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON receipt_submissions,receipt_submission_lines,receipt_submission_economics TO service_role;
 END IF;
END $$;
-- Reuses Supabase Storage, private and server-only. No public URLs/policies.
-- Restrictive policies also guard against pre-existing permissive Storage policies.
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   VALUES('receipt-submissions','receipt-submissions',false,10485760,ARRAY['application/pdf','image/jpeg','image/png'])
   ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;
 END IF;
 IF to_regclass('storage.objects') IS NOT NULL THEN
  CREATE POLICY receipt_documents_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
   USING (bucket_id<>'receipt-submissions') WITH CHECK (bucket_id<>'receipt-submissions');
 END IF;
END $$;
COMMIT;

-- Isolated relational fixture. Geometry is opaque text; PostGIS operations are not simulated.
-- No tenant data or credentials. Derived from the installed schema for compatibility tests.
-- Monthly inventory fields are declared in this synthetic schema for current-service tests.
CREATE TABLE "companies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "plan" character varying,
  "subscription_status" character varying DEFAULT 'active'::character varying,
  "subscription_started_at" timestamp without time zone DEFAULT now(),
  "subscription_expires_at" timestamp without time zone,
  "subscription_source" text DEFAULT 'unknown'::text NOT NULL
);
CREATE TABLE "users" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "full_name" text,
  "role" integer DEFAULT 0,
  "created_at" timestamp without time zone DEFAULT now(),
  "auth0_id" text,
  "username" text,
  "nickname" text,
  "picture" text,
  "name" text,
  "enabled" boolean DEFAULT true,
  "auth0_sub" text,
  "company_id" uuid,
  "custom_permissions" jsonb
);
CREATE TABLE "products" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "category" text,
  "unit" text NOT NULL,
  "expiration_date" date,
  "cost" numeric,
  "created_at" timestamp without time zone DEFAULT now(),
  "enabled" boolean DEFAULT true,
  "total_quantity" numeric,
  "available_quantity" numeric,
  "price" numeric,
  "acquisition_date" date,
  "company_id" uuid,
  "active_ingredient" text,
  "formulation" text,
  "manufacturer" text,
  "minimum_stock" numeric(20,6),
  "notes" text,
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE "crops" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "campaigns" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "work_start_date" date
);
CREATE TABLE "lots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "area" numeric NOT NULL,
  "created_at" timestamp without time zone DEFAULT now(),
  "enabled" boolean DEFAULT true,
  "location" jsonb,
  "company_id" uuid,
  "geom" text,
  "area_ha" numeric(12,4),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "lot_layouts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "lot_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "name" text,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "parent_geom_snapshot" text NOT NULL,
  "parent_area_ha_snapshot" numeric(12,4) NOT NULL,
  "tolerance_ha" numeric(12,4) DEFAULT 0.0100 NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "activated_at" timestamp with time zone,
  "locked_at" timestamp with time zone,
  "archived_at" timestamp with time zone
);
CREATE TABLE "sub_lots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "layout_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "geom" text NOT NULL,
  "area_ha" numeric(12,4) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "vehicles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "type" text DEFAULT 'otro'::text NOT NULL,
  "brand" text,
  "model" text,
  "plate" text,
  "capacity" numeric,
  "notes" text,
  "status" text DEFAULT 'activo'::text NOT NULL,
  "responsible_user" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "company_id" uuid
);
CREATE TABLE "planning" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "title" text,
  "description" text,
  "activity_type" text NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone NOT NULL,
  "responsible_user" uuid NOT NULL,
  "status" text NOT NULL,
  "vehicle_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "date_range" tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[]'::text)) STORED,
  "company_id" uuid,
  "crop_id" uuid,
  "campaign_id" uuid,
  "effective_date" date,
  "completed_at" timestamp with time zone,
  "registered_retroactively" boolean DEFAULT false NOT NULL
);
CREATE TABLE "planning_lots" (
  "planning_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "sub_lot_id" uuid,
  "area_ha" numeric(12,4)
);
CREATE TABLE "planning_products" (
  "planning_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "amount" numeric,
  "unit" text,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL
);
CREATE TABLE "usage_records" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "date" date NOT NULL,
  "created_by" uuid,
  "created_at" timestamp without time zone DEFAULT now(),
  "enabled" boolean DEFAULT true,
  "product_id" uuid,
  "amount_used" numeric,
  "unit" text,
  "total_area" numeric,
  "previous_crop" text,
  "current_crop" text,
  "user_id" uuid,
  "company_id" uuid,
  "source_planning_id" uuid,
  "source_planning_product_id" uuid,
  "crop_id" uuid
);
CREATE TABLE "usage_lots" (
  "usage_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "sub_lot_id" uuid
);
CREATE TABLE "planning_product_completions" (
  "planning_product_id" uuid NOT NULL,
  "planning_id" uuid NOT NULL,
  "usage_id" uuid,
  "actual_amount" numeric(12,4) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "crop_assignments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "sub_lot_id" uuid,
  "crop_id" uuid NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date,
  "area_ha" numeric(12,2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_planning_id" uuid,
  "harvest_closure_source" text
);
CREATE TABLE "harvest_records" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "crop" text NOT NULL,
  "campaign" text NOT NULL,
  "harvest_date" date NOT NULL,
  "production_kg" numeric(14,2) NOT NULL,
  "harvested_area_ha" numeric(10,2) NOT NULL,
  "yield_kg_ha" numeric(12,2) GENERATED ALWAYS AS (
CASE
    WHEN (harvested_area_ha > (0)::numeric) THEN round((production_kg / harvested_area_ha), 2)
    ELSE (0)::numeric
END) STORED,
  "notes" text,
  "created_by" uuid,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "crop_id" uuid,
  "sub_lot_id" uuid,
  "campaign_id" uuid,
  "registered_retroactively" boolean,
  "retroactive_reason" text,
  "retroactive_notes" text,
  "registration_timezone" text
);
CREATE TABLE "harvest_crop_assignments" (
  "harvest_id" uuid NOT NULL,
  "crop_assignment_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "harvested_area_ha" numeric(12,2) NOT NULL
);
CREATE TABLE "harvest_cycle_closures" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "crop_assignment_id" uuid NOT NULL,
  "finalized_date" date NOT NULL,
  "reason" text NOT NULL,
  "notes" text,
  "created_by" uuid NOT NULL,
  "total_area_ha" numeric(12,2) NOT NULL,
  "harvested_area_ha" numeric(12,2) NOT NULL,
  "remaining_area_ha" numeric(12,2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "stock_batches" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "initial_quantity" numeric(20,6) NOT NULL,
  "available_quantity" numeric(20,6) NOT NULL,
  "unit" text NOT NULL,
  "received_date" date,
  "expiration_date" date,
  "expiration_year" smallint,
  "expiration_month" smallint,
  CONSTRAINT stock_batches_expiration_pair CHECK ((expiration_year IS NULL) = (expiration_month IS NULL)),
  CONSTRAINT stock_batches_expiration_precision CHECK (expiration_date IS NULL OR (expiration_year IS NULL AND expiration_month IS NULL)),
  CONSTRAINT stock_batches_expiration_year_range CHECK (expiration_year BETWEEN 2000 AND 2100),
  CONSTRAINT stock_batches_expiration_month_range CHECK (expiration_month BETWEEN 1 AND 12),
  "unit_price" numeric(20,6),
  "currency" text,
  "exchange_rate" numeric(20,6),
  "total_original" numeric(20,6),
  "total_ars" numeric(20,6),
  "supplier" text,
  "reference" text,
  "notes" text,
  "origin" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL
);
CREATE TABLE "stock_movements" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "movement_type" text NOT NULL,
  "quantity" numeric(20,6) NOT NULL,
  "unit" text NOT NULL,
  "usage_id" uuid,
  "operation_id" uuid NOT NULL,
  "reversed_movement_id" uuid,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text
);
CREATE TABLE "notifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "type" character varying NOT NULL,
  "priority" character varying NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb,
  "read" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "company_id" uuid
);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY (id);
ALTER TABLE "companies" ADD CONSTRAINT "companies_pkey" PRIMARY KEY (id);
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_pkey" PRIMARY KEY (id);
ALTER TABLE "crops" ADD CONSTRAINT "crops_pkey" PRIMARY KEY (id);
ALTER TABLE "harvest_crop_assignments" ADD CONSTRAINT "harvest_crop_assignments_pkey" PRIMARY KEY (harvest_id, crop_assignment_id);
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_pkey" PRIMARY KEY (id);
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_pkey" PRIMARY KEY (id);
ALTER TABLE "lot_layouts" ADD CONSTRAINT "lot_layouts_pkey" PRIMARY KEY (id);
ALTER TABLE "lots" ADD CONSTRAINT "lotes_pkey" PRIMARY KEY (id);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);
ALTER TABLE "planning" ADD CONSTRAINT "planning_pkey" PRIMARY KEY (id);
ALTER TABLE "planning_product_completions" ADD CONSTRAINT "planning_product_completions_pkey" PRIMARY KEY (planning_product_id);
ALTER TABLE "planning_products" ADD CONSTRAINT "planning_products_pkey" PRIMARY KEY (planning_id, product_id);
ALTER TABLE "products" ADD CONSTRAINT "stock_pkey" PRIMARY KEY (id);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_pkey" PRIMARY KEY (id);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY (id);
ALTER TABLE "sub_lots" ADD CONSTRAINT "sub_lots_pkey" PRIMARY KEY (id);
ALTER TABLE "usage_records" ADD CONSTRAINT "actividades_pkey" PRIMARY KEY (id);
ALTER TABLE "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY (id);
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_crop_assignment_id_key" UNIQUE (crop_assignment_id);
ALTER TABLE "lot_layouts" ADD CONSTRAINT "lot_layouts_lot_id_version_key" UNIQUE (lot_id, version);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_company_id_product_id_id_unit_key" UNIQUE (company_id, product_id, id, unit);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_product_id_id_unit_key" UNIQUE (company_id, product_id, id, unit);
ALTER TABLE "sub_lots" ADD CONSTRAINT "sub_lots_layout_id_code_key" UNIQUE (layout_id, code);
ALTER TABLE "users" ADD CONSTRAINT "users_auth0_sub_key" UNIQUE (auth0_sub);
ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE (email);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_check" CHECK (start_date <= end_date);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_name_not_empty" CHECK (btrim(name) <> ''::text);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_status_check" CHECK (status = ANY (ARRAY['active'::text, 'closed'::text]));
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_work_start_before_start_check" CHECK (work_start_date IS NULL OR work_start_date <= start_date);
ALTER TABLE "companies" ADD CONSTRAINT "companies_subscription_source_check" CHECK (subscription_source = ANY (ARRAY['unknown'::text, 'mercadopago'::text, 'manual'::text]));
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_area_ha_check" CHECK (area_ha > 0::numeric);
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_check" CHECK (end_date IS NULL OR start_date <= end_date);
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_harvest_closure_source_check" CHECK (end_date IS NULL AND harvest_closure_source IS NULL OR end_date IS NOT NULL AND harvest_closure_source IS NOT NULL AND (harvest_closure_source = ANY (ARRAY['automatic'::text, 'manual'::text, 'legacy'::text])));
ALTER TABLE "crops" ADD CONSTRAINT "crops_name_not_empty" CHECK (btrim(name) <> ''::text);
ALTER TABLE "harvest_crop_assignments" ADD CONSTRAINT "harvest_crop_assignments_area_positive" CHECK (harvested_area_ha > 0::numeric AND harvested_area_ha <> 'NaN'::numeric);
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_check" CHECK (total_area_ha = (harvested_area_ha + remaining_area_ha));
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_check1" CHECK (reason <> 'other'::text OR notes IS NOT NULL AND btrim(notes) <> ''::text);
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_harvested_area_ha_check" CHECK (harvested_area_ha >= 0::numeric AND harvested_area_ha <> 'NaN'::numeric);
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_notes_check" CHECK (notes IS NULL OR length(notes) <= 2000);
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_reason_check" CHECK (reason = ANY (ARRAY['measurement_difference'::text, 'unharvested_area'::text, 'loss'::text, 'weather'::text, 'other'::text]));
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_remaining_area_ha_check" CHECK (remaining_area_ha > 0::numeric AND remaining_area_ha <> 'NaN'::numeric);
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_total_area_ha_check" CHECK (total_area_ha > 0::numeric AND total_area_ha <> 'NaN'::numeric);
ALTER TABLE "harvest_records" ADD CONSTRAINT "chk_harvest_records_campaign_format" CHECK (campaign ~ '^[0-9]{4}-[0-9]{4}$'::text);
ALTER TABLE "harvest_records" ADD CONSTRAINT "chk_harvest_records_crop_not_empty" CHECK (btrim(crop) <> ''::text);
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_harvested_area_ha_check" CHECK (harvested_area_ha > 0::numeric);
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_production_kg_check" CHECK (production_kg >= 0::numeric);
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_registration_trace_check" CHECK (registered_retroactively IS NULL AND retroactive_reason IS NULL AND retroactive_notes IS NULL AND registration_timezone IS NULL OR registered_retroactively IS FALSE AND retroactive_reason IS NULL AND retroactive_notes IS NULL AND registration_timezone IS NOT NULL OR registered_retroactively IS TRUE AND registration_timezone IS NOT NULL AND retroactive_reason IS NOT NULL AND (retroactive_reason = ANY (ARRAY['pending_record'::text, 'historical_regularization'::text, 'information_correction'::text, 'other'::text])) AND (retroactive_reason <> 'other'::text OR COALESCE(length(btrim(retroactive_notes)), 0) > 0));
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_retroactive_notes_length" CHECK (length(retroactive_notes) <= 2000);
ALTER TABLE "lot_layouts" ADD CONSTRAINT "lot_layouts_parent_area_ha_snapshot_check" CHECK (parent_area_ha_snapshot > 0::numeric);
ALTER TABLE "lot_layouts" ADD CONSTRAINT "lot_layouts_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'active'::text, 'locked'::text, 'archived'::text]));
ALTER TABLE "lot_layouts" ADD CONSTRAINT "lot_layouts_tolerance_ha_check" CHECK (tolerance_ha >= 0::numeric);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_priority_check" CHECK (priority::text = ANY (ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying]::text[]));
ALTER TABLE "planning" ADD CONSTRAINT "end_after_start" CHECK (end_at >= start_at);
ALTER TABLE "planning" ADD CONSTRAINT "planning_activity_type_check" CHECK (activity_type = ANY (ARRAY['fumigacion'::text, 'siembra'::text, 'cosecha'::text, 'fertilizacion'::text, 'riego'::text, 'mantenimiento'::text, 'otro'::text]));
ALTER TABLE "planning" ADD CONSTRAINT "planning_end_after_start_chk" CHECK (end_at >= start_at);
ALTER TABLE "planning" ADD CONSTRAINT "planning_status_check" CHECK (status = ANY (ARRAY['planificado'::text, 'pendiente'::text, 'en_progreso'::text, 'completado'::text, 'en_demora'::text, 'cancelado'::text]));
ALTER TABLE "planning_lots" ADD CONSTRAINT "planning_lots_area_ha_positive" CHECK (area_ha IS NULL OR area_ha > 0::numeric);
ALTER TABLE "planning_product_completions" ADD CONSTRAINT "planning_product_completions_actual_amount_check" CHECK (actual_amount >= 0::numeric);
ALTER TABLE "products" ADD CONSTRAINT "products_minimum_stock_check" CHECK (minimum_stock >= 0::numeric AND minimum_stock <> 'NaN'::numeric);
ALTER TABLE "products" ADD CONSTRAINT "stock_categoria_check" CHECK (category = ANY (ARRAY['semillas'::text, 'agroquimicos'::text, 'fertilizantes'::text, 'combustible'::text]));
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_check" CHECK (available_quantity >= 0::numeric AND available_quantity <= initial_quantity AND available_quantity <> 'NaN'::numeric);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_check1" CHECK (currency IS NOT NULL OR unit_price IS NULL AND total_original IS NULL AND total_ars IS NULL);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_check2" CHECK (currency IS DISTINCT FROM 'USD'::text OR exchange_rate IS NOT NULL);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_currency_check" CHECK (currency = ANY (ARRAY['ARS'::text, 'USD'::text]));
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_exchange_rate_check" CHECK (exchange_rate > 0::numeric AND exchange_rate <> 'NaN'::numeric);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_initial_quantity_check" CHECK (initial_quantity > 0::numeric AND initial_quantity <> 'NaN'::numeric);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_origin_check" CHECK (origin = ANY (ARRAY['legacy'::text, 'purchase'::text, 'adjustment'::text, 'return'::text]));
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_received_date_required" CHECK ((origin <> ALL (ARRAY['purchase'::text, 'return'::text])) OR received_date IS NOT NULL);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_total_ars_check" CHECK (total_ars >= 0::numeric AND total_ars <> 'NaN'::numeric);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_total_original_check" CHECK (total_original >= 0::numeric AND total_original <> 'NaN'::numeric);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_unit_check" CHECK (unit = ANY (ARRAY['kg'::text, 'litros'::text]));
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_unit_price_check" CHECK (unit_price >= 0::numeric AND unit_price <> 'NaN'::numeric);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_check" CHECK ((movement_type = ANY (ARRAY['opening'::text, 'receipt'::text, 'adjustment_in'::text, 'reversal'::text])) AND quantity > 0::numeric OR (movement_type = ANY (ARRAY['consumption'::text, 'adjustment_out'::text])) AND quantity < 0::numeric);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_check1" CHECK ((movement_type = 'reversal'::text) = (reversed_movement_id IS NOT NULL));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_check2" CHECK (movement_type <> 'consumption'::text OR usage_id IS NOT NULL);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_idempotency_key_check" CHECK (length(btrim(idempotency_key)) >= 1 AND length(btrim(idempotency_key)) <= 200);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_movement_type_check" CHECK (movement_type = ANY (ARRAY['opening'::text, 'receipt'::text, 'consumption'::text, 'adjustment_in'::text, 'adjustment_out'::text, 'reversal'::text]));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_check" CHECK (quantity <> 0::numeric AND quantity <> 'NaN'::numeric);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_request_hash_check" CHECK (length(request_hash) = 64);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_check" CHECK (unit = ANY (ARRAY['kg'::text, 'litros'::text]));
ALTER TABLE "sub_lots" ADD CONSTRAINT "sub_lots_area_ha_check" CHECK (area_ha > 0::numeric);
CREATE UNIQUE INDEX campaigns_company_name_ci_unique ON public.campaigns USING btree (company_id, lower(btrim(name)));
CREATE UNIQUE INDEX crop_assignments_source_planning_sub_lot_unique ON public.crop_assignments USING btree (source_planning_id, sub_lot_id) WHERE ((source_planning_id IS NOT NULL) AND (sub_lot_id IS NOT NULL));
CREATE UNIQUE INDEX crop_assignments_source_planning_whole_lot_unique ON public.crop_assignments USING btree (source_planning_id, lot_id) WHERE ((source_planning_id IS NOT NULL) AND (sub_lot_id IS NULL));
CREATE UNIQUE INDEX crops_company_name_ci_unique ON public.crops USING btree (company_id, lower(btrim(name)));
CREATE UNIQUE INDEX planning_lots_unique_full_lot ON public.planning_lots USING btree (planning_id, lot_id) WHERE (sub_lot_id IS NULL);
CREATE UNIQUE INDEX planning_lots_unique_sub_lot ON public.planning_lots USING btree (planning_id, sub_lot_id) WHERE (sub_lot_id IS NOT NULL);
CREATE UNIQUE INDEX planning_products_id_unique ON public.planning_products USING btree (id);
CREATE UNIQUE INDEX inventory_product_unit_key ON public.products USING btree (company_id, id, unit);
CREATE UNIQUE INDEX stock_movements_once_per_batch ON public.stock_movements USING btree (company_id, idempotency_key, batch_id, movement_type);
CREATE UNIQUE INDEX stock_movements_reversal_once ON public.stock_movements USING btree (reversed_movement_id) WHERE (reversed_movement_id IS NOT NULL);
CREATE UNIQUE INDEX usage_lots_unique_full_lot ON public.usage_lots USING btree (usage_id, lot_id) WHERE (sub_lot_id IS NULL);
CREATE UNIQUE INDEX usage_lots_unique_sub_lot ON public.usage_lots USING btree (usage_id, sub_lot_id) WHERE (sub_lot_id IS NOT NULL);
CREATE UNIQUE INDEX inventory_usage_product_key ON public.usage_records USING btree (company_id, product_id, id);
CREATE UNIQUE INDEX usage_records_source_planning_product_unique ON public.usage_records USING btree (source_planning_product_id) WHERE (source_planning_product_id IS NOT NULL);
CREATE UNIQUE INDEX inventory_user_company_key ON public.users USING btree (company_id, id);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_crop_id_fkey" FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT;
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE RESTRICT;
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_source_planning_id_fkey" FOREIGN KEY (source_planning_id) REFERENCES planning(id) ON DELETE RESTRICT;
ALTER TABLE "crop_assignments" ADD CONSTRAINT "crop_assignments_sub_lot_id_fkey" FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT;
ALTER TABLE "crops" ADD CONSTRAINT "crops_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "harvest_crop_assignments" ADD CONSTRAINT "harvest_crop_assignments_crop_assignment_id_fkey" FOREIGN KEY (crop_assignment_id) REFERENCES crop_assignments(id) ON DELETE RESTRICT;
ALTER TABLE "harvest_crop_assignments" ADD CONSTRAINT "harvest_crop_assignments_harvest_id_fkey" FOREIGN KEY (harvest_id) REFERENCES harvest_records(id) ON DELETE RESTRICT;
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE "harvest_cycle_closures" ADD CONSTRAINT "harvest_cycle_closures_crop_assignment_id_fkey" FOREIGN KEY (crop_assignment_id) REFERENCES crop_assignments(id) ON DELETE RESTRICT;
ALTER TABLE "harvest_records" ADD CONSTRAINT "fk_harvest_records_company" FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE "harvest_records" ADD CONSTRAINT "fk_harvest_records_created_by" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE "harvest_records" ADD CONSTRAINT "fk_harvest_records_lot" FOREIGN KEY (lot_id) REFERENCES lots(id);
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_crop_id_fkey" FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT;
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_sub_lot_id_fkey" FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT;
ALTER TABLE "lot_layouts" ADD CONSTRAINT "lot_layouts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "lot_layouts" ADD CONSTRAINT "lot_layouts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "lot_layouts" ADD CONSTRAINT "lot_layouts_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE RESTRICT;
ALTER TABLE "lots" ADD CONSTRAINT "lots_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE "planning" ADD CONSTRAINT "planning_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "planning" ADD CONSTRAINT "planning_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "planning" ADD CONSTRAINT "planning_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE "planning" ADD CONSTRAINT "planning_crop_id_fkey" FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT;
ALTER TABLE "planning" ADD CONSTRAINT "planning_responsible_user_fkey" FOREIGN KEY (responsible_user) REFERENCES users(id);
ALTER TABLE "planning" ADD CONSTRAINT "planning_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id);
ALTER TABLE "planning_lots" ADD CONSTRAINT "planning_lots_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES lots(id);
ALTER TABLE "planning_lots" ADD CONSTRAINT "planning_lots_planning_id_fkey" FOREIGN KEY (planning_id) REFERENCES planning(id) ON DELETE CASCADE;
ALTER TABLE "planning_lots" ADD CONSTRAINT "planning_lots_sub_lot_id_fkey" FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT;
ALTER TABLE "planning_product_completions" ADD CONSTRAINT "planning_product_completions_planning_id_fkey" FOREIGN KEY (planning_id) REFERENCES planning(id) ON DELETE RESTRICT;
ALTER TABLE "planning_product_completions" ADD CONSTRAINT "planning_product_completions_planning_product_id_fkey" FOREIGN KEY (planning_product_id) REFERENCES planning_products(id) ON DELETE RESTRICT;
ALTER TABLE "planning_product_completions" ADD CONSTRAINT "planning_product_completions_usage_id_fkey" FOREIGN KEY (usage_id) REFERENCES usage_records(id) ON DELETE RESTRICT;
ALTER TABLE "planning_products" ADD CONSTRAINT "planning_products_planning_id_fkey" FOREIGN KEY (planning_id) REFERENCES planning(id) ON DELETE CASCADE;
ALTER TABLE "planning_products" ADD CONSTRAINT "planning_products_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_company_id_created_by_fkey" FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id) ON DELETE RESTRICT;
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_company_id_product_id_unit_fkey" FOREIGN KEY (company_id, product_id, unit) REFERENCES products(company_id, id, unit) ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_created_by_fkey" FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id) ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_product_id_batch_id_unit_fkey" FOREIGN KEY (company_id, product_id, batch_id, unit) REFERENCES stock_batches(company_id, product_id, id, unit) ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_product_id_reversed_movement_id_fkey" FOREIGN KEY (company_id, product_id, reversed_movement_id, unit) REFERENCES stock_movements(company_id, product_id, id, unit) ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_product_id_usage_id_fkey" FOREIGN KEY (company_id, product_id, usage_id) REFERENCES usage_records(company_id, product_id, id) ON DELETE RESTRICT;
ALTER TABLE "sub_lots" ADD CONSTRAINT "sub_lots_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "sub_lots" ADD CONSTRAINT "sub_lots_layout_id_fkey" FOREIGN KEY (layout_id) REFERENCES lot_layouts(id) ON DELETE RESTRICT;
ALTER TABLE "sub_lots" ADD CONSTRAINT "sub_lots_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE RESTRICT;
ALTER TABLE "usage_lots" ADD CONSTRAINT "usage_lots_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE;
ALTER TABLE "usage_lots" ADD CONSTRAINT "usage_lots_sub_lot_id_fkey" FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT;
ALTER TABLE "usage_lots" ADD CONSTRAINT "usage_lots_usage_id_fkey" FOREIGN KEY (usage_id) REFERENCES usage_records(id) ON DELETE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "activities_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_crop_id_fkey" FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_source_planning_id_fkey" FOREIGN KEY (source_planning_id) REFERENCES planning(id) ON DELETE RESTRICT;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_source_planning_product_id_fkey" FOREIGN KEY (source_planning_product_id) REFERENCES planning_products(id) ON DELETE RESTRICT;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_responsible_user_fkey" FOREIGN KEY (responsible_user) REFERENCES users(id);

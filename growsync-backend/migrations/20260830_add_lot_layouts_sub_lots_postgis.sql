CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS geom geometry(Polygon, 4326),
  ADD COLUMN IF NOT EXISTS area_ha NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_lots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lots_set_updated_at ON lots;
CREATE TRIGGER lots_set_updated_at
BEFORE UPDATE ON lots
FOR EACH ROW
EXECUTE FUNCTION set_lots_updated_at();

CREATE OR REPLACE FUNCTION gs_polygon_from_location(location_value JSONB)
RETURNS geometry AS $$
DECLARE
  ring JSONB;
  point JSONB;
  coords TEXT := '';
  first_lng DOUBLE PRECISION;
  first_lat DOUBLE PRECISION;
  last_lng DOUBLE PRECISION;
  last_lat DOUBLE PRECISION;
  lng DOUBLE PRECISION;
  lat DOUBLE PRECISION;
  count_points INTEGER := 0;
BEGIN
  IF location_value IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(location_value) = 'string' THEN
    RETURN gs_polygon_from_location((location_value #>> '{}')::JSONB);
  END IF;

  IF location_value ? 'type'
     AND lower(location_value->>'type') = 'polygon'
     AND location_value ? 'coordinates' THEN
    RETURN ST_SetSRID(ST_GeomFromGeoJSON(location_value::text), 4326);
  END IF;

  IF jsonb_typeof(location_value) <> 'array'
     OR jsonb_array_length(location_value) = 0
     OR jsonb_typeof(location_value->0) <> 'array' THEN
    RETURN NULL;
  END IF;

  ring := location_value->0;

  FOR point IN SELECT value FROM jsonb_array_elements(ring)
  LOOP
    IF point ? 'lng' AND point ? 'lat' THEN
      lng := (point->>'lng')::DOUBLE PRECISION;
      lat := (point->>'lat')::DOUBLE PRECISION;
    ELSIF jsonb_typeof(point) = 'array' AND jsonb_array_length(point) >= 2 THEN
      lat := (point->>0)::DOUBLE PRECISION;
      lng := (point->>1)::DOUBLE PRECISION;
    ELSE
      RETURN NULL;
    END IF;

    IF count_points = 0 THEN
      first_lng := lng;
      first_lat := lat;
    END IF;

    last_lng := lng;
    last_lat := lat;
    coords := coords || CASE WHEN coords = '' THEN '' ELSE ',' END || lng || ' ' || lat;
    count_points := count_points + 1;
  END LOOP;

  IF count_points < 3 THEN
    RETURN NULL;
  END IF;

  IF first_lng <> last_lng OR first_lat <> last_lat THEN
    coords := coords || ',' || first_lng || ' ' || first_lat;
    count_points := count_points + 1;
  END IF;

  IF count_points < 4 THEN
    RETURN NULL;
  END IF;

  RETURN ST_SetSRID(ST_GeomFromText('POLYGON((' || coords || '))'), 4326);
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION gs_polygon_from_location_text(location_text TEXT)
RETURNS geometry AS $$
BEGIN
  IF location_text IS NULL OR btrim(location_text) = '' THEN
    RETURN NULL;
  END IF;

  RETURN gs_polygon_from_location(location_text::JSONB);
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION gs_set_lot_geom_area()
RETURNS TRIGGER AS $$
DECLARE
  parsed_geom geometry;
BEGIN
  IF NEW.geom IS NULL AND NEW.location IS NOT NULL THEN
    parsed_geom := gs_polygon_from_location_text(NEW.location::TEXT);
    IF parsed_geom IS NOT NULL AND ST_IsValid(parsed_geom) THEN
      NEW.geom := parsed_geom;
    END IF;
  END IF;

  IF NEW.geom IS NOT NULL THEN
    IF NOT ST_IsValid(NEW.geom) THEN
      RAISE EXCEPTION 'La geometria del lote no es valida';
    END IF;

    NEW.geom := ST_SetSRID(ST_Force2D(NEW.geom), 4326);
    NEW.area_ha := ROUND((ST_Area(NEW.geom::geography) / 10000)::NUMERIC, 4);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lots_set_geom_area ON lots;
CREATE TRIGGER lots_set_geom_area
BEFORE INSERT OR UPDATE OF location, geom ON lots
FOR EACH ROW
EXECUTE FUNCTION gs_set_lot_geom_area();

UPDATE lots
SET geom = gs_polygon_from_location_text(location::TEXT)
WHERE geom IS NULL
  AND location IS NOT NULL
  AND gs_polygon_from_location_text(location::TEXT) IS NOT NULL;

UPDATE lots
SET area_ha = ROUND((ST_Area(geom::geography) / 10000)::NUMERIC, 4)
WHERE geom IS NOT NULL
  AND (area_ha IS NULL OR area_ha <= 0);

CREATE TABLE IF NOT EXISTS lot_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'locked', 'archived')),
  parent_geom_snapshot geometry(Polygon, 4326) NOT NULL,
  parent_area_ha_snapshot NUMERIC(12, 4) NOT NULL CHECK (parent_area_ha_snapshot > 0),
  tolerance_ha NUMERIC(12, 4) NOT NULL DEFAULT 0.0100 CHECK (tolerance_ha >= 0),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  UNIQUE(lot_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lot_layouts_company_lot
  ON lot_layouts(company_id, lot_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_lot_layouts_status
  ON lot_layouts(company_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS lot_layouts_one_active_per_lot_idx
  ON lot_layouts(lot_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_lot_layouts_parent_geom
  ON lot_layouts USING GIST(parent_geom_snapshot);

CREATE TABLE IF NOT EXISTS sub_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id UUID NOT NULL REFERENCES lot_layouts(id) ON DELETE RESTRICT,
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  geom geometry(Polygon, 4326) NOT NULL,
  area_ha NUMERIC(12, 4) NOT NULL CHECK (area_ha > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(layout_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sub_lots_company_lot
  ON sub_lots(company_id, lot_id);

CREATE INDEX IF NOT EXISTS idx_sub_lots_layout
  ON sub_lots(layout_id, sort_order, code);

CREATE INDEX IF NOT EXISTS idx_sub_lots_geom
  ON sub_lots USING GIST(geom);

CREATE OR REPLACE FUNCTION set_lot_layouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lot_layouts_set_updated_at ON lot_layouts;
CREATE TRIGGER lot_layouts_set_updated_at
BEFORE UPDATE ON lot_layouts
FOR EACH ROW
EXECUTE FUNCTION set_lot_layouts_updated_at();

CREATE OR REPLACE FUNCTION set_sub_lots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sub_lots_set_updated_at ON sub_lots;
CREATE TRIGGER sub_lots_set_updated_at
BEFORE UPDATE ON sub_lots
FOR EACH ROW
EXECUTE FUNCTION set_sub_lots_updated_at();

CREATE OR REPLACE FUNCTION gs_set_sub_lot_area()
RETURNS TRIGGER AS $$
DECLARE
  layout_record lot_layouts%ROWTYPE;
BEGIN
  SELECT *
  INTO layout_record
  FROM lot_layouts
  WHERE id = NEW.layout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layout no encontrado';
  END IF;

  IF NEW.lot_id <> layout_record.lot_id OR NEW.company_id <> layout_record.company_id THEN
    RAISE EXCEPTION 'El sublote no pertenece al mismo lote/layout/empresa';
  END IF;

  IF NOT ST_IsValid(NEW.geom) THEN
    RAISE EXCEPTION 'La geometria del sublote no es valida';
  END IF;

  NEW.geom := ST_SetSRID(ST_Force2D(NEW.geom), 4326);
  NEW.area_ha := ROUND((ST_Area(NEW.geom::geography) / 10000)::NUMERIC, 4);

  IF NEW.area_ha <= 0 THEN
    RAISE EXCEPTION 'La superficie del sublote debe ser mayor a 0';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sub_lots_set_area ON sub_lots;
CREATE TRIGGER sub_lots_set_area
BEFORE INSERT OR UPDATE OF geom, layout_id, lot_id, company_id ON sub_lots
FOR EACH ROW
EXECUTE FUNCTION gs_set_sub_lot_area();

INSERT INTO lot_layouts (
  lot_id,
  company_id,
  version,
  name,
  status,
  parent_geom_snapshot,
  parent_area_ha_snapshot,
  tolerance_ha
)
SELECT
  l.id,
  l.company_id,
  1,
  'Layout inicial',
  'active',
  l.geom,
  COALESCE(l.area_ha, ROUND((ST_Area(l.geom::geography) / 10000)::NUMERIC, 4)),
  0.0100
FROM lots l
WHERE l.company_id IS NOT NULL
  AND l.geom IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM lot_layouts ll
    WHERE ll.lot_id = l.id
  );

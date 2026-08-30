-- Verificacion posterior a 20260830_add_lot_layouts_sub_lots_postgis.sql
-- Ejecutar despues de aplicar la migracion, idealmente en Supabase SQL editor.

-- 1) Lotes cuyo location no pudo convertirse o que siguen sin geometria.
SELECT
  id,
  company_id,
  name,
  area,
  area_ha,
  location
FROM lots
WHERE geom IS NULL
ORDER BY company_id, name;

-- 2) Lotes sin area_ha calculada.
SELECT
  id,
  company_id,
  name,
  area,
  area_ha,
  location
FROM lots
WHERE area_ha IS NULL
ORDER BY company_id, name;

-- 3) Lotes sin ningun lot_layout.
SELECT
  l.id,
  l.company_id,
  l.name,
  l.area,
  l.area_ha,
  l.geom IS NOT NULL AS has_geom
FROM lots l
WHERE NOT EXISTS (
  SELECT 1
  FROM lot_layouts ll
  WHERE ll.lot_id = l.id
)
ORDER BY l.company_id, l.name;

-- 4) Lotes con mas de un layout active.
-- Esta consulta deberia devolver 0 filas; el indice parcial tambien lo impide.
SELECT
  lot_id,
  company_id,
  COUNT(*) AS active_layouts
FROM lot_layouts
WHERE status = 'active'
GROUP BY lot_id, company_id
HAVING COUNT(*) > 1
ORDER BY active_layouts DESC;

-- 5) Diferencias significativas entre lots.area historico y lots.area_ha calculado.
-- Ajustar el umbral si se adopta una tolerancia distinta.
SELECT
  id,
  company_id,
  name,
  area AS historical_area_ha,
  area_ha AS calculated_area_ha,
  ABS(area::numeric - area_ha::numeric) AS delta_ha
FROM lots
WHERE area IS NOT NULL
  AND area_ha IS NOT NULL
  AND ABS(area::numeric - area_ha::numeric) > 0.01
ORDER BY delta_ha DESC;

-- 6) Confirmar forma esperada de layouts iniciales creados por backfill.
SELECT
  ll.id,
  ll.lot_id,
  ll.company_id,
  ll.version,
  ll.status,
  ll.parent_area_ha_snapshot,
  COUNT(sl.id) AS sub_lots_count
FROM lot_layouts ll
LEFT JOIN sub_lots sl ON sl.layout_id = ll.id
WHERE ll.version = 1
GROUP BY
  ll.id,
  ll.lot_id,
  ll.company_id,
  ll.version,
  ll.status,
  ll.parent_area_ha_snapshot
ORDER BY ll.company_id, ll.lot_id;

# Auditoría del Inventario de GrowSync — Don Santiago SRL

Auditoría de solo lectura del 13/09/2026. Empresa **2791ea15-7dad-48e2-945b-3791e2d44478**, identificada por coincidencia exacta de los Finesse del pedido. Las otras empresas no se incluyen en la tabla de decisión.

**Recomendación:** el modelo producto + partidas + movimientos es viable, pero antes hay que validar las cantidades de Finesse, los saldos deshabilitados y las líneas de la factura que podrían estar cargadas. No sumar automáticamente registros con el mismo nombre.

## Alcance y evidencia

Se consultó el esquema y los datos REALES de Supabase en transacciones READ ONLY, verificando transaction_read_only=on. Datos principales capturados el 13/09/2026 a las 23:33 UTC; dependencias indirectas se contaron en una lectura complementaria posterior. No se ejecutaron escrituras de negocio, endpoints mutadores, scripts de limpieza ni pruebas contra la base. No se modificó código ni se crearon archivos SQL o migraciones. Se generaron este informe y dos evidencias JSON.

Fuentes: [datos reales](./inventory-data-2026-09-13.json), [esquema real](./inventory-schema-2026-09-13.json). Las fechas DATE se extrajeron mediante JSON nativo PostgreSQL para evitar conversiones horarias. created_at de products y usage_records es timestamp SIN zona: se informa literalmente, sin adjudicarle UTC. **products no tiene updated_at**.

Se auditó el checkout local actual, con cambios preexistentes; no se verificó igualdad con el despliegue de producción. Los riesgos de código no prueban que cada fallo haya ocurrido. No se consultaron logs externos ni documentos de compras/etiquetas no aportados. No tener referencias en las tablas auditadas no prueba que el saldo sea físico ni que carezca de historia externa.

## Implementación actual

### Productos, permisos y Agregar stock

Fuentes: [CRUD](../growsync-backend/controllers/products/products.js), [deshabilitados](../growsync-backend/controllers/products/products.disabled.js), [rutas](../growsync-backend/routes/products.js), [permisos](../growsync-backend/constants/permissions.js), [middleware](../growsync-backend/middleware/requirePermission.js).

| Operación | Endpoint | Rol mínimo / permiso |
| --- | --- | --- |
| Listar | GET /api/products | 0 / inventory.view |
| Crear | POST /api/products | 2 / inventory.create |
| Agregar stock | PATCH /api/products/:id/add-stock | 2 / inventory.edit |
| Editar | PUT /api/products/:id | 2 / INVENTORY_UPDATE, constante inexistente |
| Deshabilitar | DELETE /api/products/:id | 2 / inventory.disable |
| Listar deshabilitados | GET /api/products/disabled | 0 / inventory.view_disabled |
| Reactivar | PUT /api/products/enable/:id | 2 / inventory.enable |

Roles: 0 empleado, 1 supervisor, 2 dueño, 3 admin. Las rutas se montan bajo middlewares privados en index.js. requirePermission acepta el permiso solicitado o all. El PUT usa INVENTORY_UPDATE, pero constants define INVENTORY_EDIT: un usuario sin all puede quedar bloqueado aunque tenga inventory.edit.

**Agregar stock** recibe solo quantity positiva/finita e incrementa atómicamente total_quantity y available_quantity, usando COALESCE(...,0) y filtros id, company_id, enabled=true. No cambia vencimiento, acquisition_date, price, cost ni created_at. No registra fecha de ingreso, actor, proveedor, comprobante, precio ni historial. No hay updated_at ni trigger de auditoría del producto. No puede reconstruirse quién agregó cuánto/cuándo o qué parte tiene cada vencimiento. Repetir el request puede duplicar el ingreso: no existe clave de idempotencia.

Crear/editar permite escribir unidad, cantidades, fechas y precio/costo directamente en products. La comparación disponible<=total solo ocurre si llegan ambos valores. La DB no tiene checks de saldo no negativo ni disponible<=total, ni unicidad de nombre/empresa. Editar saldos o enabled no genera movimiento.

Deshabilitar pone enabled=false, conserva cantidades y referencias, sin comprobar usos o Planning pendientes. Los selectores normales lo omiten; nuevos consumos lo rechazan. El helper manual también impide devolver stock a un producto deshabilitado. Reactivar conserva sus cantidades. Usage obtiene nombre/unidad actuales mediante JOIN: renombrar el producto cambia la presentación del historial.

**Aislamiento por empresa:** listar deshabilitados y reactivar no filtran company_id. products tiene RLS desactivado, sin políticas; el cliente puede utilizar service role. Existe riesgo de acceso/reactivación de otra empresa por esas rutas, sin que esta auditoría lo haya explotado. El listado general filtra empresa, pero includeDisabled usa z.coerce.boolean: el texto 'false' es truthy; esa vía tampoco exige inventory.view_disabled.

### Descuento, edición y reversión

Fuentes: [Usage](../growsync-backend/controllers/usage/usage.js), [Planning completion](../growsync-backend/services/planningCompletion.js), [Planning](../growsync-backend/controllers/planning.js).

- **Manual:** inserta usage_records y usage_lots y descuenta amount_used de available_quantity. No toca total_quantity. Usa lectura-modificación-escritura por llamadas separadas; concurrencia puede perder ajustes. La creación intenta borrar el uso si falla el descuento, sin transacción integral.
- **Editar manual:** actualiza primero registro/lotes y después stock por diferencia. Cambiar producto reintegra al anterior y descuenta del nuevo. Si falla el segundo paso, pueden quedar datos parcialmente modificados. Tampoco verifica enabled del uso al editar: un registro deshabilitado puede ajustar indebidamente el saldo. No conserva versiones.
- **Deshabilitar/reactivar manual:** reintegra/descuenta y después cambia enabled. Son operaciones separadas, expuestas a fallos intermedios o doble ajuste concurrente. No hay movimiento de reversión ni autor de cada modificación.
- **Planning:** finalización usa transacción y FOR UPDATE sobre products, valida empresa, enabled, unidad literal y cantidad agregada por producto. Inserta uso, vínculos de lotes, planning_product_completions y descuenta available_quantity. Conserva cantidad real, que puede diferir de la planificada. Claves únicas del origen protegen contra duplicación. Un actual_amount=0 puede dejar completion sin usage_id.
- **Automáticos:** no se pueden editar, deshabilitar ni reactivar por Usage. Planning con completions bloquea cambios de estructura, reapertura y cancelación. El mensaje pide corregir usos, pero el flujo manual también los bloquea: falta reversión integral.
- No se encontró otra fuente operativa de descuento en controladores/servicios. Crear/editar producto altera stock sin registrar consumo. Los scripts de mantenimiento existentes no se ejecutaron.

Ningún consumo identifica compra o partida. Preservar IDs, cantidades/unidades originales, enabled, fechas, responsible/user_id, created_by incluso NULL, source_planning_id, source_planning_product_id, completions, crop_id, área, lotes/sub-lotes y campaña. No asignar compras históricas inventadas.

### Unidades, fechas, dashboard y notificaciones

Fuentes: [Inventario UI](../grow-sync/src/features/inventory/Inventory.jsx), [Usage UI](../grow-sync/src/features/usages/Usage.jsx), [Planning UI](../grow-sync/src/features/planning/Planning.jsx), [Stats](../growsync-backend/controllers/stats.js), [cron](../growsync-backend/cron/scheduler.js).

Inventario ofrece kg/litros; formatUnit solo cambia etiquetas. No convierte kg/g ni litros/ml/cc. Planning compara unidades literalmente, sin conversión. Usage backend descuenta el número recibido sin verificar equivalencia con la unidad del producto; la UI toma la unidad del catálogo, pero no protege llamadas API distintas. Los 24 usos reales sí coinciden textualmente con su producto.

El formulario toma values.acquisition_date y envía el mismo valor a acquisition_date y expiration_date. Hay 54 productos con acquisition_date futura y 43 activos sin expiration_date. No usar acquisition_date como evidencia de compra ni como fecha de ingreso legacy. formatDateDDMMYYYY usa new Date('YYYY-MM-DD') y getters locales: en Argentina muestra el día anterior. Explica 2027-06-01 en DB frente a 31/05/2027 visual, y 2026-11-01 frente a 31/10/2026. No corregir DB restando un día.

Stats cuenta productos habilitados por empresa. Inventario considera bajo stock disponible>0 y <=10% del total; backend manual usa umbral 5; cron usa <10. Son criterios distintos, sin mínimo configurable. Cron consulta productos y administradores sin filtro de empresa y crea notificaciones sin company_id. De 40 notificaciones referenciadas, 38 tienen empresa NULL. No prueba por sí solo destinatarios cruzados, pero exige revisar aislamiento. Con partidas, contar identidades canónicas, calcular saldo/vencimientos por partidas y no sumar kg con litros.

## Esquema real y dependencias

Las definiciones del anexo son evidencia del catálogo actual, no SQL propuesto. Se inspeccionaron columnas, constraints, índices, triggers y políticas de public, y las FK directas a products también fuera de public: solo existen dos.

| Relación | Efecto de DELETE físico |
| --- | --- |
| planning_products.product_id → products.id | NO ACTION: bloquea si existen líneas |
| usage_records.product_id → products.id | SET NULL: pierde vínculo de producto |
| usage_records.source_planning_product_id → planning_products.id | RESTRICT |
| usage_records.source_planning_id → planning.id | RESTRICT |
| planning_product_completions → planning_products/planning/usage_records | RESTRICT |
| usage_lots.usage_id → usage_records.id | CASCADE |
| planning_products/planning_lots → planning.id | CASCADE, sujeto a otras restricciones |
| crop_assignments.source_planning_id → planning.id | RESTRICT |
| harvest_crop_assignments/harvest_cycle_closures → crop_assignments | RESTRICT |
| notifications.data.product_id | JSON sin FK: no se actualiza por cascada |

enabled=false no dispara ninguna de estas acciones: no hay triggers de stock en products/usage_records. No se hallaron funciones públicas cuyo cuerpo mencione products o usage_records. No existen stock_batches ni stock_movements.

Las únicas columnas product_id están en usage_records y planning_products. Las referencias indirectas son completions y usage_lots; Planning conecta además con planning_lots, crop_assignments y, vía estas últimas, cosechas/cierres. Son relaciones contextuales, no partidas. Los conteos por producto de asignaciones/cosechas/cierres a través de source_planning_id dieron cero. planning_with_derived es una vista sobre Planning; definición en JSON.

products solo tiene índices stock_pkey(id) y products_enabled_idx(enabled). No tiene índice por company_id. usage_records no tiene índice directo product_id; sí por source_planning_id, source_planning_product_id único y crop_id. planning_products tiene PK(planning_id,product_id) y UNIQUE(id), importante para la futura fusión. El anexo detalla todos los índices, tipos y constraints relevantes, incluidas tablas productivas indirectas.


### products

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | NULL |
| category | text | YES | NULL |
| unit | text | NO | NULL |
| expiration_date | date | YES | NULL |
| cost | numeric | YES | NULL |
| created_at | timestamp | YES | now() |
| enabled | bool | YES | true |
| total_quantity | numeric | YES | NULL |
| available_quantity | numeric | YES | NULL |
| price | numeric | YES | NULL |
| acquisition_date | date | YES | NULL |
| company_id | uuid | YES | NULL |

Constraints y FK:

- stock_categoria_check: `CHECK ((category = ANY (ARRAY['semillas'::text, 'agroquimicos'::text, 'fertilizantes'::text, 'combustible'::text])))`
- stock_pkey: `PRIMARY KEY (id)`
- products_company_id_fkey: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`

Índices actuales:

- stock_pkey: `CREATE UNIQUE INDEX stock_pkey ON public.products USING btree (id)`
- products_enabled_idx: `CREATE INDEX products_enabled_idx ON public.products USING btree (enabled)`

### usage_records

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| date | date | NO | NULL |
| created_by | uuid | YES | NULL |
| created_at | timestamp | YES | now() |
| enabled | bool | YES | true |
| product_id | uuid | YES | NULL |
| amount_used | numeric | YES | NULL |
| unit | text | YES | NULL |
| total_area | numeric | YES | NULL |
| previous_crop | text | YES | NULL |
| current_crop | text | YES | NULL |
| user_id | uuid | YES | NULL |
| company_id | uuid | YES | NULL |
| source_planning_id | uuid | YES | NULL |
| source_planning_product_id | uuid | YES | NULL |
| crop_id | uuid | YES | NULL |

Constraints y FK:

- actividades_pkey: `PRIMARY KEY (id)`
- activities_created_by_fkey: `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL`
- usage_records_product_id_fkey: `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL`
- usage_records_user_id_fkey: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`
- usage_records_company_id_fkey: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- usage_records_source_planning_product_id_fkey: `FOREIGN KEY (source_planning_product_id) REFERENCES planning_products(id) ON DELETE RESTRICT`
- usage_records_source_planning_id_fkey: `FOREIGN KEY (source_planning_id) REFERENCES planning(id) ON DELETE RESTRICT`
- usage_records_crop_id_fkey: `FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT`

Índices actuales:

- actividades_pkey: `CREATE UNIQUE INDEX actividades_pkey ON public.usage_records USING btree (id)`
- usage_records_source_planning_product_unique: `CREATE UNIQUE INDEX usage_records_source_planning_product_unique ON public.usage_records USING btree (source_planning_product_id) WHERE (source_planning_product_id IS NOT NULL)`
- idx_usage_records_source_planning: `CREATE INDEX idx_usage_records_source_planning ON public.usage_records USING btree (source_planning_id) WHERE (source_planning_id IS NOT NULL)`
- idx_usage_records_crop_id: `CREATE INDEX idx_usage_records_crop_id ON public.usage_records USING btree (crop_id) WHERE (crop_id IS NOT NULL)`

### planning_products

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| planning_id | uuid | NO | NULL |
| product_id | uuid | NO | NULL |
| amount | numeric | YES | NULL |
| unit | text | YES | NULL |
| id | uuid | NO | gen_random_uuid() |

Constraints y FK:

- planning_products_planning_id_fkey: `FOREIGN KEY (planning_id) REFERENCES planning(id) ON DELETE CASCADE`
- planning_products_product_id_fkey: `FOREIGN KEY (product_id) REFERENCES products(id)`
- planning_products_pkey: `PRIMARY KEY (planning_id, product_id)`

Índices actuales:

- planning_products_pkey: `CREATE UNIQUE INDEX planning_products_pkey ON public.planning_products USING btree (planning_id, product_id)`
- planning_products_id_unique: `CREATE UNIQUE INDEX planning_products_id_unique ON public.planning_products USING btree (id)`

### planning_product_completions

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| planning_product_id | uuid | NO | NULL |
| planning_id | uuid | NO | NULL |
| usage_id | uuid | YES | NULL |
| actual_amount | numeric | NO | NULL |
| created_at | timestamptz | NO | now() |

Constraints y FK:

- planning_product_completions_actual_amount_check: `CHECK ((actual_amount >= (0)::numeric))`
- planning_product_completions_pkey: `PRIMARY KEY (planning_product_id)`
- planning_product_completions_planning_product_id_fkey: `FOREIGN KEY (planning_product_id) REFERENCES planning_products(id) ON DELETE RESTRICT`
- planning_product_completions_planning_id_fkey: `FOREIGN KEY (planning_id) REFERENCES planning(id) ON DELETE RESTRICT`
- planning_product_completions_usage_id_fkey: `FOREIGN KEY (usage_id) REFERENCES usage_records(id) ON DELETE RESTRICT`

Índices actuales:

- planning_product_completions_pkey: `CREATE UNIQUE INDEX planning_product_completions_pkey ON public.planning_product_completions USING btree (planning_product_id)`
- idx_planning_product_completions_planning: `CREATE INDEX idx_planning_product_completions_planning ON public.planning_product_completions USING btree (planning_id)`

### planning

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| title | text | YES | NULL |
| description | text | YES | NULL |
| activity_type | text | NO | NULL |
| start_at | timestamptz | NO | NULL |
| end_at | timestamptz | NO | NULL |
| responsible_user | uuid | NO | NULL |
| status | text | NO | NULL |
| vehicle_id | uuid | YES | NULL |
| created_by | uuid | YES | NULL |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| enabled | bool | NO | true |
| date_range | tstzrange | YES | NULL |
| company_id | uuid | YES | NULL |
| crop_id | uuid | YES | NULL |
| campaign_id | uuid | YES | NULL |
| effective_date | date | YES | NULL |
| completed_at | timestamptz | YES | NULL |
| registered_retroactively | bool | NO | false |

Constraints y FK:

- end_after_start: `CHECK ((end_at >= start_at))`
- planning_activity_type_check: `CHECK ((activity_type = ANY (ARRAY['fumigacion'::text, 'siembra'::text, 'cosecha'::text, 'fertilizacion'::text, 'riego'::text, 'mantenimiento'::text, 'otro'::text])))`
- planning_end_after_start_chk: `CHECK ((end_at >= start_at))`
- planning_status_check: `CHECK ((status = ANY (ARRAY['planificado'::text, 'pendiente'::text, 'en_progreso'::text, 'completado'::text, 'en_demora'::text, 'cancelado'::text])))`
- planning_responsible_user_fkey: `FOREIGN KEY (responsible_user) REFERENCES users(id)`
- planning_vehicle_id_fkey: `FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)`
- planning_pkey: `PRIMARY KEY (id)`
- planning_created_by_fkey: `FOREIGN KEY (created_by) REFERENCES users(id)`
- planning_company_id_fkey: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- planning_crop_id_fkey: `FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT`
- planning_campaign_id_fkey: `FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT`

Índices actuales:

- planning_pkey: `CREATE UNIQUE INDEX planning_pkey ON public.planning USING btree (id)`
- planning_activity_type_idx: `CREATE INDEX planning_activity_type_idx ON public.planning USING btree (activity_type)`
- planning_date_range_active_gist: `CREATE INDEX planning_date_range_active_gist ON public.planning USING gist (date_range) WHERE ((enabled = true) AND (status <> 'cancelado'::text))`
- planning_date_range_gist: `CREATE INDEX planning_date_range_gist ON public.planning USING gist (date_range)`
- planning_enabled_idx: `CREATE INDEX planning_enabled_idx ON public.planning USING btree (enabled)`
- planning_responsible_idx: `CREATE INDEX planning_responsible_idx ON public.planning USING btree (responsible_user)`
- planning_responsible_user_idx: `CREATE INDEX planning_responsible_user_idx ON public.planning USING btree (responsible_user)`
- planning_status_idx: `CREATE INDEX planning_status_idx ON public.planning USING btree (status)`
- planning_type_idx: `CREATE INDEX planning_type_idx ON public.planning USING btree (activity_type)`
- planning_vehicle_id_idx: `CREATE INDEX planning_vehicle_id_idx ON public.planning USING btree (vehicle_id)`
- idx_planning_crop_id: `CREATE INDEX idx_planning_crop_id ON public.planning USING btree (crop_id) WHERE (crop_id IS NOT NULL)`
- idx_planning_campaign_id: `CREATE INDEX idx_planning_campaign_id ON public.planning USING btree (campaign_id) WHERE (campaign_id IS NOT NULL)`
- idx_planning_effective_date: `CREATE INDEX idx_planning_effective_date ON public.planning USING btree (effective_date)`
- idx_planning_registered_retroactively: `CREATE INDEX idx_planning_registered_retroactively ON public.planning USING btree (registered_retroactively)`

### usage_lots

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| usage_id | uuid | NO | NULL |
| lot_id | uuid | NO | NULL |
| sub_lot_id | uuid | YES | NULL |

Constraints y FK:

- usage_lots_lot_id_fkey: `FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE`
- usage_lots_usage_id_fkey: `FOREIGN KEY (usage_id) REFERENCES usage_records(id) ON DELETE CASCADE`
- usage_lots_sub_lot_id_fkey: `FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT`

Índices actuales:

- idx_usage_lots_lot_id: `CREATE INDEX idx_usage_lots_lot_id ON public.usage_lots USING btree (lot_id)`
- idx_usage_lots_usage_id: `CREATE INDEX idx_usage_lots_usage_id ON public.usage_lots USING btree (usage_id)`
- usage_lots_unique_full_lot: `CREATE UNIQUE INDEX usage_lots_unique_full_lot ON public.usage_lots USING btree (usage_id, lot_id) WHERE (sub_lot_id IS NULL)`
- usage_lots_unique_sub_lot: `CREATE UNIQUE INDEX usage_lots_unique_sub_lot ON public.usage_lots USING btree (usage_id, sub_lot_id) WHERE (sub_lot_id IS NOT NULL)`
- idx_usage_lots_sub_lot_id: `CREATE INDEX idx_usage_lots_sub_lot_id ON public.usage_lots USING btree (sub_lot_id) WHERE (sub_lot_id IS NOT NULL)`

### planning_lots

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| planning_id | uuid | NO | NULL |
| lot_id | uuid | NO | NULL |
| sub_lot_id | uuid | YES | NULL |
| area_ha | numeric | YES | NULL |

Constraints y FK:

- planning_lots_lot_id_fkey: `FOREIGN KEY (lot_id) REFERENCES lots(id)`
- planning_lots_planning_id_fkey: `FOREIGN KEY (planning_id) REFERENCES planning(id) ON DELETE CASCADE`
- planning_lots_sub_lot_id_fkey: `FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT`
- planning_lots_area_ha_positive: `CHECK (((area_ha IS NULL) OR (area_ha > (0)::numeric)))`

Índices actuales:

- planning_lots_unique_sub_lot: `CREATE UNIQUE INDEX planning_lots_unique_sub_lot ON public.planning_lots USING btree (planning_id, sub_lot_id) WHERE (sub_lot_id IS NOT NULL)`
- idx_planning_lots_lot_sub_lot: `CREATE INDEX idx_planning_lots_lot_sub_lot ON public.planning_lots USING btree (lot_id, sub_lot_id)`
- idx_planning_lots_sub_lot_id: `CREATE INDEX idx_planning_lots_sub_lot_id ON public.planning_lots USING btree (sub_lot_id) WHERE (sub_lot_id IS NOT NULL)`
- idx_planning_lots_planning_id: `CREATE INDEX idx_planning_lots_planning_id ON public.planning_lots USING btree (planning_id)`
- planning_lots_unique_full_lot: `CREATE UNIQUE INDEX planning_lots_unique_full_lot ON public.planning_lots USING btree (planning_id, lot_id) WHERE (sub_lot_id IS NULL)`

### notifications

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| id | uuid | NO | uuid_generate_v4() |
| user_id | uuid | NO | NULL |
| type | varchar | NO | NULL |
| priority | varchar | NO | NULL |
| title | text | NO | NULL |
| message | text | NO | NULL |
| data | jsonb | YES | '{}'::jsonb |
| read | bool | YES | false |
| created_at | timestamptz | YES | now() |
| company_id | uuid | YES | NULL |

Constraints y FK:

- notifications_priority_check: `CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying])::text[])))`
- notifications_pkey: `PRIMARY KEY (id)`
- notifications_user_id_fkey: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`
- notifications_company_id_fkey: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`

Índices actuales:

- notifications_pkey: `CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)`
- idx_notifications_user_id: `CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id)`
- idx_notifications_read: `CREATE INDEX idx_notifications_read ON public.notifications USING btree (read)`
- idx_notifications_created_at: `CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC)`
- idx_notifications_user_unread: `CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, read) WHERE (read = false)`

### crop_assignments

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| company_id | uuid | NO | NULL |
| campaign_id | uuid | NO | NULL |
| lot_id | uuid | NO | NULL |
| sub_lot_id | uuid | YES | NULL |
| crop_id | uuid | NO | NULL |
| start_date | date | NO | NULL |
| end_date | date | YES | NULL |
| area_ha | numeric | NO | NULL |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| source_planning_id | uuid | YES | NULL |
| harvest_closure_source | text | YES | NULL |

Constraints y FK:

- crop_assignments_check: `CHECK (((end_date IS NULL) OR (start_date <= end_date)))`
- crop_assignments_pkey: `PRIMARY KEY (id)`
- crop_assignments_company_id_fkey: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- crop_assignments_campaign_id_fkey: `FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT`
- crop_assignments_lot_id_fkey: `FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE RESTRICT`
- crop_assignments_sub_lot_id_fkey: `FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT`
- crop_assignments_crop_id_fkey: `FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT`
- crop_assignments_source_planning_id_fkey: `FOREIGN KEY (source_planning_id) REFERENCES planning(id) ON DELETE RESTRICT`
- crop_assignments_harvest_closure_source_check: `CHECK ((((end_date IS NULL) AND (harvest_closure_source IS NULL)) OR ((end_date IS NOT NULL) AND (harvest_closure_source IS NOT NULL) AND (harvest_closure_source = ANY (ARRAY['automatic'::text, 'manual'::text, 'legacy'::text])))))`
- crop_assignments_area_ha_check: `CHECK ((area_ha > (0)::numeric))`

Índices actuales:

- crop_assignments_pkey: `CREATE UNIQUE INDEX crop_assignments_pkey ON public.crop_assignments USING btree (id)`
- idx_crop_assignments_company_campaign: `CREATE INDEX idx_crop_assignments_company_campaign ON public.crop_assignments USING btree (company_id, campaign_id)`
- idx_crop_assignments_lot_sub_lot: `CREATE INDEX idx_crop_assignments_lot_sub_lot ON public.crop_assignments USING btree (lot_id, sub_lot_id)`
- idx_crop_assignments_crop: `CREATE INDEX idx_crop_assignments_crop ON public.crop_assignments USING btree (crop_id)`
- idx_crop_assignments_real_dates: `CREATE INDEX idx_crop_assignments_real_dates ON public.crop_assignments USING btree (company_id, lot_id, start_date, end_date)`
- crop_assignments_source_planning_whole_lot_unique: `CREATE UNIQUE INDEX crop_assignments_source_planning_whole_lot_unique ON public.crop_assignments USING btree (source_planning_id, lot_id) WHERE ((source_planning_id IS NOT NULL) AND (sub_lot_id IS NULL))`
- crop_assignments_source_planning_sub_lot_unique: `CREATE UNIQUE INDEX crop_assignments_source_planning_sub_lot_unique ON public.crop_assignments USING btree (source_planning_id, sub_lot_id) WHERE ((source_planning_id IS NOT NULL) AND (sub_lot_id IS NOT NULL))`
- idx_crop_assignments_source_planning: `CREATE INDEX idx_crop_assignments_source_planning ON public.crop_assignments USING btree (source_planning_id) WHERE (source_planning_id IS NOT NULL)`

### harvest_crop_assignments

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| harvest_id | uuid | NO | NULL |
| crop_assignment_id | uuid | NO | NULL |
| created_at | timestamptz | NO | now() |
| harvested_area_ha | numeric | NO | NULL |

Constraints y FK:

- harvest_crop_assignments_pkey: `PRIMARY KEY (harvest_id, crop_assignment_id)`
- harvest_crop_assignments_harvest_id_fkey: `FOREIGN KEY (harvest_id) REFERENCES harvest_records(id) ON DELETE RESTRICT`
- harvest_crop_assignments_crop_assignment_id_fkey: `FOREIGN KEY (crop_assignment_id) REFERENCES crop_assignments(id) ON DELETE RESTRICT`
- harvest_crop_assignments_area_positive: `CHECK (((harvested_area_ha > (0)::numeric) AND (harvested_area_ha <> 'NaN'::numeric)))`

Índices actuales:

- harvest_crop_assignments_pkey: `CREATE UNIQUE INDEX harvest_crop_assignments_pkey ON public.harvest_crop_assignments USING btree (harvest_id, crop_assignment_id)`
- idx_harvest_crop_assignments_harvest: `CREATE INDEX idx_harvest_crop_assignments_harvest ON public.harvest_crop_assignments USING btree (harvest_id)`
- idx_harvest_crop_assignments_assignment: `CREATE INDEX idx_harvest_crop_assignments_assignment ON public.harvest_crop_assignments USING btree (crop_assignment_id)`

### harvest_cycle_closures

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| company_id | uuid | NO | NULL |
| crop_assignment_id | uuid | NO | NULL |
| finalized_date | date | NO | NULL |
| reason | text | NO | NULL |
| notes | text | YES | NULL |
| created_by | uuid | NO | NULL |
| total_area_ha | numeric | NO | NULL |
| harvested_area_ha | numeric | NO | NULL |
| remaining_area_ha | numeric | NO | NULL |
| created_at | timestamptz | NO | now() |

Constraints y FK:

- harvest_cycle_closures_check: `CHECK ((total_area_ha = (harvested_area_ha + remaining_area_ha)))`
- harvest_cycle_closures_reason_check: `CHECK ((reason = ANY (ARRAY['measurement_difference'::text, 'unharvested_area'::text, 'loss'::text, 'weather'::text, 'other'::text])))`
- harvest_cycle_closures_notes_check: `CHECK (((notes IS NULL) OR (length(notes) <= 2000)))`
- harvest_cycle_closures_total_area_ha_check: `CHECK (((total_area_ha > (0)::numeric) AND (total_area_ha <> 'NaN'::numeric)))`
- harvest_cycle_closures_harvested_area_ha_check: `CHECK (((harvested_area_ha >= (0)::numeric) AND (harvested_area_ha <> 'NaN'::numeric)))`
- harvest_cycle_closures_remaining_area_ha_check: `CHECK (((remaining_area_ha > (0)::numeric) AND (remaining_area_ha <> 'NaN'::numeric)))`
- harvest_cycle_closures_check1: `CHECK (((reason <> 'other'::text) OR ((notes IS NOT NULL) AND (btrim(notes) <> ''::text))))`
- harvest_cycle_closures_pkey: `PRIMARY KEY (id)`
- harvest_cycle_closures_crop_assignment_id_key: `UNIQUE (crop_assignment_id)`
- harvest_cycle_closures_company_id_fkey: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT`
- harvest_cycle_closures_crop_assignment_id_fkey: `FOREIGN KEY (crop_assignment_id) REFERENCES crop_assignments(id) ON DELETE RESTRICT`
- harvest_cycle_closures_created_by_fkey: `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

Índices actuales:

- harvest_cycle_closures_pkey: `CREATE UNIQUE INDEX harvest_cycle_closures_pkey ON public.harvest_cycle_closures USING btree (id)`
- harvest_cycle_closures_crop_assignment_id_key: `CREATE UNIQUE INDEX harvest_cycle_closures_crop_assignment_id_key ON public.harvest_cycle_closures USING btree (crop_assignment_id)`
- idx_harvest_cycle_closures_company: `CREATE INDEX idx_harvest_cycle_closures_company ON public.harvest_cycle_closures USING btree (company_id, finalized_date)`

### harvest_records

| Columna | Tipo | NULL permitido | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| company_id | uuid | NO | NULL |
| lot_id | uuid | NO | NULL |
| crop | text | NO | NULL |
| campaign | text | NO | NULL |
| harvest_date | date | NO | NULL |
| production_kg | numeric | NO | NULL |
| harvested_area_ha | numeric | NO | NULL |
| yield_kg_ha | numeric | YES | NULL |
| notes | text | YES | NULL |
| created_by | uuid | YES | NULL |
| enabled | bool | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| crop_id | uuid | YES | NULL |
| sub_lot_id | uuid | YES | NULL |
| campaign_id | uuid | YES | NULL |
| registered_retroactively | bool | YES | NULL |
| retroactive_reason | text | YES | NULL |
| retroactive_notes | text | YES | NULL |
| registration_timezone | text | YES | NULL |

Constraints y FK:

- harvest_records_production_kg_check: `CHECK ((production_kg >= (0)::numeric))`
- harvest_records_harvested_area_ha_check: `CHECK ((harvested_area_ha > (0)::numeric))`
- chk_harvest_records_crop_not_empty: `CHECK ((btrim(crop) <> ''::text))`
- chk_harvest_records_campaign_format: `CHECK ((campaign ~ '^[0-9]{4}-[0-9]{4}

## Inventario completo: datos originales

Todos los 55 IDs, incluidos deshabilitados. **updated_at NO EXISTE en todos los casos**. created_at es literal sin zona horaria. cost=NULL en los 55; price=1 en 48, sin moneda explícita: no usar como costo histórico. price/acquisition_date se conservan en el JSON y en la ficha Finesse.

| ID | Nombre | Categoría | Unidad | Total | Disponible | Vencimiento DB | enabled | created_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5aa5242a-657d-4f8c-b180-fca4327297b7 | 2,4 D EHE | agroquimicos | litros | 20 | 20 | 2026-11-01 | true | 2026-09-01T17:27:15.031479 |
| 141400ee-27d4-4c86-a75c-7dc785e2fe9d | 2,4D EHE | agroquimicos | litros | 446 | 446 | NULL | false | 2026-08-31T16:09:33.016967 |
| b2f84fc3-ee5c-4884-b152-3dd715148680 | 2,4D EHE | agroquimicos | litros | 20 | 20 | 2028-06-03 | true | 2026-09-03T16:16:32.778291 |
| 5185a9b6-9c0d-43ac-a06e-2f83714a9f49 | 2,4D Me | agroquimicos | litros | 510 | 420 | NULL | true | 2026-08-31T16:08:13.745971 |
| d5c44c66-8467-42aa-89db-aa852e5c5bd9 | Apron Max fludioxonil | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:32:52.005336 |
| 2018927c-bfe0-4a92-9100-d6521ab2d3cb | Arsenal | agroquimicos | litros | 4 | 4 | NULL | true | 2026-08-31T16:35:21.66897 |
| 38d6d18f-b765-4971-adfa-b791e75188a8 | Atrazina 50 | agroquimicos | litros | 112.35 | 112.35 | NULL | false | 2026-08-31T16:15:49.99083 |
| f687a8f4-17eb-4269-a870-138335468a8b | Atrazina 50 | agroquimicos | litros | 112.35 | 97.35 | NULL | true | 2026-08-31T16:15:49.145372 |
| a96833ed-d1de-49fb-9291-9ee7da771eda | Bifentrin 25 | agroquimicos | litros | 4 | 4 | NULL | true | 2026-08-31T16:26:31.969814 |
| ad7587d1-dd7b-40bc-832f-b476d12af505 | Boronia | agroquimicos | litros | 20 | 20 | NULL | true | 2026-08-31T16:29:20.178914 |
| 42791e07-1482-453c-931e-05e075e653c1 | Carbendazim 50 | agroquimicos | litros | 20 | 20 | NULL | true | 2026-08-31T16:21:06.887241 |
| eab8a627-9dfe-4d32-a1d9-2ccf999a3674 | Carbendazim Thiram | agroquimicos | litros | 15 | 15 | NULL | true | 2026-08-31T16:21:33.661918 |
| 639a6717-d8ec-4e87-8968-9fb8c690eefe | Cletodim | agroquimicos | litros | 10 | 10 | NULL | true | 2026-08-31T16:20:41.703628 |
| c7996694-f147-4eec-ac94-8462b0090051 | Cripton Xpro (bixafen) | agroquimicos | litros | 30 | 3 | NULL | true | 2026-08-31T16:38:58.644822 |
| ccc8d203-cb66-4567-88a3-eb7ea72c0bb1 | Dasen (benazolin-etil) | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:29:54.801872 |
| 6695bf73-00d4-4144-a4f5-8668204c3755 | Dicamba | agroquimicos | litros | 19 | 19 | NULL | true | 2026-08-31T16:30:27.916227 |
| 589e5362-c45d-43a2-8f33-d12825843f9b | Difimet | agroquimicos | litros | 625 | 625 | NULL | true | 2026-08-31T16:31:25.168042 |
| 4a4031c9-e364-411e-8cf0-674ca7ea5180 | Diflufenicam | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:29:02.130126 |
| 886effe4-4981-471d-9a50-9103c8f72127 | Efimax (inoculante para soja) | agroquimicos | litros | 18 | 18 | NULL | true | 2026-08-31T16:35:02.61972 |
| 9f5c2d5d-1f01-4197-b48e-96e19422a450 | Esteres metálicos de ácidos grasos coadyuvante | agroquimicos | litros | 14 | 14 | NULL | true | 2026-08-31T16:36:43.701816 |
| 7a17bc98-87ec-47b4-a6cf-971bf229a653 | Fertilizante siembra trigo | fertilizantes | kg | 17282 | 805 | NULL | true | 2026-08-30T12:36:34.895101 |
| 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | Finesse | agroquimicos | kg | 6.145 | 6.145 | NULL | false | 2026-08-31T16:12:18.251684 |
| e3714cf2-bba8-4257-afd4-58c0c9d2c63d | Finesse | agroquimicos | kg | 2.7 | 2.7 | 2027-06-01 | true | 2026-09-03T16:15:08.760704 |
| efff7e45-bedd-4d86-a8c2-82cc7ed5f2df | Finesse | agroquimicos | kg | 1875 | 1874.25 | 2026-11-01 | true | 2026-09-01T17:28:23.653175 |
| f5630e98-473e-4d41-8788-27421b0ea07d | Gesagard 50 | agroquimicos | litros | 30 | 30 | NULL | true | 2026-08-31T16:30:54.410853 |
| 05aae3f4-6070-4626-83fb-03a531574864 | Glifosato 66,2 | agroquimicos | litros | 15178 | 15178 | NULL | false | 2026-08-31T15:59:55.183296 |
| a009dbe1-931c-4980-a9bc-29c014fd43e6 | Glifosato 66,2 | agroquimicos | litros | 872 | 752 | 2026-12-01 | true | 2026-09-01T17:24:42.682599 |
| e129ad1a-c0c6-4ffe-af8b-4f8f747c21f3 | Glifosato 66,2 | agroquimicos | litros | 1517.8 | 1517.8 | NULL | false | 2026-08-31T16:01:15.200794 |
| 499b1970-a5d1-441c-a30f-f34e984b8140 | Glufosinato de Amonio 20 | agroquimicos | litros | 340 | 340 | NULL | true | 2026-08-31T16:19:48.615138 |
| 79066ca8-104b-4eb9-a98e-8a2513670011 | Haloxifop 54 | agroquimicos | litros | 1 | 1 | NULL | true | 2026-08-31T16:23:40.104991 |
| b290f29a-075e-4724-a024-f26f0c781915 | Imatron | agroquimicos | litros | 10 | 10 | NULL | true | 2026-08-31T16:28:16.056742 |
| 47f82237-28b6-4a52-92d5-dd5efa774090 | Imazapic | agroquimicos | litros | 1 | 1 | NULL | true | 2026-08-31T16:37:10.036731 |
| 0afa8fa1-19d8-44d4-988d-e436db81872c | Imazetapir 10 | agroquimicos | litros | 150 | 150 | NULL | true | 2026-08-31T16:24:36.588485 |
| 966aa280-2007-45c4-b51e-322a39e9c9c7 | Imida lambda | agroquimicos | litros | 5 | 5 | NULL | true | 2026-08-31T16:25:34.628743 |
| 814b5587-0173-454d-87a8-5775ba479b34 | Imida Tebuco | agroquimicos | litros | 2 | 2 | NULL | true | 2026-08-31T16:27:53.345101 |
| 5a62bc07-6092-4ad7-bf1f-c7ee5ac0fbb4 | Imidacloprid 35 | agroquimicos | litros | 5 | 5 | NULL | true | 2026-08-31T16:27:24.152806 |
| 28576c18-e0ca-41b2-9ae1-396e1d69efd7 | Lambdacialotrina | agroquimicos | litros | 5.5 | 5.5 | NULL | true | 2026-08-31T16:25:08.395423 |
| ed325b03-d07b-481f-8ee0-ad6435c92e32 | Maxim Evolution tiabendazol | agroquimicos | litros | 5 | 5 | NULL | true | 2026-08-31T16:33:31.226312 |
| 5867871c-4304-40ca-90f2-ba003ccc2216 | Mercantor (herbicida) | agroquimicos | litros | 5 | 5 | NULL | true | 2026-08-31T16:23:11.674649 |
| 571bfc48-a3c7-4ffb-93c8-932e7d392446 | MSO siliconado | agroquimicos | litros | 101 | 76.5 | 2026-11-01 | true | 2026-09-01T17:30:26.977389 |
| a5eab2cd-7559-4aa1-af5c-7d46d0e3ead9 | MSO siliconado | agroquimicos | litros | 185.91 | 185.91 | NULL | false | 2026-08-31T16:14:41.741058 |
| 53db9f53-3ed5-4c24-82e0-c9d42c781843 | Nicosulfuron 4% | agroquimicos | litros | 1 | 1 | NULL | true | 2026-08-31T16:34:28.798988 |
| 84252f92-6e0f-408c-9cf6-d6ed73e55871 | Nicosulfuron granulado | agroquimicos | kg | 3 | 3 | NULL | true | 2026-08-31T16:36:05.758464 |
| 4348c8fb-7eb6-4a05-94a3-5bf53f5e2376 | Parakin (herbicida desecante defoliante) | agroquimicos | litros | 80 | 80 | NULL | true | 2026-08-31T16:17:58.43029 |
| 3f42b2e6-a1ed-437c-9313-67e7a84b9144 | Paraquat 5 (herbicida desecante) | agroquimicos | litros | 60 | 60 | NULL | true | 2026-08-31T16:18:37.480081 |
| b36a8fcc-5018-41ee-a9cf-9cc6ec92cebe | Pericon | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:31:57.453093 |
| 5fe76cef-2c05-4f98-b902-c4e3370add3b | Phoebus NITROX (fertilizante biologico) | fertilizantes | litros | 352.7 | 0 | NULL | true | 2026-08-31T16:40:17.656618 |
| e7d84062-ca5f-461a-ba89-7b7a4dfeedeb | Picloram 24 Rainbow | agroquimicos | litros | 10 | 10 | NULL | true | 2026-08-31T16:22:05.891614 |
| cbcac137-3e87-4360-97f8-4f52a17263a6 | Preside (flumetsulam) | agroquimicos | litros | 4 | 4 | NULL | true | 2026-08-31T16:26:07.257939 |
| 73c326f7-afea-485f-a0ae-cc4d2e336bf4 | Semilla Soja para sembrar | semillas | kg | 33570 | 33570 | NULL | true | 2026-09-13T22:32:54.270392 |
| 9221197b-2b9a-43d2-90d8-035b9eefe20f | Semilla Trigo | semillas | kg | 42250 | 1417 | NULL | true | 2026-08-30T12:39:17.454914 |
| 16e33e56-e2d3-4092-ab95-a94037addbb3 | Sulfato de Amonio | agroquimicos | litros | 60 | 60 | NULL | true | 2026-08-31T16:19:02.115143 |
| d6b52d1e-47a3-4edd-a4b1-6c88d45422f5 | Sulfentrazone 50 | agroquimicos | litros | 10 | 10 | NULL | true | 2026-08-31T16:20:15.932866 |
| afd6d354-f859-4e34-99bb-bb0e5ba785f2 | Terbutilazina 50 | agroquimicos | litros | 20 | 20 | NULL | true | 2026-08-31T16:22:45.734481 |
| 235e4a51-5ca8-4806-875b-27694e8f0a0d | Thiencarbazonemetil | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:28:43.142244 |


Referencias: U=usos totales; P=Planning distintas; A=automáticos, subconjunto de U; C=completions; L=filas usage_lots; N=notificaciones JSON. Incluyen todos los estados. Manuales=0 en todos. Asignaciones/cosechas/cierres por source_planning_id=0 para todos; no significa ausencia de lotes o campañas compartidos.

| ID | Nombre | U | P | A | C | L | N |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5aa5242a-657d-4f8c-b180-fca4327297b7 | 2,4 D EHE | 0 | 0 | 0 | 0 | 0 | 0 |
| 141400ee-27d4-4c86-a75c-7dc785e2fe9d | 2,4D EHE | 0 | 0 | 0 | 0 | 0 | 0 |
| b2f84fc3-ee5c-4884-b152-3dd715148680 | 2,4D EHE | 0 | 0 | 0 | 0 | 0 | 0 |
| 5185a9b6-9c0d-43ac-a06e-2f83714a9f49 | 2,4D Me | 2 | 2 | 2 | 2 | 2 | 0 |
| d5c44c66-8467-42aa-89db-aa852e5c5bd9 | Apron Max fludioxonil | 0 | 0 | 0 | 0 | 0 | 2 |
| 2018927c-bfe0-4a92-9100-d6521ab2d3cb | Arsenal | 0 | 0 | 0 | 0 | 0 | 0 |
| 38d6d18f-b765-4971-adfa-b791e75188a8 | Atrazina 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| f687a8f4-17eb-4269-a870-138335468a8b | Atrazina 50 | 1 | 1 | 1 | 1 | 1 | 0 |
| a96833ed-d1de-49fb-9291-9ee7da771eda | Bifentrin 25 | 0 | 0 | 0 | 0 | 0 | 0 |
| ad7587d1-dd7b-40bc-832f-b476d12af505 | Boronia | 0 | 0 | 0 | 0 | 0 | 0 |
| 42791e07-1482-453c-931e-05e075e653c1 | Carbendazim 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| eab8a627-9dfe-4d32-a1d9-2ccf999a3674 | Carbendazim Thiram | 0 | 0 | 0 | 0 | 0 | 0 |
| 639a6717-d8ec-4e87-8968-9fb8c690eefe | Cletodim | 0 | 0 | 0 | 0 | 0 | 0 |
| c7996694-f147-4eec-ac94-8462b0090051 | Cripton Xpro (bixafen) | 1 | 1 | 1 | 1 | 1 | 6 |
| ccc8d203-cb66-4567-88a3-eb7ea72c0bb1 | Dasen (benazolin-etil) | 0 | 0 | 0 | 0 | 0 | 6 |
| 6695bf73-00d4-4144-a4f5-8668204c3755 | Dicamba | 0 | 0 | 0 | 0 | 0 | 0 |
| 589e5362-c45d-43a2-8f33-d12825843f9b | Difimet | 0 | 0 | 0 | 0 | 0 | 0 |
| 4a4031c9-e364-411e-8cf0-674ca7ea5180 | Diflufenicam | 0 | 0 | 0 | 0 | 0 | 6 |
| 886effe4-4981-471d-9a50-9103c8f72127 | Efimax (inoculante para soja) | 0 | 0 | 0 | 0 | 0 | 0 |
| 9f5c2d5d-1f01-4197-b48e-96e19422a450 | Esteres metálicos de ácidos grasos coadyuvante | 0 | 0 | 0 | 0 | 0 | 0 |
| 7a17bc98-87ec-47b4-a6cf-971bf229a653 | Fertilizante siembra trigo | 5 | 6 | 5 | 5 | 0 | 0 |
| 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | Finesse | 0 | 0 | 0 | 0 | 0 | 0 |
| e3714cf2-bba8-4257-afd4-58c0c9d2c63d | Finesse | 0 | 0 | 0 | 0 | 0 | 0 |
| efff7e45-bedd-4d86-a8c2-82cc7ed5f2df | Finesse | 1 | 1 | 1 | 1 | 1 | 0 |
| f5630e98-473e-4d41-8788-27421b0ea07d | Gesagard 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| 05aae3f4-6070-4626-83fb-03a531574864 | Glifosato 66,2 | 0 | 0 | 0 | 0 | 0 | 0 |
| a009dbe1-931c-4980-a9bc-29c014fd43e6 | Glifosato 66,2 | 2 | 2 | 2 | 2 | 2 | 0 |
| e129ad1a-c0c6-4ffe-af8b-4f8f747c21f3 | Glifosato 66,2 | 0 | 0 | 0 | 0 | 0 | 0 |
| 499b1970-a5d1-441c-a30f-f34e984b8140 | Glufosinato de Amonio 20 | 0 | 0 | 0 | 0 | 0 | 0 |
| 79066ca8-104b-4eb9-a98e-8a2513670011 | Haloxifop 54 | 0 | 0 | 0 | 0 | 0 | 6 |
| b290f29a-075e-4724-a024-f26f0c781915 | Imatron | 0 | 0 | 0 | 0 | 0 | 0 |
| 47f82237-28b6-4a52-92d5-dd5efa774090 | Imazapic | 0 | 0 | 0 | 0 | 0 | 0 |
| 0afa8fa1-19d8-44d4-988d-e436db81872c | Imazetapir 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| 966aa280-2007-45c4-b51e-322a39e9c9c7 | Imida lambda | 0 | 0 | 0 | 0 | 0 | 0 |
| 814b5587-0173-454d-87a8-5775ba479b34 | Imida Tebuco | 0 | 0 | 0 | 0 | 0 | 0 |
| 5a62bc07-6092-4ad7-bf1f-c7ee5ac0fbb4 | Imidacloprid 35 | 0 | 0 | 0 | 0 | 0 | 0 |
| 28576c18-e0ca-41b2-9ae1-396e1d69efd7 | Lambdacialotrina | 0 | 0 | 0 | 0 | 0 | 2 |
| ed325b03-d07b-481f-8ee0-ad6435c92e32 | Maxim Evolution tiabendazol | 0 | 0 | 0 | 0 | 0 | 0 |
| 5867871c-4304-40ca-90f2-ba003ccc2216 | Mercantor (herbicida) | 0 | 0 | 0 | 0 | 0 | 6 |
| 571bfc48-a3c7-4ffb-93c8-932e7d392446 | MSO siliconado | 3 | 3 | 3 | 3 | 3 | 0 |
| a5eab2cd-7559-4aa1-af5c-7d46d0e3ead9 | MSO siliconado | 0 | 0 | 0 | 0 | 0 | 0 |
| 53db9f53-3ed5-4c24-82e0-c9d42c781843 | Nicosulfuron 4% | 0 | 0 | 0 | 0 | 0 | 0 |
| 84252f92-6e0f-408c-9cf6-d6ed73e55871 | Nicosulfuron granulado | 0 | 0 | 0 | 0 | 0 | 0 |
| 4348c8fb-7eb6-4a05-94a3-5bf53f5e2376 | Parakin (herbicida desecante defoliante) | 0 | 0 | 0 | 0 | 0 | 0 |
| 3f42b2e6-a1ed-437c-9313-67e7a84b9144 | Paraquat 5 (herbicida desecante) | 0 | 0 | 0 | 0 | 0 | 0 |
| b36a8fcc-5018-41ee-a9cf-9cc6ec92cebe | Pericon | 0 | 0 | 0 | 0 | 0 | 6 |
| 5fe76cef-2c05-4f98-b902-c4e3370add3b | Phoebus NITROX (fertilizante biologico) | 4 | 4 | 4 | 4 | 4 | 0 |
| e7d84062-ca5f-461a-ba89-7b7a4dfeedeb | Picloram 24 Rainbow | 0 | 0 | 0 | 0 | 0 | 0 |
| cbcac137-3e87-4360-97f8-4f52a17263a6 | Preside (flumetsulam) | 0 | 0 | 0 | 0 | 0 | 0 |
| 73c326f7-afea-485f-a0ae-cc4d2e336bf4 | Semilla Soja para sembrar | 0 | 0 | 0 | 0 | 0 | 0 |
| 9221197b-2b9a-43d2-90d8-035b9eefe20f | Semilla Trigo | 5 | 5 | 5 | 5 | 0 | 0 |
| 16e33e56-e2d3-4092-ab95-a94037addbb3 | Sulfato de Amonio | 0 | 0 | 0 | 0 | 0 | 0 |
| d6b52d1e-47a3-4edd-a4b1-6c88d45422f5 | Sulfentrazone 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| afd6d354-f859-4e34-99bb-bb0e5ba785f2 | Terbutilazina 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| 235e4a51-5ca8-4806-875b-27694e8f0a0d | Thiencarbazonemetil | 0 | 0 | 0 | 0 | 0 | 0 |


## CAMBIOS DE BASE DE DATOS NECESARIOS

Propuesta conceptual exclusivamente. **Sin SQL definitivo**, conforme al pedido específico de esta auditoría. No se ejecutó ningún cambio.

| Motivo | Tablas y cambios | Impacto/backfill | Riesgo | Verificación | Reversión |
| --- | --- | --- | --- | --- | --- |
| Separar identidad | products: ficha de identidad, unidad base, mínimo, observaciones; conservar legacy | Mapear unidades, preservar snapshot de saldos/fechas | Alterar unidades e historia sin respaldo | 55 IDs preservados, mapa por empresa | Antes del corte, retirar nuevas lecturas sin borrar snapshot |
| Registrar ingresos | stock_batches nueva | Abrir solo saldos físicos validados; costo/proveedor legacy NULL | Duplicar stock o inventar vencimiento | SUM partidas=saldo aprobado | Retirar backfill por corrida solo sin operaciones posteriores |
| Auditar stock | stock_movements nueva | Movimiento de apertura; no debitar usos viejos otra vez | Replay, carrera, doble débito | Movimientos=saldos; asignaciones=consumo | Después de operar, movimientos compensatorios |
| Unir identidad sin reescribir historia | canonical_product_id o tabla de mapeo legacy por empresa | Mapa aprobado; no cambiar FK históricas | Ciclos, cruce de empresa, doble saldo | Mapa acíclico y físico conciliado | Versionar mapa; corrección trazada tras nuevas operaciones |
| Integridad y seguridad | FK compuestas empresa/producto/partida; checks, índices FEFO/origen; revisar RLS | Validar legacy antes de constraints; planning_products/completions hoy sin company_id | Bloquear datos antiguos o creer que RLS protege service role | Pruebas de tenant, restricciones y planes de consulta | Plan controlado de retiro de constraints, sin perder evidencia |

## A. Estado actual del inventario

**55 productos: 49 habilitados y 6 deshabilitados**, todos los deshabilitados con saldo positivo. Nueve productos tienen historial de usos. Hay 24 usage_records, todos habilitados y automáticos; 24 completions, 25 planning_products y 13 Planning distintas vinculadas.

En los 55 IDs, total_quantity − available_quantity coincide con la suma de usos habilitados, tolerancia 0,00001. No hay cantidades negativas, disponible>total ni discrepancias textuales de unidad entre uso y producto. No hay usos sin product_id ni referencias directas de otra empresa en el conjunto extraído. Esto certifica consistencia numérica actual, no procedencia o exactitud física.

Existe una línea de fertilizante de 2391 kg sin completion, producto 7a17bc98-87ec-47b4-a6cf-971bf229a653, Planning c843269e-50a5-4ea5-b63d-4c5587e5b48d. El producto tiene 805 kg disponibles: revisar estado y saldo antes de ejecutarla. No contabilizar esa planificación como consumo.

## B. Problemas reales encontrados

1. Producto e ingreso mezclados; no hay historial de ingresos, partidas o movimientos.
2. Seis deshabilitados conservan saldos que podrían ser cargas sustituidas; agregarlos al nuevo saldo puede duplicar existencias.
3. Tres Finesse, uno con 1875 kg, sin prueba suficiente para corregir automáticamente.
4. Fechas de adquisición/vencimiento mezcladas y visualización un día anterior; 43 activos sin vencimiento explícito.
5. Los 24 usos tienen created_by=NULL. user_id es responsable, no prueba actor de finalización. products no guarda actor/updated_at. price=1 no es costo fiable.
6. Ajustes manuales no transaccionales, edición de saldo sin trazabilidad y reversión automática de Planning ausente.
7. Filtrado de empresa ausente en deshabilitados/reactivación/cron; RLS desactivado en products, usage_records y planning_products. Permiso PUT mal referenciado.
8. No hay unicidad semántica ni validación dimensional uniforme o checks de saldo en DB.

## C. Tabla de decisión de TODOS los productos

CONSERVAR aprueba provisionalmente identidad, no cantidades/fechas/precios. FUSIONAR es una recomendación futura condicionada, nunca una suma automática. REVISAR conserva el estado actual. No hay prueba suficiente para recomendar CORREGIR UNIDAD ni DESHABILITAR nuevos activos todavía. Los seis ya deshabilitados se mantienen así mientras se concilian.

A significa identidad nominal prácticamente segura, no compra independiente. U/P/A/N son referencias; completions/lotes figuran arriba. Riesgo medio base: aun sin usos, faltan documentos de ingresos/fechas confiables.

| Producto | ID | Stock | Unidad | U/P/A/N | Clasificación | Acción | Detalle | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2,4 D EHE | 5aa5242a-657d-4f8c-b180-fca4327297b7 | 20 | litros | 0/0/0/0 | A: identidad nominal repetida | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| 2,4D EHE | 141400ee-27d4-4c86-a75c-7dc785e2fe9d | 446 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| 2,4D EHE | b2f84fc3-ee5c-4884-b152-3dd715148680 | 20 | litros | 0/0/0/0 | A: identidad nominal repetida | FUSIONAR | Candidato hacia 5aa5242a; validar formulación y existencia independiente | Medio/alto |
| 2,4D Me | 5185a9b6-9c0d-43ac-a06e-2f83714a9f49 | 420 | litros | 2/2/2/0 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Apron Max fludioxonil | d5c44c66-8467-42aa-89db-aa852e5c5bd9 | 3 | litros | 0/0/0/2 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Arsenal | 2018927c-bfe0-4a92-9100-d6521ab2d3cb | 4 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Atrazina 50 | 38d6d18f-b765-4971-adfa-b791e75188a8 | 112.35 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Atrazina 50 | f687a8f4-17eb-4269-a870-138335468a8b | 97.35 | litros | 1/1/1/0 | A: identidad nominal repetida | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Bifentrin 25 | a96833ed-d1de-49fb-9291-9ee7da771eda | 4 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Boronia | ad7587d1-dd7b-40bc-832f-b476d12af505 | 20 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Carbendazim 50 | 42791e07-1482-453c-931e-05e075e653c1 | 20 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Carbendazim Thiram | eab8a627-9dfe-4d32-a1d9-2ccf999a3674 | 15 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Cletodim | 639a6717-d8ec-4e87-8968-9fb8c690eefe | 10 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Cripton Xpro (bixafen) | c7996694-f147-4eec-ac94-8462b0090051 | 3 | litros | 1/1/1/6 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Dasen (benazolin-etil) | ccc8d203-cb66-4567-88a3-eb7ea72c0bb1 | 3 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Dicamba | 6695bf73-00d4-4144-a4f5-8668204c3755 | 19 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Difimet | 589e5362-c45d-43a2-8f33-d12825843f9b | 625 | litros | 0/0/0/0 | Sin duplicado nominal | REVISAR | Confirmar etiqueta, presentación y unidad | Medio |
| Diflufenicam | 4a4031c9-e364-411e-8cf0-674ca7ea5180 | 3 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Efimax (inoculante para soja) | 886effe4-4981-471d-9a50-9103c8f72127 | 18 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Esteres metálicos de ácidos grasos coadyuvante | 9f5c2d5d-1f01-4197-b48e-96e19422a450 | 14 | litros | 0/0/0/0 | Sin duplicado nominal | REVISAR | Confirmar etiqueta, presentación y unidad | Medio |
| Fertilizante siembra trigo | 7a17bc98-87ec-47b4-a6cf-971bf229a653 | 805 | kg | 5/6/5/0 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Finesse | 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | 6.145 | kg | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Finesse | e3714cf2-bba8-4257-afd4-58c0c9d2c63d | 2.7 | kg | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Verificar identidad y si 2,7 ya es factura pendiente | Alto |
| Finesse | efff7e45-bedd-4d86-a8c2-82cc7ed5f2df | 1874.25 | kg | 1/1/1/0 | A: identidad nominal repetida | REVISAR | Preservar ID con historia; confirmar unidad/cantidad | Alto |
| Gesagard 50 | f5630e98-473e-4d41-8788-27421b0ea07d | 30 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Glifosato 66,2 | 05aae3f4-6070-4626-83fb-03a531574864 | 15178 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Glifosato 66,2 | a009dbe1-931c-4980-a9bc-29c014fd43e6 | 752 | litros | 2/2/2/0 | A: identidad nominal repetida | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Glifosato 66,2 | e129ad1a-c0c6-4ffe-af8b-4f8f747c21f3 | 1517.8 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Glufosinato de Amonio 20 | 499b1970-a5d1-441c-a30f-f34e984b8140 | 340 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Haloxifop 54 | 79066ca8-104b-4eb9-a98e-8a2513670011 | 1 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imatron | b290f29a-075e-4724-a024-f26f0c781915 | 10 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imazapic | 47f82237-28b6-4a52-92d5-dd5efa774090 | 1 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imazetapir 10 | 0afa8fa1-19d8-44d4-988d-e436db81872c | 150 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imida lambda | 966aa280-2007-45c4-b51e-322a39e9c9c7 | 5 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imida Tebuco | 814b5587-0173-454d-87a8-5775ba479b34 | 2 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imidacloprid 35 | 5a62bc07-6092-4ad7-bf1f-c7ee5ac0fbb4 | 5 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Lambdacialotrina | 28576c18-e0ca-41b2-9ae1-396e1d69efd7 | 5.5 | litros | 0/0/0/2 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Maxim Evolution tiabendazol | ed325b03-d07b-481f-8ee0-ad6435c92e32 | 5 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Mercantor (herbicida) | 5867871c-4304-40ca-90f2-ba003ccc2216 | 5 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| MSO siliconado | 571bfc48-a3c7-4ffb-93c8-932e7d392446 | 76.5 | litros | 3/3/3/0 | A: identidad nominal repetida | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| MSO siliconado | a5eab2cd-7559-4aa1-af5c-7d46d0e3ead9 | 185.91 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Nicosulfuron 4% | 53db9f53-3ed5-4c24-82e0-c9d42c781843 | 1 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Nicosulfuron granulado | 84252f92-6e0f-408c-9cf6-d6ed73e55871 | 3 | kg | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Parakin (herbicida desecante defoliante) | 4348c8fb-7eb6-4a05-94a3-5bf53f5e2376 | 80 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Paraquat 5 (herbicida desecante) | 3f42b2e6-a1ed-437c-9313-67e7a84b9144 | 60 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Pericon | b36a8fcc-5018-41ee-a9cf-9cc6ec92cebe | 3 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Phoebus NITROX (fertilizante biologico) | 5fe76cef-2c05-4f98-b902-c4e3370add3b | 0 | litros | 4/4/4/0 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Picloram 24 Rainbow | e7d84062-ca5f-461a-ba89-7b7a4dfeedeb | 10 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Preside (flumetsulam) | cbcac137-3e87-4360-97f8-4f52a17263a6 | 4 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Semilla Soja para sembrar | 73c326f7-afea-485f-a0ae-cc4d2e336bf4 | 33570 | kg | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Semilla Trigo | 9221197b-2b9a-43d2-90d8-035b9eefe20f | 1417 | kg | 5/5/5/0 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Sulfato de Amonio | 16e33e56-e2d3-4092-ab95-a94037addbb3 | 60 | litros | 0/0/0/0 | Sin duplicado nominal | REVISAR | Confirmar etiqueta, presentación y unidad | Medio |
| Sulfentrazone 50 | d6b52d1e-47a3-4edd-a4b1-6c88d45422f5 | 10 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Terbutilazina 50 | afd6d354-f859-4e34-99bb-bb0e5ba785f2 | 20 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Thiencarbazonemetil | 235e4a51-5ca8-4806-875b-27694e8f0a0d | 3 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |


## D. Duplicados seguros de identidad nominal

Normalización: minúsculas, sin espacios/tildes/puntuación, incluidas coma/punto; conservar números de concentración y términos de formulación. Estos cinco grupos coinciden en nombre normalizado, unidad y categoría. Clasificación A; confirmar etiqueta antes de fusión porque no existe ficha comercial suficiente en DB.

| Grupo | IDs | Decisión |
| --- | --- | --- |
| 2,4 D EHE | 5aa5242a-657d-4f8c-b180-fca4327297b7; b2f84fc3-ee5c-4884-b152-3dd715148680; 141400ee-27d4-4c86-a75c-7dc785e2fe9d | Solo difieren espacios. Dos activos de 20 L con vencimientos distintos y deshabilitado de 446 L. Principal candidato 5aa5242a; comprobar si los 20 L son existencias distintas. |
| Atrazina 50 | f687a8f4-17eb-4269-a870-138335468a8b; 38d6d18f-b765-4971-adfa-b791e75188a8 | Mismo total 112,35; creación separada por menos de un segundo. Conservar activo f687a8f4 con uso. Deshabilitado parece carga duplicada, no ingreso adicional. |
| Finesse | efff7e45-bedd-4d86-a8c2-82cc7ed5f2df; e3714cf2-bba8-4257-afd4-58c0c9d2c63d; 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | Mismos nombre/kg; principal candidato efff7e45 por historial, condicionado a unidad/identidad. |
| Glifosato 66,2 | a009dbe1-931c-4980-a9bc-29c014fd43e6; 05aae3f4-6070-4626-83fb-03a531574864; e129ad1a-c0c6-4ffe-af8b-4f8f747c21f3 | Conservar activo a009dbe1, 752 L. Deshabilitados 15178 y 1517,8 difieren factor 10; no sumarlos. |
| MSO siliconado | 571bfc48-a3c7-4ffb-93c8-932e7d392446; a5eab2cd-7559-4aa1-af5c-7d46d0e3ead9 | Conservar activo 571bfc48 con usos; deshabilitado 185,91 L sin usos exige validación. |

## E. Duplicados dudosos y productos diferentes

| Comparación | Clase | Motivo/decisión |
| --- | --- | --- |
| EHE vs 2,4D Me | B | Me no identifica suficientemente formulación; mantener separados. |
| Glifosato 66,2 vs factura 66% FULL II SIGMA | B | Concentración nominal/marca diferentes; pedir etiqueta. |
| Dicamba vs DICAMBA SIGMA | B | Principio nombrado no demuestra identidad comercial. |
| MSO / MSC / POWER SIL / POWER SIL SIGMA | B | MSC no existe por ese nombre; no asumir equivalencia entre coadyuvantes. |
| Cripton Xpro (bixafen) vs CRIPTOM X PRO | B | Posible error trivial de escritura; confirmar composición completa/etiqueta. |
| Difimet vs Diflufenicam | B | Abreviatura no permite deducir composición/concentración. |
| Parakin vs Paraquat 5 | B | Función parecida no prueba identidad. |
| Nicosulfuron 4% litros vs granulado kg | C | Presentación y unidad incompatibles para fusión automática. |
| Carbendazim 50 vs Carbendazim Thiram | C | Composición nominal diferente. |
| Glifosato vs Glufosinato de Amonio 20 | C | Insumos nombrados distintos, no error trivial. |
| Imida lambda / Imida Tebuco / Imidacloprid 35 / Lambdacialotrina | C | Combinaciones/nombres diferentes: conservar separados. |
| METSULFURON vs Finesse/Nicosulfuron | C para asignación automática | No usar familia o parte del nombre como equivalencia; identidad propia confirmada. |

## F. Unidades y cantidades sospechosas

| Producto/ID | Valor almacenado | Usos | Motivo |
| --- | --- | --- | --- |
| Finesse efff7e45… | 1875 total / 1874,25 disponible kg | 0,75 kg automático | Escala discordante con compras de 2,7 y 4,2 aportadas. Hipótesis gramos cargados como kg, no probada. |
| Glifosato 05aae3f4… / e129ad1a… | 15178 / 1517,8 litros, deshabilitados | 0 | Factor 10 exacto: posible separador decimal/corrección; no demuestra L/ml. |
| Difimet 589e5362… | 625 litros | 0 | Señal débil por escala frente a otras cargas pequeñas; verificar cantidad/presentación. No afirmar que eran ml. |
| Sulfato de Amonio 16e33e56… | 60 litros | 0 | Presentación líquida/sólida no documentada; no cambiar por el nombre. |
| Finesse 30f4c9d7… | 6,145 kg deshabilitado | 0 | Puede ser saldo reemplazado. |
| Esteres metálicos… 9f5c2d5d… | 14 litros | 0 | Revisar escritura de etiqueta y formulación; no inferir corrección química. |

Los grandes stocks de semillas/fertilizante no se marcan incorrectos solo por tamaño: sus consumos están en kg y concilian. No aparecen g/ml/cc en productos ni usos del conjunto. Futuras conversiones g↔kg y ml/cc↔litros deben ser explícitas y guardar entrada/factor; no convertir masa↔volumen sin información física específica.

## G. Qué hacer con los Finesse

| Campo | 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | e3714cf2-bba8-4257-afd4-58c0c9d2c63d | efff7e45-bedd-4d86-a8c2-82cc7ed5f2df |
| --- | --- | --- | --- |
| name | Finesse | Finesse | Finesse |
| category | agroquimicos | agroquimicos | agroquimicos |
| unit | kg | kg | kg |
| total_quantity | 6.145 | 2.7 | 1875 |
| available_quantity | 6.145 | 2.7 | 1874.25 |
| expiration_date | NULL | 2027-06-01 | 2026-11-01 |
| acquisition_date | 2026-11-21 | 2027-06-01 | 2026-11-01 |
| enabled | false | true | true |
| created_at | 2026-08-31T16:12:18.251684 | 2026-09-03T16:15:08.760704 | 2026-09-01T17:28:23.653175 |
| price | 1 | NULL | NULL |
| cost | NULL | NULL | NULL |
| company_id | 2791ea15-7dad-48e2-945b-3791e2d44478 | 2791ea15-7dad-48e2-945b-3791e2d44478 | 2791ea15-7dad-48e2-945b-3791e2d44478 |


updated_at no existe. e3714cf2 y 30f4c9d7 tienen cero usos, Planning, completions, usage_lots y notificaciones de producto. efff7e45 tiene 1 uso, 1 Planning, 1 completion, 1 vínculo lote/sub-lote y 0 notificaciones de producto.

Datos completos de uso, Planning, línea, completion y lotes vinculados (valores literales DB):

```json
{
  "usage": {
    "id": "de385af3-b2f3-410a-9d54-9b695e74ebf2",
    "date": "2026-07-30",
    "unit": "kg",
    "crop_id": "fbe5fe76-ef78-41d4-b877-7df0fc46d27d",
    "enabled": true,
    "user_id": "5b8c04fc-7f94-44e7-9a9e-1a7d3fd92394",
    "company_id": "2791ea15-7dad-48e2-945b-3791e2d44478",
    "created_at": "2026-09-01T17:38:47.146485",
    "created_by": null,
    "product_id": "efff7e45-bedd-4d86-a8c2-82cc7ed5f2df",
    "total_area": 49.9421,
    "amount_used": 0.75,
    "current_crop": "Sorgo",
    "previous_crop": null,
    "source_planning_id": "0f69e902-c031-44cd-b1e6-e6b716c671b1",
    "source_planning_product_id": "55918967-3236-4138-bd94-f104e686e256"
  },
  "planning": {
    "id": "0f69e902-c031-44cd-b1e6-e6b716c671b1",
    "title": null,
    "end_at": "2026-07-31T00:00:00+00:00",
    "status": "completado",
    "crop_id": "fbe5fe76-ef78-41d4-b877-7df0fc46d27d",
    "enabled": true,
    "start_at": "2026-07-31T00:00:00+00:00",
    "company_id": "2791ea15-7dad-48e2-945b-3791e2d44478",
    "created_at": "2026-09-01T17:36:32.338458+00:00",
    "created_by": "5b8c04fc-7f94-44e7-9a9e-1a7d3fd92394",
    "date_range": "[\"2026-07-31 00:00:00+00\",\"2026-07-31 00:00:00+00\"]",
    "updated_at": "2026-09-01T17:38:47.146485+00:00",
    "vehicle_id": null,
    "campaign_id": "2877e3ab-fd97-4e93-9f49-daf80b283f73",
    "description": "Fumigación post cosecha",
    "completed_at": null,
    "activity_type": "fumigacion",
    "effective_date": null,
    "responsible_user": "5b8c04fc-7f94-44e7-9a9e-1a7d3fd92394",
    "registered_retroactively": false
  },
  "planning_product": {
    "id": "55918967-3236-4138-bd94-f104e686e256",
    "unit": "kg",
    "amount": 0.75,
    "product_id": "efff7e45-bedd-4d86-a8c2-82cc7ed5f2df",
    "planning_id": "0f69e902-c031-44cd-b1e6-e6b716c671b1"
  },
  "completion": {
    "usage_id": "de385af3-b2f3-410a-9d54-9b695e74ebf2",
    "created_at": "2026-09-01T17:38:47.146485+00:00",
    "planning_id": "0f69e902-c031-44cd-b1e6-e6b716c671b1",
    "actual_amount": 0.75,
    "planning_product_id": "55918967-3236-4138-bd94-f104e686e256"
  },
  "usage_lots": [
    {
      "lot_id": "512b4146-bdc9-4d8e-8b57-dc8139b96ba9",
      "usage_id": "de385af3-b2f3-410a-9d54-9b695e74ebf2",
      "sub_lot_id": "1c3b286b-4618-427c-8f49-56dfc5db9ecc"
    }
  ]
}
```

El Planning tiene effective_date y completed_at NULL y registered_retroactively=false pese a uso anterior a creación. Preservar la limitación legacy; no inventar marcas retrospectivas. No hay asignaciones/cosechas/cierres ligados a este producto por source_planning_id.

El diferencial 1875−1874,25=0,75 concilia con el uso. **No dividir todas las cifras por 1000.** Si el ingreso fuera 1875 g=1,875 kg y el uso 0,75 kg fuera correcto, quedarían 1,125 kg, no 1,87425 kg. Si el uso también está mal, el resultado cambia. 0,75 kg/49,9421 ha equivale aproximadamente a 15,018 g/ha: cálculo, no validación agronómica.

Es viable una identidad Finesse con varias partidas preservando los tres IDs legacy. Candidato canónico efff7e45 por historial; conservar sus FK y resolver canónico para operaciones nuevas. No modificar unidad/saldo hasta conciliación. Una partida por saldo físico validado y origen, vencimiento confirmado. **e3714cf2=2,7 coincide con una línea pendiente: confirmar si ya la representa antes de cargar otra vez.** Mantener 30f4c9d7 deshabilitado y fuera del saldo hasta demostrar que 6,145 kg son adicionales.

## H. Migrar legacy y fusionar sin perder historial

1. Corte con respaldo y snapshot de los 55 productos/referencias; aprobar saldo físico y mapa de identidad. Identificar corrida y pausar escritores durante corte.
2. Para activo con saldo validado >0, partida “Stock inicial / legacy”: inicial=disponible aprobado, disponible igual, precio/proveedor NULL, origen legacy, fecha ingreso contable=corte y fecha histórica desconocida explícita. Vencimiento solo si confiable; preservar original en snapshot. No usar acquisition_date como ingreso.
3. Movimiento de apertura por ese saldo. No descontar otra vez los 24 usos viejos: ya están reflejados. Si se incorporan a una consulta histórica, distinguirlos del libro operativo, sin afectar apertura o saldo.
4. Guardar total_quantity y available_quantity originales. La diferencia concilia, pero total no demuestra compras acumuladas. No abrir por total y volver a debitar usos. Producto con cero saldo conserva identidad/historia sin partida positiva ficticia.
5. Deshabilitados quedan en archivo legacy, fuera de stock utilizable hasta decisión. Si son sustituidos, documentar que no aportan existencia; si son físicos adicionales, incorporarlos una sola vez tras aprobación.
6. Fusión preferida: mapa legacy→canónico dentro de empresa, sin reescribir FK históricas. Nuevos ingresos/usos usan canónico. Apertura guarda legacy_product_id, snapshot, motivo, actor y fecha de mapeo. Secundarios siguen consultables y dejan de ofrecerse para operaciones nuevas tras aprobación.
7. Reasignar todas las FK puede colisionar con PK(planning_id,product_id) si ambas identidades están en un mismo Planning. No borrar líneas con completions/source_planning_product_id para resolverlo. Notifications JSON tampoco sigue FK. Alias de texto solo no conserva procedencia; mover saldo solo deja historia fragmentada. Mapa de IDs es la alternativa más segura para V1.
8. Verificar saldos aprobados por canónico/empresa, conteos e IDs de los 24 usos, 25 líneas, 24 completions. Antes de operar, retirar backfill por corrida; después, reversión compensatoria sin borrar historia.

## I. Compra pendiente

No se cargó nada. Cantidades y TC=1511 provienen del pedido; no se aportaron precios/importes por línea, fecha, proveedor, comprobante ni vencimientos. No inventarlos.

| Línea | Cantidad | Correspondencia real y acción futura |
| --- | --- | --- |
| DICAMBA | 20 | Existe 6695bf73-00d4-4144-a4f5-8668204c3755, 19 litros. Confirmar formulación/unidad. |
| DICAMBA SIGMA | 20 | No existe exacto. Decidir si marca/formulación requiere identidad separada. |
| METSULFURON | 0,8 | No existe exacto. Crear tras confirmar concentración/presentación/unidad. |
| GLIFOSATO 66% FULL II SIGMA | 200 | Candidato Glifosato 66,2 a009dbe1…; confirmar concentración/marca o crear nuevo. |
| GLIFOSATO 66% FULL II SIGMA | 80 | Misma identidad confirmada; otra partida si precio distinto. |
| FINESSE (150grs) | 2,7 | Confirmar kg/envases y si e3714cf2 ya cargó esta línea. |
| FINESSE (150grs) | 4,2 | Mismo canónico solo tras validación; otra partida si precio distinto. |
| 2.4 D LV ESTER ETIL HEXILICO | 140 | Candidatos EHE 5aa5242a…/b2f84fc3…; confirmar LV/concentración. No usar Me. |
| 2.4 D LV ESTER ETIL HEXILICO | 140 | Línea independiente; distinta partida si precio/vencimiento distinto. |
| POWER SIL | 40 | No existe exacto; no asignar a MSO automáticamente. Crear tras etiqueta. |
| POWER SIL SIGMA | 35 | No existe exacto; decidir si debe separarse del anterior. |
| CRIPTOM X PRO | 30 | Candidato c7996694-f147-4eec-ac94-8462b0090051, Cripton Xpro (bixafen), 3 L disponibles. Confirmar identidad y si total legacy 30 ya era esta compra. |
| BOGARD DIFECONAZOLE 25% x 1 LT | 1 | No existe exacto. Crear tras etiqueta y unidad; no asignar a Difimet por parecido. |

Conservar las 13 líneas y su número de referencia. No sabemos cuáles tienen precios diferentes porque faltan importes. Repetidas: Glifosato 200/80, Finesse 2,7/4,2 y EHE 140/140; partidas separadas si difieren precio, vencimiento u origen. Una partida por línea es una política simple en V1 aun compartiendo lote de fabricante.

Si las cantidades Finesse fueran kg, 2,7 y 4,2 equivalen a 18 y 28 envases de 150 g: hipótesis aritmética a verificar, no unidad confirmada. Registrar USD unitario, total USD, TC 1511 y total ARS documental, con política de redondeo/descuentos/impuestos. No usar price=1 ni estimar importes faltantes.

## J. Modelo V1 y FEFO

Mantener convenciones snake_case, UUID, numeric, company_id, enabled y timestamps. Para minimizar ruptura, mantener kg/litros como base inicial; entrada g/ml/cc normalizada con cantidad/unidad original y factor guardado. No usar floats binarios para balances persistidos.

| Entidad | Campos propuestos |
| --- | --- |
| products | id, company_id, name comercial, category, unit base, active_ingredient NULL, concentration/formulation NULL, manufacturer NULL, minimum_stock NULL, notes, enabled, created_at, updated_at; canonical_product_id o mapa externo. Conservar columnas legacy en transición. |
| stock_batches | id, product_id, company_id, initial_quantity, available_quantity, unit, received_at, expiration_date NULL, unit_price NULL, currency ARS/USD NULL para legacy, exchange_rate NULL, total_original NULL, total_ars NULL, supplier NULL, reference NULL, notes, origin legacy/purchase/etc., created_by, created_at, updated_at; legacy_product_id, migration_run_id y estado utilizable/bloqueado. |
| stock_movements | id, product_id, company_id, batch_id cuando corresponda, movement_type ingreso/consumo/ajuste/reversión, quantity firmada en unidad base, unit, usage_id NULL, referencia de origen, created_by, occurred_at, created_at, notes, reversed_movement_id NULL, operation_id/idempotency_key; entrada original/factor de conversión. |

Una fila de movimiento por partida consumida, agrupada por operation_id/usage_id. Un Usage de 10 puede tener movimientos −4 y −6. No poner UNIQUE(usage_id) en movements. Para nuevos movimientos físicos batch_id debe ser obligatorio; NULL solo para referencia histórica sin asignación real, fuera del saldo operativo de apertura.

Invariantes: misma empresa/producto en partida/movimiento/origen; unidad compatible; saldo no negativo; consumo=asignaciones normalizadas; movimientos inmutables; reversión limitada a cantidad todavía reversible; idempotencia por operación/asignación. Índices empresa/producto/vencimiento/ingreso/id, usage_id y reversed_movement_id. FK históricas no destructivas. Stock de products pasa a derivarse de partidas o cache transaccional, nunca dos saldos editables independientes.

FEFO:

1. Partidas utilizables del producto/empresa con saldo positivo; bloquear vencidas para uso normal. Excepción solo por flujo explícito con motivo. Fechas dudosas requieren revisión.
2. expiration_date ascendente, NULL al final; desempate received_at e id. Sin vencimiento después de las fechadas válidas, FIFO entre sí. Política visible.
3. Transacción única con bloqueo en orden estable, reparto hasta cubrir consumo y rollback total si falta saldo. Usage+movimientos+saldo+completion atómicos e idempotentes.
4. Usage manual y Planning llaman al mismo servicio. Planning conserva líneas/completions y crea Usage por línea, movimientos por partida. usage_lots son lotes agrícolas, no partidas.
5. Reversión devuelve a las MISMAS partidas originales, no recalcula FEFO. Vencimientos se conservan; devolución vencida no se vuelve utilizable automáticamente. Editar uso implica reversión y nuevo consumo, no sobrescritura del libro.
6. Retroactivo: distinguir fecha efectiva/registrada. Por defecto afecta saldo actual, como flujo histórico actual. FEFO sobre saldo actual no reconstruye la compra usada en el pasado; exactitud retrospectiva requiere evidencia/asignación o regularización aprobada.

## K. Orden exacto de implementación futura

1. Confirmar etiquetas/unidades Finesse, procedencia de seis deshabilitados y líneas de factura ya incluidas.
2. Corregir aislamiento de empresa, permiso de edición, fechas calendario y validación dimensional, verificando fuera de producción.
3. Aprobar corte, saldos físicos, mapa de identidades, precisión, costos legacy, FEFO/vencidos y reversión/retroactividad.
4. Diseñar cambios DB aditivos; entregar SQL exacto cuando se solicite implementación, en resumen y sin crear migrations automáticamente. Obtener autorización explícita para ejecutarlo.
5. Implementar servicio transaccional/idempotente, partidas/movimientos y restricciones; probar concurrencia, insuficiencia, reparto, reintento, reversión, unidad incompatible y empresa ajena.
6. Simular backfill en ambiente aislado con snapshot y tabla completa de reconciliación. No ensayar escrituras en producción.
7. Corte con respaldo/pausa de escritores: aplicar backfill autorizado una vez; verificar saldos y referencias.
8. Activar Inventario, Usage y Planning conjuntamente; reemplazar Agregar stock y edición directa por ingreso/ajuste trazado. Actualizar dashboard, alertas y deshabilitados.
9. Registrar factura tras descartar recarga, conservando 13 líneas, costos reales y partidas pertinentes.
10. Verificar saldos posteriores. Mantener campos/IDs legacy hasta cierre de verificación y plazo de reversión; no eliminarlos automáticamente.

## L. Riesgos que requieren decisión humana

- Confirmar si 1875 Finesse eran gramos, kg u otra presentación; validar separadamente uso 0,75 kg y saldo físico.
- Confirmar si Finesse 2,7 y Cripton 30 ya corresponden a la factura pendiente.
- Resolver los seis saldos deshabilitados: cargas sustituidas o existencias adicionales.
- Verificar formulaciones/marcas EHE/Me, Glifosato 66,2/66% Sigma, Dicamba/Sigma, POWER SIL/Sigma/MSO y CRIPTOM/Cripton.
- Validar vencimientos con etiqueta; no tomar acquisition_date como compra ni compensar en DB errores de visualización.
- Aceptar costos legacy desconocidos y autoría incompleta; no atribuir al responsable de Planning acciones sin evidencia.
- Aprobar FEFO sin vencimiento/vencidos, retroactivos y saldos de apertura antes de implementación.

**No se ejecutó ninguna fusión, corrección, deshabilitación, carga de factura ni modificación de datos/esquema en esta auditoría.**
::text))`
- harvest_records_pkey: `PRIMARY KEY (id)`
- fk_harvest_records_company: `FOREIGN KEY (company_id) REFERENCES companies(id)`
- fk_harvest_records_lot: `FOREIGN KEY (lot_id) REFERENCES lots(id)`
- fk_harvest_records_created_by: `FOREIGN KEY (created_by) REFERENCES users(id)`
- harvest_records_crop_id_fkey: `FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT`
- harvest_records_sub_lot_id_fkey: `FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT`
- harvest_records_campaign_id_fkey: `FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT`
- harvest_registration_trace_check: `CHECK ((((registered_retroactively IS NULL) AND (retroactive_reason IS NULL) AND (retroactive_notes IS NULL) AND (registration_timezone IS NULL)) OR ((registered_retroactively IS FALSE) AND (retroactive_reason IS NULL) AND (retroactive_notes IS NULL) AND (registration_timezone IS NOT NULL)) OR ((registered_retroactively IS TRUE) AND (registration_timezone IS NOT NULL) AND (retroactive_reason IS NOT NULL) AND (retroactive_reason = ANY (ARRAY['pending_record'::text, 'historical_regularization'::text, 'information_correction'::text, 'other'::text])) AND ((retroactive_reason <> 'other'::text) OR (COALESCE(length(btrim(retroactive_notes)), 0) > 0)))))`
- harvest_retroactive_notes_length: `CHECK ((length(retroactive_notes) <= 2000))`

Índices actuales:

- harvest_records_pkey: `CREATE UNIQUE INDEX harvest_records_pkey ON public.harvest_records USING btree (id)`
- idx_harvest_records_company_enabled: `CREATE INDEX idx_harvest_records_company_enabled ON public.harvest_records USING btree (company_id, enabled)`
- idx_harvest_records_company_campaign: `CREATE INDEX idx_harvest_records_company_campaign ON public.harvest_records USING btree (company_id, campaign)`
- idx_harvest_records_company_crop: `CREATE INDEX idx_harvest_records_company_crop ON public.harvest_records USING btree (company_id, crop)`
- idx_harvest_records_company_lot: `CREATE INDEX idx_harvest_records_company_lot ON public.harvest_records USING btree (company_id, lot_id)`
- idx_harvest_records_company_harvest_date: `CREATE INDEX idx_harvest_records_company_harvest_date ON public.harvest_records USING btree (company_id, harvest_date)`
- idx_harvest_records_company_campaign_crop: `CREATE INDEX idx_harvest_records_company_campaign_crop ON public.harvest_records USING btree (company_id, campaign, crop)`
- idx_harvest_records_crop_id: `CREATE INDEX idx_harvest_records_crop_id ON public.harvest_records USING btree (crop_id) WHERE (crop_id IS NOT NULL)`
- idx_harvest_records_campaign_id: `CREATE INDEX idx_harvest_records_campaign_id ON public.harvest_records USING btree (campaign_id) WHERE (campaign_id IS NOT NULL)`
- idx_harvest_records_sub_lot_id: `CREATE INDEX idx_harvest_records_sub_lot_id ON public.harvest_records USING btree (sub_lot_id) WHERE (sub_lot_id IS NOT NULL)`


## Inventario completo: datos originales

Todos los 55 IDs, incluidos deshabilitados. **updated_at NO EXISTE en todos los casos**. created_at es literal sin zona horaria. cost=NULL en los 55; price=1 en 48, sin moneda explícita: no usar como costo histórico. price/acquisition_date se conservan en el JSON y en la ficha Finesse.

| ID | Nombre | Categoría | Unidad | Total | Disponible | Vencimiento DB | enabled | created_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5aa5242a-657d-4f8c-b180-fca4327297b7 | 2,4 D EHE | agroquimicos | litros | 20 | 20 | 2026-11-01 | true | 2026-09-01T17:27:15.031479 |
| 141400ee-27d4-4c86-a75c-7dc785e2fe9d | 2,4D EHE | agroquimicos | litros | 446 | 446 | NULL | false | 2026-08-31T16:09:33.016967 |
| b2f84fc3-ee5c-4884-b152-3dd715148680 | 2,4D EHE | agroquimicos | litros | 20 | 20 | 2028-06-03 | true | 2026-09-03T16:16:32.778291 |
| 5185a9b6-9c0d-43ac-a06e-2f83714a9f49 | 2,4D Me | agroquimicos | litros | 510 | 420 | NULL | true | 2026-08-31T16:08:13.745971 |
| d5c44c66-8467-42aa-89db-aa852e5c5bd9 | Apron Max fludioxonil | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:32:52.005336 |
| 2018927c-bfe0-4a92-9100-d6521ab2d3cb | Arsenal | agroquimicos | litros | 4 | 4 | NULL | true | 2026-08-31T16:35:21.66897 |
| 38d6d18f-b765-4971-adfa-b791e75188a8 | Atrazina 50 | agroquimicos | litros | 112.35 | 112.35 | NULL | false | 2026-08-31T16:15:49.99083 |
| f687a8f4-17eb-4269-a870-138335468a8b | Atrazina 50 | agroquimicos | litros | 112.35 | 97.35 | NULL | true | 2026-08-31T16:15:49.145372 |
| a96833ed-d1de-49fb-9291-9ee7da771eda | Bifentrin 25 | agroquimicos | litros | 4 | 4 | NULL | true | 2026-08-31T16:26:31.969814 |
| ad7587d1-dd7b-40bc-832f-b476d12af505 | Boronia | agroquimicos | litros | 20 | 20 | NULL | true | 2026-08-31T16:29:20.178914 |
| 42791e07-1482-453c-931e-05e075e653c1 | Carbendazim 50 | agroquimicos | litros | 20 | 20 | NULL | true | 2026-08-31T16:21:06.887241 |
| eab8a627-9dfe-4d32-a1d9-2ccf999a3674 | Carbendazim Thiram | agroquimicos | litros | 15 | 15 | NULL | true | 2026-08-31T16:21:33.661918 |
| 639a6717-d8ec-4e87-8968-9fb8c690eefe | Cletodim | agroquimicos | litros | 10 | 10 | NULL | true | 2026-08-31T16:20:41.703628 |
| c7996694-f147-4eec-ac94-8462b0090051 | Cripton Xpro (bixafen) | agroquimicos | litros | 30 | 3 | NULL | true | 2026-08-31T16:38:58.644822 |
| ccc8d203-cb66-4567-88a3-eb7ea72c0bb1 | Dasen (benazolin-etil) | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:29:54.801872 |
| 6695bf73-00d4-4144-a4f5-8668204c3755 | Dicamba | agroquimicos | litros | 19 | 19 | NULL | true | 2026-08-31T16:30:27.916227 |
| 589e5362-c45d-43a2-8f33-d12825843f9b | Difimet | agroquimicos | litros | 625 | 625 | NULL | true | 2026-08-31T16:31:25.168042 |
| 4a4031c9-e364-411e-8cf0-674ca7ea5180 | Diflufenicam | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:29:02.130126 |
| 886effe4-4981-471d-9a50-9103c8f72127 | Efimax (inoculante para soja) | agroquimicos | litros | 18 | 18 | NULL | true | 2026-08-31T16:35:02.61972 |
| 9f5c2d5d-1f01-4197-b48e-96e19422a450 | Esteres metálicos de ácidos grasos coadyuvante | agroquimicos | litros | 14 | 14 | NULL | true | 2026-08-31T16:36:43.701816 |
| 7a17bc98-87ec-47b4-a6cf-971bf229a653 | Fertilizante siembra trigo | fertilizantes | kg | 17282 | 805 | NULL | true | 2026-08-30T12:36:34.895101 |
| 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | Finesse | agroquimicos | kg | 6.145 | 6.145 | NULL | false | 2026-08-31T16:12:18.251684 |
| e3714cf2-bba8-4257-afd4-58c0c9d2c63d | Finesse | agroquimicos | kg | 2.7 | 2.7 | 2027-06-01 | true | 2026-09-03T16:15:08.760704 |
| efff7e45-bedd-4d86-a8c2-82cc7ed5f2df | Finesse | agroquimicos | kg | 1875 | 1874.25 | 2026-11-01 | true | 2026-09-01T17:28:23.653175 |
| f5630e98-473e-4d41-8788-27421b0ea07d | Gesagard 50 | agroquimicos | litros | 30 | 30 | NULL | true | 2026-08-31T16:30:54.410853 |
| 05aae3f4-6070-4626-83fb-03a531574864 | Glifosato 66,2 | agroquimicos | litros | 15178 | 15178 | NULL | false | 2026-08-31T15:59:55.183296 |
| a009dbe1-931c-4980-a9bc-29c014fd43e6 | Glifosato 66,2 | agroquimicos | litros | 872 | 752 | 2026-12-01 | true | 2026-09-01T17:24:42.682599 |
| e129ad1a-c0c6-4ffe-af8b-4f8f747c21f3 | Glifosato 66,2 | agroquimicos | litros | 1517.8 | 1517.8 | NULL | false | 2026-08-31T16:01:15.200794 |
| 499b1970-a5d1-441c-a30f-f34e984b8140 | Glufosinato de Amonio 20 | agroquimicos | litros | 340 | 340 | NULL | true | 2026-08-31T16:19:48.615138 |
| 79066ca8-104b-4eb9-a98e-8a2513670011 | Haloxifop 54 | agroquimicos | litros | 1 | 1 | NULL | true | 2026-08-31T16:23:40.104991 |
| b290f29a-075e-4724-a024-f26f0c781915 | Imatron | agroquimicos | litros | 10 | 10 | NULL | true | 2026-08-31T16:28:16.056742 |
| 47f82237-28b6-4a52-92d5-dd5efa774090 | Imazapic | agroquimicos | litros | 1 | 1 | NULL | true | 2026-08-31T16:37:10.036731 |
| 0afa8fa1-19d8-44d4-988d-e436db81872c | Imazetapir 10 | agroquimicos | litros | 150 | 150 | NULL | true | 2026-08-31T16:24:36.588485 |
| 966aa280-2007-45c4-b51e-322a39e9c9c7 | Imida lambda | agroquimicos | litros | 5 | 5 | NULL | true | 2026-08-31T16:25:34.628743 |
| 814b5587-0173-454d-87a8-5775ba479b34 | Imida Tebuco | agroquimicos | litros | 2 | 2 | NULL | true | 2026-08-31T16:27:53.345101 |
| 5a62bc07-6092-4ad7-bf1f-c7ee5ac0fbb4 | Imidacloprid 35 | agroquimicos | litros | 5 | 5 | NULL | true | 2026-08-31T16:27:24.152806 |
| 28576c18-e0ca-41b2-9ae1-396e1d69efd7 | Lambdacialotrina | agroquimicos | litros | 5.5 | 5.5 | NULL | true | 2026-08-31T16:25:08.395423 |
| ed325b03-d07b-481f-8ee0-ad6435c92e32 | Maxim Evolution tiabendazol | agroquimicos | litros | 5 | 5 | NULL | true | 2026-08-31T16:33:31.226312 |
| 5867871c-4304-40ca-90f2-ba003ccc2216 | Mercantor (herbicida) | agroquimicos | litros | 5 | 5 | NULL | true | 2026-08-31T16:23:11.674649 |
| 571bfc48-a3c7-4ffb-93c8-932e7d392446 | MSO siliconado | agroquimicos | litros | 101 | 76.5 | 2026-11-01 | true | 2026-09-01T17:30:26.977389 |
| a5eab2cd-7559-4aa1-af5c-7d46d0e3ead9 | MSO siliconado | agroquimicos | litros | 185.91 | 185.91 | NULL | false | 2026-08-31T16:14:41.741058 |
| 53db9f53-3ed5-4c24-82e0-c9d42c781843 | Nicosulfuron 4% | agroquimicos | litros | 1 | 1 | NULL | true | 2026-08-31T16:34:28.798988 |
| 84252f92-6e0f-408c-9cf6-d6ed73e55871 | Nicosulfuron granulado | agroquimicos | kg | 3 | 3 | NULL | true | 2026-08-31T16:36:05.758464 |
| 4348c8fb-7eb6-4a05-94a3-5bf53f5e2376 | Parakin (herbicida desecante defoliante) | agroquimicos | litros | 80 | 80 | NULL | true | 2026-08-31T16:17:58.43029 |
| 3f42b2e6-a1ed-437c-9313-67e7a84b9144 | Paraquat 5 (herbicida desecante) | agroquimicos | litros | 60 | 60 | NULL | true | 2026-08-31T16:18:37.480081 |
| b36a8fcc-5018-41ee-a9cf-9cc6ec92cebe | Pericon | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:31:57.453093 |
| 5fe76cef-2c05-4f98-b902-c4e3370add3b | Phoebus NITROX (fertilizante biologico) | fertilizantes | litros | 352.7 | 0 | NULL | true | 2026-08-31T16:40:17.656618 |
| e7d84062-ca5f-461a-ba89-7b7a4dfeedeb | Picloram 24 Rainbow | agroquimicos | litros | 10 | 10 | NULL | true | 2026-08-31T16:22:05.891614 |
| cbcac137-3e87-4360-97f8-4f52a17263a6 | Preside (flumetsulam) | agroquimicos | litros | 4 | 4 | NULL | true | 2026-08-31T16:26:07.257939 |
| 73c326f7-afea-485f-a0ae-cc4d2e336bf4 | Semilla Soja para sembrar | semillas | kg | 33570 | 33570 | NULL | true | 2026-09-13T22:32:54.270392 |
| 9221197b-2b9a-43d2-90d8-035b9eefe20f | Semilla Trigo | semillas | kg | 42250 | 1417 | NULL | true | 2026-08-30T12:39:17.454914 |
| 16e33e56-e2d3-4092-ab95-a94037addbb3 | Sulfato de Amonio | agroquimicos | litros | 60 | 60 | NULL | true | 2026-08-31T16:19:02.115143 |
| d6b52d1e-47a3-4edd-a4b1-6c88d45422f5 | Sulfentrazone 50 | agroquimicos | litros | 10 | 10 | NULL | true | 2026-08-31T16:20:15.932866 |
| afd6d354-f859-4e34-99bb-bb0e5ba785f2 | Terbutilazina 50 | agroquimicos | litros | 20 | 20 | NULL | true | 2026-08-31T16:22:45.734481 |
| 235e4a51-5ca8-4806-875b-27694e8f0a0d | Thiencarbazonemetil | agroquimicos | litros | 3 | 3 | NULL | true | 2026-08-31T16:28:43.142244 |


Referencias: U=usos totales; P=Planning distintas; A=automáticos, subconjunto de U; C=completions; L=filas usage_lots; N=notificaciones JSON. Incluyen todos los estados. Manuales=0 en todos. Asignaciones/cosechas/cierres por source_planning_id=0 para todos; no significa ausencia de lotes o campañas compartidos.

| ID | Nombre | U | P | A | C | L | N |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5aa5242a-657d-4f8c-b180-fca4327297b7 | 2,4 D EHE | 0 | 0 | 0 | 0 | 0 | 0 |
| 141400ee-27d4-4c86-a75c-7dc785e2fe9d | 2,4D EHE | 0 | 0 | 0 | 0 | 0 | 0 |
| b2f84fc3-ee5c-4884-b152-3dd715148680 | 2,4D EHE | 0 | 0 | 0 | 0 | 0 | 0 |
| 5185a9b6-9c0d-43ac-a06e-2f83714a9f49 | 2,4D Me | 2 | 2 | 2 | 2 | 2 | 0 |
| d5c44c66-8467-42aa-89db-aa852e5c5bd9 | Apron Max fludioxonil | 0 | 0 | 0 | 0 | 0 | 2 |
| 2018927c-bfe0-4a92-9100-d6521ab2d3cb | Arsenal | 0 | 0 | 0 | 0 | 0 | 0 |
| 38d6d18f-b765-4971-adfa-b791e75188a8 | Atrazina 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| f687a8f4-17eb-4269-a870-138335468a8b | Atrazina 50 | 1 | 1 | 1 | 1 | 1 | 0 |
| a96833ed-d1de-49fb-9291-9ee7da771eda | Bifentrin 25 | 0 | 0 | 0 | 0 | 0 | 0 |
| ad7587d1-dd7b-40bc-832f-b476d12af505 | Boronia | 0 | 0 | 0 | 0 | 0 | 0 |
| 42791e07-1482-453c-931e-05e075e653c1 | Carbendazim 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| eab8a627-9dfe-4d32-a1d9-2ccf999a3674 | Carbendazim Thiram | 0 | 0 | 0 | 0 | 0 | 0 |
| 639a6717-d8ec-4e87-8968-9fb8c690eefe | Cletodim | 0 | 0 | 0 | 0 | 0 | 0 |
| c7996694-f147-4eec-ac94-8462b0090051 | Cripton Xpro (bixafen) | 1 | 1 | 1 | 1 | 1 | 6 |
| ccc8d203-cb66-4567-88a3-eb7ea72c0bb1 | Dasen (benazolin-etil) | 0 | 0 | 0 | 0 | 0 | 6 |
| 6695bf73-00d4-4144-a4f5-8668204c3755 | Dicamba | 0 | 0 | 0 | 0 | 0 | 0 |
| 589e5362-c45d-43a2-8f33-d12825843f9b | Difimet | 0 | 0 | 0 | 0 | 0 | 0 |
| 4a4031c9-e364-411e-8cf0-674ca7ea5180 | Diflufenicam | 0 | 0 | 0 | 0 | 0 | 6 |
| 886effe4-4981-471d-9a50-9103c8f72127 | Efimax (inoculante para soja) | 0 | 0 | 0 | 0 | 0 | 0 |
| 9f5c2d5d-1f01-4197-b48e-96e19422a450 | Esteres metálicos de ácidos grasos coadyuvante | 0 | 0 | 0 | 0 | 0 | 0 |
| 7a17bc98-87ec-47b4-a6cf-971bf229a653 | Fertilizante siembra trigo | 5 | 6 | 5 | 5 | 0 | 0 |
| 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | Finesse | 0 | 0 | 0 | 0 | 0 | 0 |
| e3714cf2-bba8-4257-afd4-58c0c9d2c63d | Finesse | 0 | 0 | 0 | 0 | 0 | 0 |
| efff7e45-bedd-4d86-a8c2-82cc7ed5f2df | Finesse | 1 | 1 | 1 | 1 | 1 | 0 |
| f5630e98-473e-4d41-8788-27421b0ea07d | Gesagard 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| 05aae3f4-6070-4626-83fb-03a531574864 | Glifosato 66,2 | 0 | 0 | 0 | 0 | 0 | 0 |
| a009dbe1-931c-4980-a9bc-29c014fd43e6 | Glifosato 66,2 | 2 | 2 | 2 | 2 | 2 | 0 |
| e129ad1a-c0c6-4ffe-af8b-4f8f747c21f3 | Glifosato 66,2 | 0 | 0 | 0 | 0 | 0 | 0 |
| 499b1970-a5d1-441c-a30f-f34e984b8140 | Glufosinato de Amonio 20 | 0 | 0 | 0 | 0 | 0 | 0 |
| 79066ca8-104b-4eb9-a98e-8a2513670011 | Haloxifop 54 | 0 | 0 | 0 | 0 | 0 | 6 |
| b290f29a-075e-4724-a024-f26f0c781915 | Imatron | 0 | 0 | 0 | 0 | 0 | 0 |
| 47f82237-28b6-4a52-92d5-dd5efa774090 | Imazapic | 0 | 0 | 0 | 0 | 0 | 0 |
| 0afa8fa1-19d8-44d4-988d-e436db81872c | Imazetapir 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| 966aa280-2007-45c4-b51e-322a39e9c9c7 | Imida lambda | 0 | 0 | 0 | 0 | 0 | 0 |
| 814b5587-0173-454d-87a8-5775ba479b34 | Imida Tebuco | 0 | 0 | 0 | 0 | 0 | 0 |
| 5a62bc07-6092-4ad7-bf1f-c7ee5ac0fbb4 | Imidacloprid 35 | 0 | 0 | 0 | 0 | 0 | 0 |
| 28576c18-e0ca-41b2-9ae1-396e1d69efd7 | Lambdacialotrina | 0 | 0 | 0 | 0 | 0 | 2 |
| ed325b03-d07b-481f-8ee0-ad6435c92e32 | Maxim Evolution tiabendazol | 0 | 0 | 0 | 0 | 0 | 0 |
| 5867871c-4304-40ca-90f2-ba003ccc2216 | Mercantor (herbicida) | 0 | 0 | 0 | 0 | 0 | 6 |
| 571bfc48-a3c7-4ffb-93c8-932e7d392446 | MSO siliconado | 3 | 3 | 3 | 3 | 3 | 0 |
| a5eab2cd-7559-4aa1-af5c-7d46d0e3ead9 | MSO siliconado | 0 | 0 | 0 | 0 | 0 | 0 |
| 53db9f53-3ed5-4c24-82e0-c9d42c781843 | Nicosulfuron 4% | 0 | 0 | 0 | 0 | 0 | 0 |
| 84252f92-6e0f-408c-9cf6-d6ed73e55871 | Nicosulfuron granulado | 0 | 0 | 0 | 0 | 0 | 0 |
| 4348c8fb-7eb6-4a05-94a3-5bf53f5e2376 | Parakin (herbicida desecante defoliante) | 0 | 0 | 0 | 0 | 0 | 0 |
| 3f42b2e6-a1ed-437c-9313-67e7a84b9144 | Paraquat 5 (herbicida desecante) | 0 | 0 | 0 | 0 | 0 | 0 |
| b36a8fcc-5018-41ee-a9cf-9cc6ec92cebe | Pericon | 0 | 0 | 0 | 0 | 0 | 6 |
| 5fe76cef-2c05-4f98-b902-c4e3370add3b | Phoebus NITROX (fertilizante biologico) | 4 | 4 | 4 | 4 | 4 | 0 |
| e7d84062-ca5f-461a-ba89-7b7a4dfeedeb | Picloram 24 Rainbow | 0 | 0 | 0 | 0 | 0 | 0 |
| cbcac137-3e87-4360-97f8-4f52a17263a6 | Preside (flumetsulam) | 0 | 0 | 0 | 0 | 0 | 0 |
| 73c326f7-afea-485f-a0ae-cc4d2e336bf4 | Semilla Soja para sembrar | 0 | 0 | 0 | 0 | 0 | 0 |
| 9221197b-2b9a-43d2-90d8-035b9eefe20f | Semilla Trigo | 5 | 5 | 5 | 5 | 0 | 0 |
| 16e33e56-e2d3-4092-ab95-a94037addbb3 | Sulfato de Amonio | 0 | 0 | 0 | 0 | 0 | 0 |
| d6b52d1e-47a3-4edd-a4b1-6c88d45422f5 | Sulfentrazone 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| afd6d354-f859-4e34-99bb-bb0e5ba785f2 | Terbutilazina 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| 235e4a51-5ca8-4806-875b-27694e8f0a0d | Thiencarbazonemetil | 0 | 0 | 0 | 0 | 0 | 0 |


## CAMBIOS DE BASE DE DATOS NECESARIOS

Propuesta conceptual exclusivamente. **Sin SQL definitivo**, conforme al pedido específico de esta auditoría. No se ejecutó ningún cambio.

| Motivo | Tablas y cambios | Impacto/backfill | Riesgo | Verificación | Reversión |
| --- | --- | --- | --- | --- | --- |
| Separar identidad | products: ficha de identidad, unidad base, mínimo, observaciones; conservar legacy | Mapear unidades, preservar snapshot de saldos/fechas | Alterar unidades e historia sin respaldo | 55 IDs preservados, mapa por empresa | Antes del corte, retirar nuevas lecturas sin borrar snapshot |
| Registrar ingresos | stock_batches nueva | Abrir solo saldos físicos validados; costo/proveedor legacy NULL | Duplicar stock o inventar vencimiento | SUM partidas=saldo aprobado | Retirar backfill por corrida solo sin operaciones posteriores |
| Auditar stock | stock_movements nueva | Movimiento de apertura; no debitar usos viejos otra vez | Replay, carrera, doble débito | Movimientos=saldos; asignaciones=consumo | Después de operar, movimientos compensatorios |
| Unir identidad sin reescribir historia | canonical_product_id o tabla de mapeo legacy por empresa | Mapa aprobado; no cambiar FK históricas | Ciclos, cruce de empresa, doble saldo | Mapa acíclico y físico conciliado | Versionar mapa; corrección trazada tras nuevas operaciones |
| Integridad y seguridad | FK compuestas empresa/producto/partida; checks, índices FEFO/origen; revisar RLS | Validar legacy antes de constraints; planning_products/completions hoy sin company_id | Bloquear datos antiguos o creer que RLS protege service role | Pruebas de tenant, restricciones y planes de consulta | Plan controlado de retiro de constraints, sin perder evidencia |

## A. Estado actual del inventario

**55 productos: 49 habilitados y 6 deshabilitados**, todos los deshabilitados con saldo positivo. Nueve productos tienen historial de usos. Hay 24 usage_records, todos habilitados y automáticos; 24 completions, 25 planning_products y 13 Planning distintas vinculadas.

En los 55 IDs, total_quantity − available_quantity coincide con la suma de usos habilitados, tolerancia 0,00001. No hay cantidades negativas, disponible>total ni discrepancias textuales de unidad entre uso y producto. No hay usos sin product_id ni referencias directas de otra empresa en el conjunto extraído. Esto certifica consistencia numérica actual, no procedencia o exactitud física.

Existe una línea de fertilizante de 2391 kg sin completion, producto 7a17bc98-87ec-47b4-a6cf-971bf229a653, Planning c843269e-50a5-4ea5-b63d-4c5587e5b48d. El producto tiene 805 kg disponibles: revisar estado y saldo antes de ejecutarla. No contabilizar esa planificación como consumo.

## B. Problemas reales encontrados

1. Producto e ingreso mezclados; no hay historial de ingresos, partidas o movimientos.
2. Seis deshabilitados conservan saldos que podrían ser cargas sustituidas; agregarlos al nuevo saldo puede duplicar existencias.
3. Tres Finesse, uno con 1875 kg, sin prueba suficiente para corregir automáticamente.
4. Fechas de adquisición/vencimiento mezcladas y visualización un día anterior; 43 activos sin vencimiento explícito.
5. Los 24 usos tienen created_by=NULL. user_id es responsable, no prueba actor de finalización. products no guarda actor/updated_at. price=1 no es costo fiable.
6. Ajustes manuales no transaccionales, edición de saldo sin trazabilidad y reversión automática de Planning ausente.
7. Filtrado de empresa ausente en deshabilitados/reactivación/cron; RLS desactivado en products, usage_records y planning_products. Permiso PUT mal referenciado.
8. No hay unicidad semántica ni validación dimensional uniforme o checks de saldo en DB.

## C. Tabla de decisión de TODOS los productos

CONSERVAR aprueba provisionalmente identidad, no cantidades/fechas/precios. FUSIONAR es una recomendación futura condicionada, nunca una suma automática. REVISAR conserva el estado actual. No hay prueba suficiente para recomendar CORREGIR UNIDAD ni DESHABILITAR nuevos activos todavía. Los seis ya deshabilitados se mantienen así mientras se concilian.

A significa identidad nominal prácticamente segura, no compra independiente. U/P/A/N son referencias; completions/lotes figuran arriba. Riesgo medio base: aun sin usos, faltan documentos de ingresos/fechas confiables.

| Producto | ID | Stock | Unidad | U/P/A/N | Clasificación | Acción | Detalle | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2,4 D EHE | 5aa5242a-657d-4f8c-b180-fca4327297b7 | 20 | litros | 0/0/0/0 | A: identidad nominal repetida | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| 2,4D EHE | 141400ee-27d4-4c86-a75c-7dc785e2fe9d | 446 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| 2,4D EHE | b2f84fc3-ee5c-4884-b152-3dd715148680 | 20 | litros | 0/0/0/0 | A: identidad nominal repetida | FUSIONAR | Candidato hacia 5aa5242a; validar formulación y existencia independiente | Medio/alto |
| 2,4D Me | 5185a9b6-9c0d-43ac-a06e-2f83714a9f49 | 420 | litros | 2/2/2/0 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Apron Max fludioxonil | d5c44c66-8467-42aa-89db-aa852e5c5bd9 | 3 | litros | 0/0/0/2 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Arsenal | 2018927c-bfe0-4a92-9100-d6521ab2d3cb | 4 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Atrazina 50 | 38d6d18f-b765-4971-adfa-b791e75188a8 | 112.35 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Atrazina 50 | f687a8f4-17eb-4269-a870-138335468a8b | 97.35 | litros | 1/1/1/0 | A: identidad nominal repetida | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Bifentrin 25 | a96833ed-d1de-49fb-9291-9ee7da771eda | 4 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Boronia | ad7587d1-dd7b-40bc-832f-b476d12af505 | 20 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Carbendazim 50 | 42791e07-1482-453c-931e-05e075e653c1 | 20 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Carbendazim Thiram | eab8a627-9dfe-4d32-a1d9-2ccf999a3674 | 15 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Cletodim | 639a6717-d8ec-4e87-8968-9fb8c690eefe | 10 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Cripton Xpro (bixafen) | c7996694-f147-4eec-ac94-8462b0090051 | 3 | litros | 1/1/1/6 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Dasen (benazolin-etil) | ccc8d203-cb66-4567-88a3-eb7ea72c0bb1 | 3 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Dicamba | 6695bf73-00d4-4144-a4f5-8668204c3755 | 19 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Difimet | 589e5362-c45d-43a2-8f33-d12825843f9b | 625 | litros | 0/0/0/0 | Sin duplicado nominal | REVISAR | Confirmar etiqueta, presentación y unidad | Medio |
| Diflufenicam | 4a4031c9-e364-411e-8cf0-674ca7ea5180 | 3 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Efimax (inoculante para soja) | 886effe4-4981-471d-9a50-9103c8f72127 | 18 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Esteres metálicos de ácidos grasos coadyuvante | 9f5c2d5d-1f01-4197-b48e-96e19422a450 | 14 | litros | 0/0/0/0 | Sin duplicado nominal | REVISAR | Confirmar etiqueta, presentación y unidad | Medio |
| Fertilizante siembra trigo | 7a17bc98-87ec-47b4-a6cf-971bf229a653 | 805 | kg | 5/6/5/0 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Finesse | 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | 6.145 | kg | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Finesse | e3714cf2-bba8-4257-afd4-58c0c9d2c63d | 2.7 | kg | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Verificar identidad y si 2,7 ya es factura pendiente | Alto |
| Finesse | efff7e45-bedd-4d86-a8c2-82cc7ed5f2df | 1874.25 | kg | 1/1/1/0 | A: identidad nominal repetida | REVISAR | Preservar ID con historia; confirmar unidad/cantidad | Alto |
| Gesagard 50 | f5630e98-473e-4d41-8788-27421b0ea07d | 30 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Glifosato 66,2 | 05aae3f4-6070-4626-83fb-03a531574864 | 15178 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Glifosato 66,2 | a009dbe1-931c-4980-a9bc-29c014fd43e6 | 752 | litros | 2/2/2/0 | A: identidad nominal repetida | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Glifosato 66,2 | e129ad1a-c0c6-4ffe-af8b-4f8f747c21f3 | 1517.8 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Glufosinato de Amonio 20 | 499b1970-a5d1-441c-a30f-f34e984b8140 | 340 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Haloxifop 54 | 79066ca8-104b-4eb9-a98e-8a2513670011 | 1 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imatron | b290f29a-075e-4724-a024-f26f0c781915 | 10 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imazapic | 47f82237-28b6-4a52-92d5-dd5efa774090 | 1 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imazetapir 10 | 0afa8fa1-19d8-44d4-988d-e436db81872c | 150 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imida lambda | 966aa280-2007-45c4-b51e-322a39e9c9c7 | 5 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imida Tebuco | 814b5587-0173-454d-87a8-5775ba479b34 | 2 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Imidacloprid 35 | 5a62bc07-6092-4ad7-bf1f-c7ee5ac0fbb4 | 5 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Lambdacialotrina | 28576c18-e0ca-41b2-9ae1-396e1d69efd7 | 5.5 | litros | 0/0/0/2 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Maxim Evolution tiabendazol | ed325b03-d07b-481f-8ee0-ad6435c92e32 | 5 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Mercantor (herbicida) | 5867871c-4304-40ca-90f2-ba003ccc2216 | 5 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| MSO siliconado | 571bfc48-a3c7-4ffb-93c8-932e7d392446 | 76.5 | litros | 3/3/3/0 | A: identidad nominal repetida | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| MSO siliconado | a5eab2cd-7559-4aa1-af5c-7d46d0e3ead9 | 185.91 | litros | 0/0/0/0 | A: identidad nominal repetida | REVISAR | Ya deshabilitado: validar si saldo sustituido; no sumar al operativo | Alto |
| Nicosulfuron 4% | 53db9f53-3ed5-4c24-82e0-c9d42c781843 | 1 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Nicosulfuron granulado | 84252f92-6e0f-408c-9cf6-d6ed73e55871 | 3 | kg | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Parakin (herbicida desecante defoliante) | 4348c8fb-7eb6-4a05-94a3-5bf53f5e2376 | 80 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Paraquat 5 (herbicida desecante) | 3f42b2e6-a1ed-437c-9313-67e7a84b9144 | 60 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Pericon | b36a8fcc-5018-41ee-a9cf-9cc6ec92cebe | 3 | litros | 0/0/0/6 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Phoebus NITROX (fertilizante biologico) | 5fe76cef-2c05-4f98-b902-c4e3370add3b | 0 | litros | 4/4/4/0 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Picloram 24 Rainbow | e7d84062-ca5f-461a-ba89-7b7a4dfeedeb | 10 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Preside (flumetsulam) | cbcac137-3e87-4360-97f8-4f52a17263a6 | 4 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Semilla Soja para sembrar | 73c326f7-afea-485f-a0ae-cc4d2e336bf4 | 33570 | kg | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Semilla Trigo | 9221197b-2b9a-43d2-90d8-035b9eefe20f | 1417 | kg | 5/5/5/0 | Sin duplicado nominal | CONSERVAR | Preservar identidad e historia; apertura de saldo validado | Medio |
| Sulfato de Amonio | 16e33e56-e2d3-4092-ab95-a94037addbb3 | 60 | litros | 0/0/0/0 | Sin duplicado nominal | REVISAR | Confirmar etiqueta, presentación y unidad | Medio |
| Sulfentrazone 50 | d6b52d1e-47a3-4edd-a4b1-6c88d45422f5 | 10 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Terbutilazina 50 | afd6d354-f859-4e34-99bb-bb0e5ba785f2 | 20 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |
| Thiencarbazonemetil | 235e4a51-5ca8-4806-875b-27694e8f0a0d | 3 | litros | 0/0/0/0 | Sin duplicado nominal | CONSERVAR | Conservar identidad; verificar saldo y ficha antes de apertura | Medio |


## D. Duplicados seguros de identidad nominal

Normalización: minúsculas, sin espacios/tildes/puntuación, incluidas coma/punto; conservar números de concentración y términos de formulación. Estos cinco grupos coinciden en nombre normalizado, unidad y categoría. Clasificación A; confirmar etiqueta antes de fusión porque no existe ficha comercial suficiente en DB.

| Grupo | IDs | Decisión |
| --- | --- | --- |
| 2,4 D EHE | 5aa5242a-657d-4f8c-b180-fca4327297b7; b2f84fc3-ee5c-4884-b152-3dd715148680; 141400ee-27d4-4c86-a75c-7dc785e2fe9d | Solo difieren espacios. Dos activos de 20 L con vencimientos distintos y deshabilitado de 446 L. Principal candidato 5aa5242a; comprobar si los 20 L son existencias distintas. |
| Atrazina 50 | f687a8f4-17eb-4269-a870-138335468a8b; 38d6d18f-b765-4971-adfa-b791e75188a8 | Mismo total 112,35; creación separada por menos de un segundo. Conservar activo f687a8f4 con uso. Deshabilitado parece carga duplicada, no ingreso adicional. |
| Finesse | efff7e45-bedd-4d86-a8c2-82cc7ed5f2df; e3714cf2-bba8-4257-afd4-58c0c9d2c63d; 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | Mismos nombre/kg; principal candidato efff7e45 por historial, condicionado a unidad/identidad. |
| Glifosato 66,2 | a009dbe1-931c-4980-a9bc-29c014fd43e6; 05aae3f4-6070-4626-83fb-03a531574864; e129ad1a-c0c6-4ffe-af8b-4f8f747c21f3 | Conservar activo a009dbe1, 752 L. Deshabilitados 15178 y 1517,8 difieren factor 10; no sumarlos. |
| MSO siliconado | 571bfc48-a3c7-4ffb-93c8-932e7d392446; a5eab2cd-7559-4aa1-af5c-7d46d0e3ead9 | Conservar activo 571bfc48 con usos; deshabilitado 185,91 L sin usos exige validación. |

## E. Duplicados dudosos y productos diferentes

| Comparación | Clase | Motivo/decisión |
| --- | --- | --- |
| EHE vs 2,4D Me | B | Me no identifica suficientemente formulación; mantener separados. |
| Glifosato 66,2 vs factura 66% FULL II SIGMA | B | Concentración nominal/marca diferentes; pedir etiqueta. |
| Dicamba vs DICAMBA SIGMA | B | Principio nombrado no demuestra identidad comercial. |
| MSO / MSC / POWER SIL / POWER SIL SIGMA | B | MSC no existe por ese nombre; no asumir equivalencia entre coadyuvantes. |
| Cripton Xpro (bixafen) vs CRIPTOM X PRO | B | Posible error trivial de escritura; confirmar composición completa/etiqueta. |
| Difimet vs Diflufenicam | B | Abreviatura no permite deducir composición/concentración. |
| Parakin vs Paraquat 5 | B | Función parecida no prueba identidad. |
| Nicosulfuron 4% litros vs granulado kg | C | Presentación y unidad incompatibles para fusión automática. |
| Carbendazim 50 vs Carbendazim Thiram | C | Composición nominal diferente. |
| Glifosato vs Glufosinato de Amonio 20 | C | Insumos nombrados distintos, no error trivial. |
| Imida lambda / Imida Tebuco / Imidacloprid 35 / Lambdacialotrina | C | Combinaciones/nombres diferentes: conservar separados. |
| METSULFURON vs Finesse/Nicosulfuron | C para asignación automática | No usar familia o parte del nombre como equivalencia; identidad propia confirmada. |

## F. Unidades y cantidades sospechosas

| Producto/ID | Valor almacenado | Usos | Motivo |
| --- | --- | --- | --- |
| Finesse efff7e45… | 1875 total / 1874,25 disponible kg | 0,75 kg automático | Escala discordante con compras de 2,7 y 4,2 aportadas. Hipótesis gramos cargados como kg, no probada. |
| Glifosato 05aae3f4… / e129ad1a… | 15178 / 1517,8 litros, deshabilitados | 0 | Factor 10 exacto: posible separador decimal/corrección; no demuestra L/ml. |
| Difimet 589e5362… | 625 litros | 0 | Señal débil por escala frente a otras cargas pequeñas; verificar cantidad/presentación. No afirmar que eran ml. |
| Sulfato de Amonio 16e33e56… | 60 litros | 0 | Presentación líquida/sólida no documentada; no cambiar por el nombre. |
| Finesse 30f4c9d7… | 6,145 kg deshabilitado | 0 | Puede ser saldo reemplazado. |
| Esteres metálicos… 9f5c2d5d… | 14 litros | 0 | Revisar escritura de etiqueta y formulación; no inferir corrección química. |

Los grandes stocks de semillas/fertilizante no se marcan incorrectos solo por tamaño: sus consumos están en kg y concilian. No aparecen g/ml/cc en productos ni usos del conjunto. Futuras conversiones g↔kg y ml/cc↔litros deben ser explícitas y guardar entrada/factor; no convertir masa↔volumen sin información física específica.

## G. Qué hacer con los Finesse

| Campo | 30f4c9d7-6245-4bf0-aa65-0a4b9e829fe8 | e3714cf2-bba8-4257-afd4-58c0c9d2c63d | efff7e45-bedd-4d86-a8c2-82cc7ed5f2df |
| --- | --- | --- | --- |
| name | Finesse | Finesse | Finesse |
| category | agroquimicos | agroquimicos | agroquimicos |
| unit | kg | kg | kg |
| total_quantity | 6.145 | 2.7 | 1875 |
| available_quantity | 6.145 | 2.7 | 1874.25 |
| expiration_date | NULL | 2027-06-01 | 2026-11-01 |
| acquisition_date | 2026-11-21 | 2027-06-01 | 2026-11-01 |
| enabled | false | true | true |
| created_at | 2026-08-31T16:12:18.251684 | 2026-09-03T16:15:08.760704 | 2026-09-01T17:28:23.653175 |
| price | 1 | NULL | NULL |
| cost | NULL | NULL | NULL |
| company_id | 2791ea15-7dad-48e2-945b-3791e2d44478 | 2791ea15-7dad-48e2-945b-3791e2d44478 | 2791ea15-7dad-48e2-945b-3791e2d44478 |


updated_at no existe. e3714cf2 y 30f4c9d7 tienen cero usos, Planning, completions, usage_lots y notificaciones de producto. efff7e45 tiene 1 uso, 1 Planning, 1 completion, 1 vínculo lote/sub-lote y 0 notificaciones de producto.

Datos completos de uso, Planning, línea, completion y lotes vinculados (valores literales DB):

```json
{
  "usage": {
    "id": "de385af3-b2f3-410a-9d54-9b695e74ebf2",
    "date": "2026-07-30",
    "unit": "kg",
    "crop_id": "fbe5fe76-ef78-41d4-b877-7df0fc46d27d",
    "enabled": true,
    "user_id": "5b8c04fc-7f94-44e7-9a9e-1a7d3fd92394",
    "company_id": "2791ea15-7dad-48e2-945b-3791e2d44478",
    "created_at": "2026-09-01T17:38:47.146485",
    "created_by": null,
    "product_id": "efff7e45-bedd-4d86-a8c2-82cc7ed5f2df",
    "total_area": 49.9421,
    "amount_used": 0.75,
    "current_crop": "Sorgo",
    "previous_crop": null,
    "source_planning_id": "0f69e902-c031-44cd-b1e6-e6b716c671b1",
    "source_planning_product_id": "55918967-3236-4138-bd94-f104e686e256"
  },
  "planning": {
    "id": "0f69e902-c031-44cd-b1e6-e6b716c671b1",
    "title": null,
    "end_at": "2026-07-31T00:00:00+00:00",
    "status": "completado",
    "crop_id": "fbe5fe76-ef78-41d4-b877-7df0fc46d27d",
    "enabled": true,
    "start_at": "2026-07-31T00:00:00+00:00",
    "company_id": "2791ea15-7dad-48e2-945b-3791e2d44478",
    "created_at": "2026-09-01T17:36:32.338458+00:00",
    "created_by": "5b8c04fc-7f94-44e7-9a9e-1a7d3fd92394",
    "date_range": "[\"2026-07-31 00:00:00+00\",\"2026-07-31 00:00:00+00\"]",
    "updated_at": "2026-09-01T17:38:47.146485+00:00",
    "vehicle_id": null,
    "campaign_id": "2877e3ab-fd97-4e93-9f49-daf80b283f73",
    "description": "Fumigación post cosecha",
    "completed_at": null,
    "activity_type": "fumigacion",
    "effective_date": null,
    "responsible_user": "5b8c04fc-7f94-44e7-9a9e-1a7d3fd92394",
    "registered_retroactively": false
  },
  "planning_product": {
    "id": "55918967-3236-4138-bd94-f104e686e256",
    "unit": "kg",
    "amount": 0.75,
    "product_id": "efff7e45-bedd-4d86-a8c2-82cc7ed5f2df",
    "planning_id": "0f69e902-c031-44cd-b1e6-e6b716c671b1"
  },
  "completion": {
    "usage_id": "de385af3-b2f3-410a-9d54-9b695e74ebf2",
    "created_at": "2026-09-01T17:38:47.146485+00:00",
    "planning_id": "0f69e902-c031-44cd-b1e6-e6b716c671b1",
    "actual_amount": 0.75,
    "planning_product_id": "55918967-3236-4138-bd94-f104e686e256"
  },
  "usage_lots": [
    {
      "lot_id": "512b4146-bdc9-4d8e-8b57-dc8139b96ba9",
      "usage_id": "de385af3-b2f3-410a-9d54-9b695e74ebf2",
      "sub_lot_id": "1c3b286b-4618-427c-8f49-56dfc5db9ecc"
    }
  ]
}
```

El Planning tiene effective_date y completed_at NULL y registered_retroactively=false pese a uso anterior a creación. Preservar la limitación legacy; no inventar marcas retrospectivas. No hay asignaciones/cosechas/cierres ligados a este producto por source_planning_id.

El diferencial 1875−1874,25=0,75 concilia con el uso. **No dividir todas las cifras por 1000.** Si el ingreso fuera 1875 g=1,875 kg y el uso 0,75 kg fuera correcto, quedarían 1,125 kg, no 1,87425 kg. Si el uso también está mal, el resultado cambia. 0,75 kg/49,9421 ha equivale aproximadamente a 15,018 g/ha: cálculo, no validación agronómica.

Es viable una identidad Finesse con varias partidas preservando los tres IDs legacy. Candidato canónico efff7e45 por historial; conservar sus FK y resolver canónico para operaciones nuevas. No modificar unidad/saldo hasta conciliación. Una partida por saldo físico validado y origen, vencimiento confirmado. **e3714cf2=2,7 coincide con una línea pendiente: confirmar si ya la representa antes de cargar otra vez.** Mantener 30f4c9d7 deshabilitado y fuera del saldo hasta demostrar que 6,145 kg son adicionales.

## H. Migrar legacy y fusionar sin perder historial

1. Corte con respaldo y snapshot de los 55 productos/referencias; aprobar saldo físico y mapa de identidad. Identificar corrida y pausar escritores durante corte.
2. Para activo con saldo validado >0, partida “Stock inicial / legacy”: inicial=disponible aprobado, disponible igual, precio/proveedor NULL, origen legacy, fecha ingreso contable=corte y fecha histórica desconocida explícita. Vencimiento solo si confiable; preservar original en snapshot. No usar acquisition_date como ingreso.
3. Movimiento de apertura por ese saldo. No descontar otra vez los 24 usos viejos: ya están reflejados. Si se incorporan a una consulta histórica, distinguirlos del libro operativo, sin afectar apertura o saldo.
4. Guardar total_quantity y available_quantity originales. La diferencia concilia, pero total no demuestra compras acumuladas. No abrir por total y volver a debitar usos. Producto con cero saldo conserva identidad/historia sin partida positiva ficticia.
5. Deshabilitados quedan en archivo legacy, fuera de stock utilizable hasta decisión. Si son sustituidos, documentar que no aportan existencia; si son físicos adicionales, incorporarlos una sola vez tras aprobación.
6. Fusión preferida: mapa legacy→canónico dentro de empresa, sin reescribir FK históricas. Nuevos ingresos/usos usan canónico. Apertura guarda legacy_product_id, snapshot, motivo, actor y fecha de mapeo. Secundarios siguen consultables y dejan de ofrecerse para operaciones nuevas tras aprobación.
7. Reasignar todas las FK puede colisionar con PK(planning_id,product_id) si ambas identidades están en un mismo Planning. No borrar líneas con completions/source_planning_product_id para resolverlo. Notifications JSON tampoco sigue FK. Alias de texto solo no conserva procedencia; mover saldo solo deja historia fragmentada. Mapa de IDs es la alternativa más segura para V1.
8. Verificar saldos aprobados por canónico/empresa, conteos e IDs de los 24 usos, 25 líneas, 24 completions. Antes de operar, retirar backfill por corrida; después, reversión compensatoria sin borrar historia.

## I. Compra pendiente

No se cargó nada. Cantidades y TC=1511 provienen del pedido; no se aportaron precios/importes por línea, fecha, proveedor, comprobante ni vencimientos. No inventarlos.

| Línea | Cantidad | Correspondencia real y acción futura |
| --- | --- | --- |
| DICAMBA | 20 | Existe 6695bf73-00d4-4144-a4f5-8668204c3755, 19 litros. Confirmar formulación/unidad. |
| DICAMBA SIGMA | 20 | No existe exacto. Decidir si marca/formulación requiere identidad separada. |
| METSULFURON | 0,8 | No existe exacto. Crear tras confirmar concentración/presentación/unidad. |
| GLIFOSATO 66% FULL II SIGMA | 200 | Candidato Glifosato 66,2 a009dbe1…; confirmar concentración/marca o crear nuevo. |
| GLIFOSATO 66% FULL II SIGMA | 80 | Misma identidad confirmada; otra partida si precio distinto. |
| FINESSE (150grs) | 2,7 | Confirmar kg/envases y si e3714cf2 ya cargó esta línea. |
| FINESSE (150grs) | 4,2 | Mismo canónico solo tras validación; otra partida si precio distinto. |
| 2.4 D LV ESTER ETIL HEXILICO | 140 | Candidatos EHE 5aa5242a…/b2f84fc3…; confirmar LV/concentración. No usar Me. |
| 2.4 D LV ESTER ETIL HEXILICO | 140 | Línea independiente; distinta partida si precio/vencimiento distinto. |
| POWER SIL | 40 | No existe exacto; no asignar a MSO automáticamente. Crear tras etiqueta. |
| POWER SIL SIGMA | 35 | No existe exacto; decidir si debe separarse del anterior. |
| CRIPTOM X PRO | 30 | Candidato c7996694-f147-4eec-ac94-8462b0090051, Cripton Xpro (bixafen), 3 L disponibles. Confirmar identidad y si total legacy 30 ya era esta compra. |
| BOGARD DIFECONAZOLE 25% x 1 LT | 1 | No existe exacto. Crear tras etiqueta y unidad; no asignar a Difimet por parecido. |

Conservar las 13 líneas y su número de referencia. No sabemos cuáles tienen precios diferentes porque faltan importes. Repetidas: Glifosato 200/80, Finesse 2,7/4,2 y EHE 140/140; partidas separadas si difieren precio, vencimiento u origen. Una partida por línea es una política simple en V1 aun compartiendo lote de fabricante.

Si las cantidades Finesse fueran kg, 2,7 y 4,2 equivalen a 18 y 28 envases de 150 g: hipótesis aritmética a verificar, no unidad confirmada. Registrar USD unitario, total USD, TC 1511 y total ARS documental, con política de redondeo/descuentos/impuestos. No usar price=1 ni estimar importes faltantes.

## J. Modelo V1 y FEFO

Mantener convenciones snake_case, UUID, numeric, company_id, enabled y timestamps. Para minimizar ruptura, mantener kg/litros como base inicial; entrada g/ml/cc normalizada con cantidad/unidad original y factor guardado. No usar floats binarios para balances persistidos.

| Entidad | Campos propuestos |
| --- | --- |
| products | id, company_id, name comercial, category, unit base, active_ingredient NULL, concentration/formulation NULL, manufacturer NULL, minimum_stock NULL, notes, enabled, created_at, updated_at; canonical_product_id o mapa externo. Conservar columnas legacy en transición. |
| stock_batches | id, product_id, company_id, initial_quantity, available_quantity, unit, received_at, expiration_date NULL, unit_price NULL, currency ARS/USD NULL para legacy, exchange_rate NULL, total_original NULL, total_ars NULL, supplier NULL, reference NULL, notes, origin legacy/purchase/etc., created_by, created_at, updated_at; legacy_product_id, migration_run_id y estado utilizable/bloqueado. |
| stock_movements | id, product_id, company_id, batch_id cuando corresponda, movement_type ingreso/consumo/ajuste/reversión, quantity firmada en unidad base, unit, usage_id NULL, referencia de origen, created_by, occurred_at, created_at, notes, reversed_movement_id NULL, operation_id/idempotency_key; entrada original/factor de conversión. |

Una fila de movimiento por partida consumida, agrupada por operation_id/usage_id. Un Usage de 10 puede tener movimientos −4 y −6. No poner UNIQUE(usage_id) en movements. Para nuevos movimientos físicos batch_id debe ser obligatorio; NULL solo para referencia histórica sin asignación real, fuera del saldo operativo de apertura.

Invariantes: misma empresa/producto en partida/movimiento/origen; unidad compatible; saldo no negativo; consumo=asignaciones normalizadas; movimientos inmutables; reversión limitada a cantidad todavía reversible; idempotencia por operación/asignación. Índices empresa/producto/vencimiento/ingreso/id, usage_id y reversed_movement_id. FK históricas no destructivas. Stock de products pasa a derivarse de partidas o cache transaccional, nunca dos saldos editables independientes.

FEFO:

1. Partidas utilizables del producto/empresa con saldo positivo; bloquear vencidas para uso normal. Excepción solo por flujo explícito con motivo. Fechas dudosas requieren revisión.
2. expiration_date ascendente, NULL al final; desempate received_at e id. Sin vencimiento después de las fechadas válidas, FIFO entre sí. Política visible.
3. Transacción única con bloqueo en orden estable, reparto hasta cubrir consumo y rollback total si falta saldo. Usage+movimientos+saldo+completion atómicos e idempotentes.
4. Usage manual y Planning llaman al mismo servicio. Planning conserva líneas/completions y crea Usage por línea, movimientos por partida. usage_lots son lotes agrícolas, no partidas.
5. Reversión devuelve a las MISMAS partidas originales, no recalcula FEFO. Vencimientos se conservan; devolución vencida no se vuelve utilizable automáticamente. Editar uso implica reversión y nuevo consumo, no sobrescritura del libro.
6. Retroactivo: distinguir fecha efectiva/registrada. Por defecto afecta saldo actual, como flujo histórico actual. FEFO sobre saldo actual no reconstruye la compra usada en el pasado; exactitud retrospectiva requiere evidencia/asignación o regularización aprobada.

## K. Orden exacto de implementación futura

1. Confirmar etiquetas/unidades Finesse, procedencia de seis deshabilitados y líneas de factura ya incluidas.
2. Corregir aislamiento de empresa, permiso de edición, fechas calendario y validación dimensional, verificando fuera de producción.
3. Aprobar corte, saldos físicos, mapa de identidades, precisión, costos legacy, FEFO/vencidos y reversión/retroactividad.
4. Diseñar cambios DB aditivos; entregar SQL exacto cuando se solicite implementación, en resumen y sin crear migrations automáticamente. Obtener autorización explícita para ejecutarlo.
5. Implementar servicio transaccional/idempotente, partidas/movimientos y restricciones; probar concurrencia, insuficiencia, reparto, reintento, reversión, unidad incompatible y empresa ajena.
6. Simular backfill en ambiente aislado con snapshot y tabla completa de reconciliación. No ensayar escrituras en producción.
7. Corte con respaldo/pausa de escritores: aplicar backfill autorizado una vez; verificar saldos y referencias.
8. Activar Inventario, Usage y Planning conjuntamente; reemplazar Agregar stock y edición directa por ingreso/ajuste trazado. Actualizar dashboard, alertas y deshabilitados.
9. Registrar factura tras descartar recarga, conservando 13 líneas, costos reales y partidas pertinentes.
10. Verificar saldos posteriores. Mantener campos/IDs legacy hasta cierre de verificación y plazo de reversión; no eliminarlos automáticamente.

## L. Riesgos que requieren decisión humana

- Confirmar si 1875 Finesse eran gramos, kg u otra presentación; validar separadamente uso 0,75 kg y saldo físico.
- Confirmar si Finesse 2,7 y Cripton 30 ya corresponden a la factura pendiente.
- Resolver los seis saldos deshabilitados: cargas sustituidas o existencias adicionales.
- Verificar formulaciones/marcas EHE/Me, Glifosato 66,2/66% Sigma, Dicamba/Sigma, POWER SIL/Sigma/MSO y CRIPTOM/Cripton.
- Validar vencimientos con etiqueta; no tomar acquisition_date como compra ni compensar en DB errores de visualización.
- Aceptar costos legacy desconocidos y autoría incompleta; no atribuir al responsable de Planning acciones sin evidencia.
- Aprobar FEFO sin vencimiento/vencidos, retroactivos y saldos de apertura antes de implementación.

**No se ejecutó ninguna fusión, corrección, deshabilitación, carga de factura ni modificación de datos/esquema en esta auditoría.**

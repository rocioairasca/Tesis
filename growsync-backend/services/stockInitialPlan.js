const {randomUUID}=require('node:crypto');
const stock=require('./stock');
const {authorize,reference}=require('./historicalImport');
const {assertSameUnit}=require('./inventoryUnits');
const {normalizeQuantity}=require('./inventoryConversion');
const {expirationFields}=require('./inventoryExpiration');

function declaration({date,entries}) {
  stock.calendarDate(date);

  if (!Array.isArray(entries)||!entries.length||entries.length>10000) throw stock.fail('Declaración de 1 a 10000 líneas requerida.',400);

  for(const e of entries){
    if (!e||typeof e!=='object'||typeof e.unit!=='string'||!e.unit.trim()||!e.product_id) throw stock.fail('Producto y unidad explícitos requeridos.',400);
    if (stock.decimal(e.quantity)<=0n) throw stock.fail('Cantidad inicial inválida; omitir existencias cero.',400);
    expirationFields(e);
    if (Object.keys(e).some(k=>!['product_id','unit','quantity','expiration_date','expiration_year','expiration_month'].includes(k))) throw stock.fail('Campo de apertura no admitido.',400);
  }

  return {date,entries:entries.map(e=>({...e}))};
}

async function validate(client,{companyId,date,entries}){

  const {rows}=await client.query('SELECT inventory_control_start_date::text FROM companies WHERE id=$1',[companyId]);

  if (!rows[0]?.inventory_control_start_date||rows[0].inventory_control_start_date!==date) throw stock.fail('La fecha debe coincidir con el inicio de control configurado.');
  
  const result=[],seen=new Set();

  for (const e of entries) {
    const p=await reference(client,'products',e.product_id,companyId);

    if (!p.enabled) throw stock.fail('Producto deshabilitado: resolver el catálogo antes de abrir.',400);

    const conversion=normalizeQuantity({quantity:e.quantity,inputUnit:e.unit,productUnit:p.unit});
    const expiry=expirationFields(e);
    const identity=JSON.stringify([p.id,expiry.expiration_date,expiry.expiration_year,expiry.expiration_month]);

    if (seen.has(identity)) throw stock.fail('Producto y vencimiento repetidos; declarar una única cantidad explícita para esa existencia.',400);

    seen.add(identity);
    result.push({product_id:p.id,unit:p.unit,quantity:conversion.normalized_quantity,...expiry,entered_quantity:conversion.entered_quantity,entered_unit:conversion.entered_unit});
  }

  return {kind:'STOCK_INITIAL',date,entries:result};
}

async function prepare(pool,x){

  const payload=declaration(x);

  return stock.transaction(pool,async client=>{
    await authorize(client,x.companyId,x.actorId);
    const plan=await validate(client,{...x,...payload});

    return {...plan,preview_hash:stock.fingerprint(plan),persisted:false,
      inventory_v1_enabled:stock.isEnabled(x.companyId),
      message:'La confirmación requiere INVENTORY_V1 activo y un inventario sin partidas ni movimientos previos.'};
  });
}

async function confirm(pool,x){

  const payload=declaration(x);

  if(x.confirmed!==true) throw stock.fail('Confirmación explícita requerida.',400);
  if(typeof x.key!=='string'||!x.key.trim()||x.key.length>200) throw stock.fail('Idempotency-Key requerido (máximo 200 caracteres).',400);
  if(typeof x.previewHash!=='string'||!/^[a-f0-9]{64}$/.test(x.previewHash)) throw stock.fail('Preview validado requerido.',400);

  const hash=stock.fingerprint({payload,preview_hash:x.previewHash});

  return stock.transaction(pool,async client=>{

    await authorize(client,x.companyId,x.actorId);
    // Shared with every batch INSERT, including receipts and legacy writers.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`stock-initial:${x.companyId}`]);
    const {rows:previous}=await client.query('SELECT * FROM stock_initial_openings WHERE company_id=$1',[x.companyId]);

    if(previous.length){
      if(previous[0].idempotency_key!==x.key) throw stock.fail('La empresa ya tiene una apertura. Corregir mediante ajustes.');
      if(previous[0].request_hash!==hash) throw stock.fail('Idempotency-Key utilizado con otro contenido.');
      return {...previous[0].result,replayed:true};
    }

    await client.query('SELECT id FROM companies WHERE id=$1 FOR UPDATE',[x.companyId]);

    const {rows:occupied}=await client.query(`SELECT EXISTS(SELECT 1 FROM stock_batches WHERE company_id=$1)
      OR EXISTS(SELECT 1 FROM stock_movements WHERE company_id=$1) AS occupied`,[x.companyId]);

    if(occupied[0].occupied) throw stock.fail('Ya existen partidas o movimientos; apertura rechazada para evitar doble conteo.');

    for(const id of [...new Set(payload.entries.map(e=>e.product_id))].sort()) await stock.lockProduct(client,x.companyId,id);

    const plan=await validate(client,{...x,...payload});
    if(stock.fingerprint(plan)!==x.previewHash) throw stock.fail('El preview cambió; volver a preparar y revisar.');

    const openingId=randomUUID();
    await client.query(`INSERT INTO stock_initial_openings(id,company_id,effective_date,actor_id,idempotency_key,request_hash,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[openingId,x.companyId,plan.date,x.actorId,x.key,hash,JSON.stringify(plan)]);

    const entries=[];

    for(const e of plan.entries){

      const {rows:b}=await client.query(`INSERT INTO stock_batches(company_id,product_id,initial_quantity,available_quantity,unit,
        received_date,expiration_date,origin,created_by,stock_initial_id,expiration_year,expiration_month)
        VALUES($1,$2,$3,$3,$4,$5,$6,'stock_initial',$7,$8,$9,$10) RETURNING *`,
      [x.companyId,e.product_id,e.quantity,e.unit,plan.date,e.expiration_date,x.actorId,openingId,e.expiration_year,e.expiration_month]);

      const {rows:m}=await client.query(`INSERT INTO stock_movements(company_id,product_id,batch_id,movement_type,quantity,unit,
        operation_id,idempotency_key,request_hash,created_by,stock_initial_id,effective_date)
        VALUES($1,$2,$3,'stock_initial',$4,$5,$6,$7,$8,$9,$6,$10) RETURNING *`,
      [x.companyId,e.product_id,b[0].id,e.quantity,e.unit,openingId,x.key,hash,x.actorId,plan.date]);
      entries.push({...e,batch_id:b[0].id,movement_id:m[0].id});
    }

    const result={kind:'STOCK_INITIAL',opening_id:openingId,date:plan.date,actor_id:x.actorId,entries,persisted:true};
    await client.query(
      'UPDATE stock_initial_openings SET result=$2::jsonb WHERE id=$1',
      [openingId, JSON.stringify(result)]
    );

    const { rows: debugRows } = await client.query(`
      SELECT
        o.id,
        o.result IS NOT NULL AS has_result,

        jsonb_typeof(o.payload) AS payload_type,
        o.payload ? 'entries' AS has_entries,

        ARRAY(
          SELECT jsonb_object_keys(o.payload)
        ) AS payload_keys,

        o.payload ->> 'kind' AS payload_kind,
        o.payload ->> 'date' AS payload_date,

        CASE
          WHEN jsonb_typeof(o.payload->'entries') = 'array'
          THEN jsonb_array_length(o.payload->'entries')
          ELSE NULL
        END::int AS expected,

        (
          SELECT count(*)
          FROM stock_batches b
          WHERE b.stock_initial_id = o.id
        )::int AS batches,

        (
          SELECT count(*)
          FROM stock_movements m
          WHERE m.stock_initial_id = o.id
        )::int AS movements

      FROM stock_initial_openings o
      WHERE o.id = $1
    `, [openingId]);

    console.log('STOCK_INITIAL DEBUG BEFORE COMMIT:', debugRows[0]);

    return {...result,replayed:false};
  });
}
module.exports={prepare,confirm};

// Dose templates only. Intentionally does not import any operational Usage writer.
const {randomUUID}=require('node:crypto');
const {normalizeQuantity}=require('./inventoryConversion');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const ACTIVITIES=['fumigacion','fertilizacion','siembra'];
const CONTEXTS=['growing_crop','stubble','fallow','pre_sowing','other'];
function identity(input){if(!uuid(input.companyId))throw fail('No pudimos identificar tu empresa.',403);}
function recipeId(id){if(!uuid(id))throw fail('La receta indicada no es válida.');}
function bodyOf(body){
  const allowed=['name','activity_type','field_context','crop_id','items'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw fail('La receta contiene campos no permitidos.');
  if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>200)throw fail('Ingresá un nombre de hasta 200 caracteres.');
  if(!ACTIVITIES.includes(body.activity_type))throw fail('Seleccioná una actividad válida.');
  if(body.field_context!=null&&!CONTEXTS.includes(body.field_context))throw fail('Seleccioná un contexto válido.');
  if(body.crop_id!=null&&!uuid(body.crop_id))throw fail('Seleccioná un cultivo válido.');
  if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)throw fail('Agregá entre 1 y 100 productos a la receta.');
  const seen=new Set();
  for(const item of body.items){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['product_id','dose_amount','dose_unit'].includes(k))||!uuid(item.product_id))throw fail('Seleccioná un producto válido en cada fila.');
    if(seen.has(item.product_id))throw fail('No podés agregar el mismo producto dos veces.');seen.add(item.product_id);
    if(typeof item.dose_unit!=='string'||!item.dose_unit.trim())throw fail('Seleccioná una unidad para cada dosis.');
  }
  return {...body,name:body.name.trim(),field_context:body.field_context??null,crop_id:body.crop_id??null};
}
async function transaction(pool,fn){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');
    if(error.code==='23505')throw fail('Ya existe una receta activa con ese nombre.',409);
    if(['23503','23514','40001','40P01'].includes(error.code))throw fail('La receta no pudo guardarse: cambió una referencia o una condición de integridad.',409);
    throw error;
  }finally{client.release();}
}
const projection=`SELECT r.*,c.name AS crop_name,COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'id',i.id,'product_id',i.product_id,'product_name',p.name,'product_unit',p.unit,'product_enabled',p.enabled,
  'dose_amount',i.dose_amount::text,'dose_unit',i.dose_unit) ORDER BY i.created_at,i.id)
  FROM public.recipe_items i JOIN public.products p ON p.id=i.product_id AND p.company_id=r.company_id
  WHERE i.recipe_id=r.id),'[]'::jsonb) AS items
  FROM public.recipes r LEFT JOIN public.crops c ON c.id=r.crop_id AND c.company_id=r.company_id`;
async function read(client,companyId,id){
  const result=(await client.query(projection+' WHERE r.company_id=$1 AND r.id=$2',[companyId,id])).rows[0];
  if(!result)throw fail('No encontramos la receta.',404);return result;
}
async function get(pool,input){identity(input);recipeId(input.id);return read(pool,input.companyId,input.id);}
async function list(pool,input){
  identity(input);const enabled=input.enabled??'true';
  if(!['true','false','all'].includes(enabled))throw fail('Seleccioná un estado válido.');
  const params=[input.companyId],where=['r.company_id=$1'];
  const add=(sql,value)=>{params.push(value);where.push(sql.replace('?', '$'+params.length));};
  if(enabled!=='all')add('r.enabled=?',enabled==='true');
  if(input.activity){if(!ACTIVITIES.includes(input.activity))throw fail('Seleccioná una actividad válida.');add('r.activity_type=?',input.activity);}
  if(input.cropId){recipeId(input.cropId);add('r.crop_id=?',input.cropId);}
  if(input.search){if(typeof input.search!=='string'||input.search.length>200)throw fail('La búsqueda es demasiado larga.');add('strpos(lower(r.name),lower(?))>0',input.search.trim());}
  return (await pool.query(projection+' WHERE '+where.join(' AND ')+' ORDER BY r.name,r.id',params)).rows;
}
async function options(pool,input){
  identity(input);
  const [products,crops]=await Promise.all([
    pool.query('SELECT id,name,unit,enabled FROM public.products WHERE company_id=$1 AND enabled=true ORDER BY name,id',[input.companyId]),
    pool.query('SELECT id,name,enabled FROM public.crops WHERE company_id=$1 ORDER BY name,id',[input.companyId]),
  ]);return {products:products.rows,crops:crops.rows};
}
async function save(pool,input){
  identity(input);const body=bodyOf(input.body);if(input.id)recipeId(input.id);
  return transaction(pool,async client=>{
    let current=null;
    if(input.id){
      const locked=(await client.query('SELECT id FROM public.recipes WHERE id=$1 AND company_id=$2 FOR UPDATE',[input.id,input.companyId])).rows[0];
      if(!locked)throw fail('No encontramos la receta.',404);current=await read(client,input.companyId,input.id);
    }else{
      if(!uuid(input.actorId)||(await client.query('SELECT id FROM public.users WHERE id=$1 AND company_id=$2 AND enabled=true',[input.actorId,input.companyId])).rows.length!==1)throw fail('El usuario no está habilitado en esta empresa.',403);
    }
    if(body.crop_id&&(await client.query('SELECT id FROM public.crops WHERE id=$1 AND company_id=$2 FOR SHARE',[body.crop_id,input.companyId])).rows.length!==1)throw fail('El cultivo no pertenece a tu empresa.');
    const productIds=body.items.map(i=>i.product_id);
    const products=(await client.query('SELECT id,name,unit,enabled FROM public.products WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',[input.companyId,productIds])).rows;
    const items=body.items.map(item=>{
      const product=products.find(p=>p.id===item.product_id),existing=current?.items.find(i=>i.product_id===item.product_id);
      if(!product)throw fail('Uno de los productos no pertenece a tu empresa.');
      if(product.enabled!==true&&!existing)throw fail('Solo podés agregar productos habilitados.');
      const dose=normalizeQuantity({quantity:item.dose_amount,inputUnit:item.dose_unit,productUnit:product.unit});
      return {...item,dose_amount:dose.entered_quantity,dose_unit:dose.entered_unit,existing};
    });
    const id=input.id||randomUUID();
    if(current)await client.query('UPDATE public.recipes SET name=$3,activity_type=$4,field_context=$5,crop_id=$6 WHERE id=$1 AND company_id=$2',[id,input.companyId,body.name,body.activity_type,body.field_context,body.crop_id]);
    else await client.query('INSERT INTO public.recipes(id,company_id,name,activity_type,field_context,crop_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,input.companyId,body.name,body.activity_type,body.field_context,body.crop_id,input.actorId]);
    // Reconcile by product: retained disabled products are not newly inserted.
    if(current)await client.query('DELETE FROM public.recipe_items WHERE recipe_id=$1 AND NOT(product_id=ANY($2::uuid[]))',[id,productIds]);
    for(const item of items){
      if(item.existing)await client.query('UPDATE public.recipe_items SET dose_amount=$3,dose_unit=$4 WHERE recipe_id=$1 AND product_id=$2',[id,item.product_id,item.dose_amount,item.dose_unit]);
      else await client.query('INSERT INTO public.recipe_items(recipe_id,product_id,dose_amount,dose_unit) VALUES($1,$2,$3::numeric,$4)',[id,item.product_id,item.dose_amount,item.dose_unit]);
    }
    return read(client,input.companyId,id);
  });
}
async function setEnabled(pool,input,enabled){
  identity(input);recipeId(input.id);
  return transaction(pool,async client=>{
    const result=await client.query('UPDATE public.recipes SET enabled=$3 WHERE id=$1 AND company_id=$2 RETURNING id',[input.id,input.companyId,enabled]);
    if(!result.rows.length)throw fail('No encontramos la receta.',404);return read(client,input.companyId,input.id);
  });
}
module.exports={list,get,options,create:save,update:save,disable:(p,i)=>setEnabled(p,i,false),enable:(p,i)=>setEnabled(p,i,true)};

// Read-only installed-schema diagnostic. Never prints credentials or product data.
const fs=require('node:fs');
require('dotenv').config({quiet:true});
const postgres=require('postgres');
const url=process.env.SUPABASE_DB_URL||process.env.DATABASE_URL;
if(!url){console.error('Sin conexión SQL configurada. No se ejecutó ninguna migración.');process.exit(2);}
const db=postgres(url,{max:1,connect_timeout:8,ssl:/supabase\.(co|net)/i.test(url)?'require':undefined});
(async()=>{try{
 const result=await db.begin('READ ONLY',async sql=>{
 await sql`SET LOCAL statement_timeout='10000ms'`;
 const tables=['products','stock_batches','stock_movements','usage_records','planning_products','planning_product_completions'];
 const columns=await sql`SELECT table_name,column_name,data_type,udt_name,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(${tables}) ORDER BY table_name,ordinal_position`;
 const constraints=await sql`SELECT c.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname=ANY(${tables}) OR k.confrelid='public.products'::regclass) ORDER BY c.relname,k.conname`;
 const triggers=await sql`SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(${tables}) AND NOT t.tgisinternal`;
 const units=await sql`SELECT unit,count(*)::int AS count FROM products GROUP BY unit ORDER BY unit`;
 return {checked_at:new Date().toISOString(),read_only:true,columns,constraints,triggers,units};
 });fs.writeFileSync('../audit/inventory-units-installed-2026-09-14.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){console.error('Diagnóstico no completado:',e.code||'CONNECTION_ERROR');process.exitCode=2;}finally{await db.end({timeout:2});}})();

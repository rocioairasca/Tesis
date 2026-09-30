const {randomUUID}=require('node:crypto');
// Opt-in harness for a disposable LOCAL PostgreSQL/PostGIS database only.
// Never reads .env, DATABASE_URL or SUPABASE_DB_URL. Never installs extensions.
module.exports=async function database(t){
  const url=process.env.STOCK_INITIAL_POSTGIS_URL;
  if(!url){
    const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();t.after(()=>db.close());
    return db;
  }
  const parsed=new URL(url);
  if(process.env.STOCK_INITIAL_ALLOW_DISPOSABLE!=='yes'
    ||!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)
    ||!/^\/growsync_test_[a-z0-9_]+$/.test(parsed.pathname)) throw new Error('PostGIS tests require an explicitly allowed local growsync_test_* disposable database');
  const {Client}=require('pg');const client=new Client({connectionString:url,connectionTimeoutMillis:5000});
  await client.connect();
  const schema='stock_initial_test_'+randomUUID().replaceAll('-','');let created=false;
  t.after(async()=>{try{await client.query('ROLLBACK');if(created) await client.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await client.end();}});
  await client.query('SELECT postgis_version()');
  await client.query(`CREATE SCHEMA ${schema}`);created=true;
  await client.query(`SET search_path TO ${schema},public`);
  return {
    query:(sql,args)=>client.query(sql,args),
    exec:sql=>client.query(sql.replace(/\bpublic\b/g,schema)
      .replace(/"(geom|parent_geom_snapshot)" text/g,'"$1" geometry(Polygon,4326)')),
    async concurrentPool(){
      const {Pool}=require('pg');const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:5000});
      return {async connect(){const c=await pool.connect();await c.query(`SET search_path TO ${schema},public`);return c;},end:()=>pool.end()};
    },
    postgis:true,
  };
};

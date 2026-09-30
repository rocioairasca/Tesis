const fs=require('node:fs'),path=require('node:path'),{Client}=require('pg'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),local=path.join(root,'.local-postgis');
const config=JSON.parse(fs.readFileSync(path.join(local,'connection.json'),'utf8').replace(/^\uFEFF/,''));
if(config.host!=='127.0.0.1'||config.port!==55439||config.database!=='growsync_test_stock_initial')throw new Error('Not the isolated test cluster');
(async()=>{
  const admin=new Client({...config,database:'postgres',connectionTimeoutMillis:5000});await admin.connect();
  const dataDir=(await admin.query('SHOW data_directory')).rows[0].data_directory;
  if(path.resolve(dataDir).toLowerCase()!==path.join(local,'data').toLowerCase())throw new Error('Cluster directory mismatch');
  if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[config.database])).rowCount)await admin.query('CREATE DATABASE growsync_test_stock_initial');
  await admin.end();
  const db=new Client(config);await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  const versions=(await db.query('SELECT version() postgres,postgis_full_version() postgis')).rows[0];
  const extensions=(await db.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
  await db.end();
  const evidence={...versions,extensions,host:'127.0.0.1',port:55439,cluster_directory:dataDir,source_urls:[
    'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip',
    'https://download.osgeo.org/postgis/windows/pg17/postgis-bundle-pg17-3.6.2x64.zip']};
  const output=path.join(root,'audit/local-postgis-validation');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'versions.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
  const connection=`postgresql://${config.user}:${config.password}@127.0.0.1:55439/${config.database}`;
  const all=process.argv.includes('--all');
  const files=all?['tests/*.test.js']:['tests/stockInitial.integration.test.js','tests/preResetPostgis.integration.test.js'];
  const result=spawnSync(process.execPath,['--test','--test-concurrency=3',...files],{
    cwd:path.join(root,'growsync-backend'),encoding:'utf8',env:{...process.env,STOCK_INITIAL_POSTGIS_URL:connection,STOCK_INITIAL_ALLOW_DISPOSABLE:'yes',HISTORICAL_BACKUP_DIR:path.join(root,'audit/don-santiago-pre-reset/20260916T175923749Z')},maxBuffer:8*1024*1024});
  const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(path.join(output,all?'full-suite.tap':'tests.tap'),log);console.log(log);
  process.exitCode=result.status??1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});

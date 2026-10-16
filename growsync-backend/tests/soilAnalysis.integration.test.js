// Disposable PostgreSQL; injected Storage. No .env, credentials or Supabase calls.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID:uuid}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),express=require('express');
const service=require('../services/soilAnalysis'),schema=require('../validations/soilAnalysis.schema'),permissions=require('../constants/permissions');
let db,pool,server,origin,user,failInsert=false;
const storageCalls=[],logs=[];
const bucket={async upload(path,buffer,options){storageCalls.push({type:'upload',path,bytes:buffer.length,options});return {data:{path},error:null};},async remove(paths){storageCalls.push({type:'remove',paths});return {error:null};},async createSignedUrl(path,seconds){storageCalls.push({type:'sign',path,seconds});return {data:{signedUrl:'https://storage.invalid/'+path+'?temporary=yes'},error:null};}};
const storage={async getBucket(name){return {data:{id:name,public:false},error:null};},from(name){assert.equal(name,'soil-reports');return bucket;}};
const deps=()=>({pool,storage,logger:{error:(...args)=>logs.push(args)}});
before(async()=>{
 db=new PGlite();await db.exec('CREATE ROLE anon;CREATE ROLE authenticated; CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE users(id uuid PRIMARY KEY,company_id uuid);CREATE TABLE lots(id uuid PRIMARY KEY,company_id uuid,name text,enabled boolean DEFAULT true);CREATE TABLE lot_layouts(id uuid PRIMARY KEY,company_id uuid,lot_id uuid,status text);CREATE TABLE sub_lots(id uuid PRIMARY KEY,company_id uuid,lot_id uuid,layout_id uuid,name text,enabled boolean DEFAULT true);');
 await db.exec(fs.readFileSync(require.resolve('../migrations/20261013_soil_analysis.sql'),'utf8'));
 const client={async query(sql,values){if(failInsert&&sql.includes('INSERT INTO soil_reports'))throw Object.assign(new Error('Synthetic DB failure'),{status:500});return db.query(sql,values);},release(){}};pool={...client,connect:async()=>client};
 const app=express();app.use(express.json({limit:'2mb'}));app.use((req,res,next)=>{if(!user)return res.status(401).json({message:'Sesión requerida'});req.user=user;next();});app.use('/api/soil-analysis',require('../routes/soilAnalysis')(deps()));
 app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin='http://127.0.0.1:'+server.address().port+'/api/soil-analysis';
});
after(async()=>{await new Promise(r=>server.close(r));await db.close();});
async function fixture(){
 const companyId=uuid(),actorId=uuid(),lot=uuid(),lot2=uuid(),sub=uuid();await db.query('INSERT INTO companies VALUES($1)',[companyId]);await db.query('INSERT INTO users VALUES($1,$2)',[actorId,companyId]);
 for(const id of [lot,lot2])await db.query("INSERT INTO lots VALUES($1,$2,'Lote sintético',true)",[id,companyId]);const layout=uuid();await db.query("INSERT INTO lot_layouts VALUES($1,$2,$3,'active')",[layout,companyId,lot]);await db.query("INSERT INTO sub_lots VALUES($1,$2,$3,$4,'División sintética',true)",[sub,companyId,lot,layout]);
 const body={report_number:'Synthetic-1',laboratory:'Laboratorio sintético',received_date:'2026-10-01',notes:null,samples:[{lot_id:lot,sub_lot_id:null,sample_date:'2026-09-22',depth_from_cm:'0',depth_to_cm:'20',sample_name:'Muestra sintética',results:[{parameter_name:'pH',raw_value:' 7,1 ',numeric_value:'7,1',result_status:'measured',sort_order:0},{parameter_name:'Zinc',raw_value:'N.R.',numeric_value:null,result_status:'not_requested',sort_order:1}]}]};
 const owner={id:actorId,company_id:companyId,role:2};user=owner;
 const file={buffer:Buffer.from('%PDF-1.7\nsynthetic PDF fixture'),mimetype:'application/pdf',originalname:'../../informe.pdf',size:30};
 const create=(patch={})=>service.create(deps(),{companyId,actorId,body:{...body,...patch},file});
 return {companyId,actorId,lot,lot2,sub,body,owner,file,create};
}
async function request(method,path='',body){return fetch(origin+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});}
async function upload(body,bytes=Buffer.from('%PDF-1.7\nsynthetic'),mime='application/pdf',filename='report.pdf'){
 const form=new FormData();form.append('metadata',JSON.stringify(body));if(bytes!==null)form.append('file',new Blob([bytes],{type:mime}),filename);return fetch(origin,{method:'POST',body:form});
}
async function snapshot(){const out={};for(const table of ['soil_reports','soil_samples','soil_sample_results','lots','sub_lots'])out[table]=(await db.query('SELECT to_jsonb(t)::text value FROM '+table+' t ORDER BY to_jsonb(t)::text')).rows;return out;}
test('create original PDF with measured decimal, exact raw and N.R. creates related rows only',async()=>{
 const x=await fixture(),before=await db.query('SELECT * FROM lots'),r=await x.create();assert.equal(r.samples.length,1);assert.equal(r.samples[0].results[0].raw_value,' 7,1 ');assert.equal(r.samples[0].results[0].numeric_value,'7.100000');assert.equal(r.samples[0].results[1].numeric_value,null);assert.equal(r.original_filename,'informe.pdf');assert.equal(r.storage_path,undefined);
 const uploaded=storageCalls.at(-1);assert.equal(uploaded.path,x.companyId+'/'+r.id+'/report.pdf');assert.equal(uploaded.options.upsert,false);assert.deepEqual((await db.query('SELECT * FROM lots')).rows,before.rows);
});
test('one report accepts several samples with different depths and divisions',async()=>{
 const x=await fixture(),r=await x.create({samples:[x.body.samples[0],{...x.body.samples[0],sub_lot_id:x.sub,depth_from_cm:'20',depth_to_cm:'40',sample_date:'2026-09-23'}]});assert.equal(r.samples.length,2);assert.equal(r.samples[0].sub_lot_id,x.sub);assert.equal(r.samples[0].depth_from_cm,'20.00');
});
test('HTTP list/detail/file URL isolate tenant before accessing Storage',async()=>{
 const x=await fixture(),r=await x.create(),other=await fixture();user=other.owner;const before=storageCalls.length;
 assert.equal((await request('GET','/'+r.id)).status,404);assert.equal((await request('GET','/'+r.id+'/file-url')).status,404);assert.equal((await (await request('GET','?lot_id='+x.lot)).json()).length,0);assert.equal(storageCalls.length,before);
 user=x.owner;const response=await request('GET','/'+r.id+'/file-url');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const data=await response.json();assert.ok(data.url.startsWith('https://storage.invalid/'));assert.ok(Date.parse(data.expires_at)>Date.now());assert.equal(storageCalls.at(-1).seconds,300);assert.equal(storageCalls.at(-1).path,x.companyId+'/'+r.id+'/report.pdf');assert.equal(data.filename,'informe.pdf');assert.deepEqual(Object.keys(data).sort(),['expires_at','filename','url']);
});
for(const kind of ['foreign lot','foreign division','wrong parent'])test('reject '+kind+' before upload',async()=>{
 const x=await fixture(),other=await fixture();const sample={...x.body.samples[0],...(kind==='foreign lot'?{lot_id:other.lot}:kind==='foreign division'?{sub_lot_id:other.sub}:{lot_id:x.lot2,sub_lot_id:x.sub})};const before=await snapshot(),calls=storageCalls.length;await assert.rejects(x.create({samples:[sample]}),e=>e.status===400);assert.deepEqual(await snapshot(),before);assert.equal(storageCalls.length,calls);
});
test('tenant input and arbitrary storage paths are rejected in metadata',async()=>{const x=await fixture();for(const patch of [{company_id:uuid()},{storage_path:'../../evil'},{storage_bucket:'public'}])await assert.rejects(x.create(patch),e=>e.status===400);});
test('depth, numeric status, precision and dates are validated without coercing N.R. into zero',async()=>{
 const x=await fixture();for(const patch of [{depth_from_cm:'-1'},{depth_to_cm:'-1'},{depth_from_cm:'40',depth_to_cm:'20'},{sample_date:'2026-02-30'},{depth_from_cm:'1.234'}])await assert.rejects(x.create({samples:[{...x.body.samples[0],...patch}]}),e=>e.status===400);
 for(const patch of [{numeric_value:'NaN'},{numeric_value:'1.0000001'},{result_status:'not_requested',numeric_value:'0'},{raw_value:''},{parameter_name:''}])await assert.rejects(x.create({samples:[{...x.body.samples[0],results:[{...x.body.samples[0].results[0],...patch}]}]}),e=>e.status===400);
 const qualitative=await x.create({samples:[{...x.body.samples[0],results:[{parameter_name:'Traza',raw_value:'<0,1',numeric_value:null,result_status:'qualitative'}]}]});assert.equal(qualitative.samples[0].results[0].raw_value,'<0,1');assert.equal(qualitative.samples[0].results[0].numeric_value,null);
 const measured=await x.create({samples:[{...x.body.samples[0],results:[{parameter_name:'Lectura',raw_value:'No representable',result_status:'measured'}]}]});assert.equal(measured.samples[0].results[0].numeric_value,null);
});
test('soft disable and restore retain samples/results/PDF and guard disabled reads',async()=>{
 const x=await fixture(),r=await x.create(),before=(await db.query('SELECT * FROM soil_samples WHERE report_id=$1',[r.id])).rows,calls=storageCalls.length;assert.equal((await request('DELETE','/'+r.id)).status,200);
 assert.deepEqual((await db.query('SELECT * FROM soil_samples WHERE report_id=$1',[r.id])).rows,before);assert.equal(storageCalls.length,calls);assert.equal((await (await request('GET','?lot_id='+x.lot)).json()).length,0);
 user={...x.owner,custom_permissions:['soil_analysis.view']};assert.equal((await request('GET','/'+r.id)).status,404);assert.equal((await request('GET','/'+r.id+'/file-url')).status,404);assert.equal((await request('GET','?enabled=false')).status,403);assert.equal((await request('GET','?includeDisabled=true')).status,403);
 user=x.owner;assert.equal((await (await request('GET','?enabled=false&lot_id='+x.lot)).json()).length,1);assert.equal((await request('POST','/'+r.id+'/enable')).status,200);assert.equal((await request('GET','/'+r.id)).status,200);
});
test('list filters a matching sample by lot/sub/date and orders by most recent sample',async()=>{
 const x=await fixture(),older=await x.create(),latest=await x.create({report_number:'Latest',samples:[{...x.body.samples[0],sub_lot_id:x.sub,sample_date:'2026-09-25'},{...x.body.samples[0],lot_id:x.lot2,sample_date:'2026-09-26'}]});
 const list=filters=>service.list(deps(),{companyId:x.companyId,filters});assert.equal((await list({lot_id:x.lot}))[0].id,latest.id);assert.deepEqual((await list({lot_id:x.lot,sub_lot_id:x.sub})).map(r=>r.id),[latest.id]);assert.equal((await list({lot_id:x.lot2})).length,1);assert.deepEqual((await list({lot_id:x.lot,to:'2026-09-22'})).map(r=>r.id),[older.id]);
});
test('editing replaces structured rows atomically without touching PDF and foreign edit is rejected',async()=>{
 const x=await fixture(),r=await x.create(),document=(await db.query('SELECT storage_path,original_filename,file_size FROM soil_reports WHERE id=$1',[r.id])).rows[0],calls=storageCalls.length;
 const response=await request('PUT','/'+r.id,{...x.body,laboratory:'Corrección sintética',samples:[{...x.body.samples[0],depth_from_cm:'20',depth_to_cm:'40'}]});assert.equal(response.status,200);assert.equal(storageCalls.length,calls);assert.deepEqual((await db.query('SELECT storage_path,original_filename,file_size FROM soil_reports WHERE id=$1',[r.id])).rows[0],document);
 const other=await fixture();user=other.owner;assert.equal((await request('PUT','/'+r.id,other.body)).status,404);assert.equal((await request('DELETE','/'+r.id)).status,404);assert.equal((await request('POST','/'+r.id+'/enable')).status,404);
});
test('all endpoint permissions and custom permissions are enforced before upload/signing',async()=>{
 const x=await fixture(),r=await x.create(),calls=storageCalls.length;user={...x.owner,custom_permissions:[]};for(const path of ['', '/'+r.id,'/'+r.id+'/file-url','/lot-context/'+x.lot])assert.equal((await request('GET',path)).status,403);
 assert.equal((await upload(x.body)).status,403);assert.equal((await request('PUT','/'+r.id,x.body)).status,403);assert.equal((await request('DELETE','/'+r.id)).status,403);assert.equal((await request('POST','/'+r.id+'/enable')).status,403);assert.equal(storageCalls.length,calls);
 user={...x.owner,role:1,custom_permissions:undefined};assert.equal((await request('GET','?lot_id='+x.lot)).status,200);assert.equal((await upload(x.body)).status,201);assert.equal((await request('PUT','/'+r.id,x.body)).status,403);
 user={...x.owner,role:0,custom_permissions:['soil_analysis.view']};assert.equal((await request('GET','/lot-context/'+x.lot)).status,200);assert.equal((await request('GET','?lot_id='+x.lot)).status,200);
 user=null;assert.equal((await request('GET')).status,401);
 assert.ok(!permissions.getDefaultPermissionsByRole(0).some(p=>p.startsWith('soil_analysis.')));assert.equal(permissions.getDefaultPermissionsByRole(2).filter(p=>p.startsWith('soil_analysis.')).length,6);
});
for(const [label,bytes,mime] of [['empty',Buffer.alloc(0),'application/pdf'],['not PDF',Buffer.from('%PDF-1.7'),'text/plain'],['magic',Buffer.from('not a PDF'),'application/pdf'],['oversize',Buffer.alloc(service.MAX_BYTES+1,37),'application/pdf'],['missing',null,'application/pdf']])test('multipart rejects '+label+' file without Storage writes',async()=>{
 const x=await fixture(),calls=storageCalls.length,response=await upload(x.body,bytes,mime);assert.ok([400,413].includes(response.status));assert.equal(storageCalls.length,calls);
});
test('DB failure after upload rolls back and compensates Storage; cleanup failure is logged without hiding primary error',async()=>{
 const x=await fixture(),before=await snapshot();failInsert=true;
 try{await assert.rejects(x.create(),/Synthetic DB failure/);assert.equal(storageCalls.at(-1).type,'remove');assert.deepEqual(await snapshot(),before);
  const original=bucket.remove;bucket.remove=async paths=>({error:new Error('Synthetic cleanup failure')});try{await assert.rejects(x.create(),/Synthetic DB failure/);assert.equal(logs.at(-1)[1].message,'Synthetic cleanup failure');}finally{bucket.remove=original;}
 }finally{failInsert=false;}
});
test('bucket must be private and filenames never choose an arbitrary storage path',async()=>{
 const x=await fixture(),original=storage.getBucket;storage.getBucket=async()=>({data:{public:true}});try{await assert.rejects(x.create(),e=>e.status===503);}finally{storage.getBucket=original;}
 x.file.originalname='..\\..\\malicious.pdf';const r=await x.create();assert.equal(r.original_filename,'malicious.pdf');assert.equal(storageCalls.at(-1).path,x.companyId+'/'+r.id+'/report.pdf');
});
test('DB guards tenant boundaries, depth, N.R., immutability and direct browser grants',async()=>{
 const x=await fixture(),r=await x.create(),other=await fixture(),s=r.samples[0];
 for(const [sql,args] of [["UPDATE soil_samples SET lot_id=$2 WHERE id=$1",[s.id,other.lot]],["UPDATE soil_samples SET sub_lot_id=$2 WHERE id=$1",[s.id,other.sub]],["UPDATE soil_samples SET depth_from_cm=-1 WHERE id=$1",[s.id]],["UPDATE soil_sample_results SET numeric_value=0 WHERE sample_id=$1 AND result_status='not_requested'",[s.id]],["UPDATE soil_reports SET storage_path='evil' WHERE id=$1",[r.id]],["UPDATE soil_sample_results SET company_id=$2 WHERE sample_id=$1",[s.id,other.companyId]]])await assert.rejects(db.query(sql,args),e=>e.code==='23514');
 await assert.rejects(db.query("INSERT INTO soil_samples(report_id,company_id,lot_id,sample_date) VALUES($1,$2,$3,'2026-10-01')",[r.id,other.companyId,other.lot]),e=>e.code==='23503');
 await db.exec('SET ROLE anon');try{await assert.rejects(db.query('SELECT * FROM soil_reports'),e=>e.code==='42501');}finally{await db.exec('RESET ROLE');}
});

test('draft divisions remain editable/deletable; historical divisions can receive soil samples',async()=>{
 const x=await fixture(),before=storageCalls.length;
 await db.query("UPDATE lot_layouts SET status='draft' WHERE lot_id=$1",[x.lot]);
 await assert.rejects(x.create({samples:[{...x.body.samples[0],sub_lot_id:x.sub}]}),e=>e.status===400);assert.equal(storageCalls.length,before);
 const context=await service.lotContext(deps(),{companyId:x.companyId,lotId:x.lot});assert.equal(context.lots.find(l=>l.id===x.lot).sub_lots.length,0);
 await db.query("UPDATE lot_layouts SET status='archived' WHERE lot_id=$1",[x.lot]);const report=await x.create({samples:[{...x.body.samples[0],sub_lot_id:x.sub}]});assert.equal(report.samples[0].sub_lot_id,x.sub);
 const draftLayout=uuid(),draftSub=uuid();await db.query("INSERT INTO lot_layouts VALUES($1,$2,$3,'draft')",[draftLayout,x.companyId,x.lot]);await db.query("INSERT INTO sub_lots VALUES($1,$2,$3,$4,'Draft',true)",[draftSub,x.companyId,x.lot,draftLayout]);
 await db.query('DELETE FROM sub_lots WHERE id=$1',[draftSub]);await db.query('DELETE FROM lot_layouts WHERE id=$1',[draftLayout]);
});

test('file URL storage error/missing signature returns 503 without leaking provider data',async()=>{
 const x=await fixture(),r=await x.create(),original=bucket.createSignedUrl;
 try{for(const result of [{data:null,error:new Error('Synthetic object missing')},{data:{},error:null}]){bucket.createSignedUrl=async()=>result;const response=await request('GET','/'+r.id+'/file-url');assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{message:'No pudimos abrir el PDF. Intentá nuevamente.'});}}
 finally{bucket.createSignedUrl=original;}
});

test('global catalog/list work with soil view only, scoped to company; multi-lot report remains intact',async()=>{
 const x=await fixture(),other=await fixture();await other.create();const r=await x.create({samples:[x.body.samples[0],{...x.body.samples[0],lot_id:x.lot2,sample_date:'2026-09-25'}]});user={...x.owner,custom_permissions:['soil_analysis.view']};
 const catalog=await request('GET','/lot-context');assert.equal(catalog.status,200);assert.equal(catalog.headers.get('cache-control'),'no-store');const data=await catalog.json();assert.equal(data.lot,null);assert.deepEqual(data.lots.map(l=>l.id).sort(),[x.lot,x.lot2].sort());assert.ok(data.lots.find(l=>l.id===x.lot).sub_lots.some(d=>d.id===x.sub));
 const all=await (await request('GET')).json();assert.deepEqual(all.map(row=>row.id),[r.id]);assert.deepEqual(all[0].samples.map(s=>s.lot_id).sort(),[x.lot,x.lot2].sort());assert.ok(all[0].samples.every(s=>s.lot_name==='Lote sintético'));
 assert.equal((await (await request('GET','?lot_id='+x.lot2)).json())[0].samples.length,2);
 const contextual=await request('GET','/lot-context/'+x.lot);assert.equal((await contextual.json()).lot.id,x.lot);
 user={...x.owner,custom_permissions:[]};assert.equal((await request('GET','/lot-context')).status,403);
});

test('manual qualitative results including N.R. remain supported without extraction filtering',async()=>{
 const x=await fixture(),values=['N.R.','<0,1','Trazas','Negativo','Positivo','Ausente'];const results=values.map((raw_value,sort_order)=>({parameter_name:'Parámetro '+sort_order,raw_value,numeric_value:null,result_status:'qualitative',sort_order}));
 const report=await x.create({samples:[{...x.body.samples[0],results}]});assert.deepEqual(report.samples[0].results.map(r=>[r.raw_value,r.numeric_value,r.result_status]),values.map(v=>[v,null,'qualitative']));
});

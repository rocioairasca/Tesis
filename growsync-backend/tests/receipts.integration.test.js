// Disposable PostgreSQL + injected Storage. Never imports .env, index.js or Supabase.
const {test,before,after,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID:uuid}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),express=require('express');
const service=require('../services/receipts'),routes=require('../routes/receipts');

let db,pool,server,origin,user,
  queries=[],
  storageCalls=[],
  extractorCalls=[],
  storedDocuments=new Map(),
  failLine=false,
  failStorage=false,
  publicBucket=false;

const storage = {
  async getBucket() {
    return {
      data: {
        public: publicBucket,
      },
    };
  },

  from(name) {
    assert.equal(
      name,
      'receipt-submissions',
    );

    return {
      async upload(
        key,
        buffer,
        options,
      ) {
        storageCalls.push({
          op: 'upload',
          key,
          options,
        });

        if (failStorage) {
          return {
            error: {
              message: 'private error',
            },
          };
        }

        storedDocuments.set(
          key,
          Buffer.from(buffer),
        );

        return {};
      },

      async download(key) {
        storageCalls.push({
          op: 'download',
          key,
        });

        const buffer =
          storedDocuments.get(key);

        if (!buffer) {
          return {
            data: null,
            error: {
              message: 'not found',
            },
          };
        }

        return {
          data: new Blob([
            buffer,
          ]),
          error: null,
        };
      },

      async remove(keys) {
        storageCalls.push({
          op: 'remove',
          keys,
        });

        for (const key of keys) {
          storedDocuments.delete(key);
        }

        return {};
      },

      async createSignedUrl(
        key,
        seconds,
      ) {
        storageCalls.push({
          op: 'sign',
          key,
          seconds,
        });

        return {
          data: {
            signedUrl:
              'https://storage.invalid/' +
              key,
          },
        };
      },
    };
  },
};

const receiptExtractor = async ({
  file,
  signal,
}) => {
  extractorCalls.push({
    mimetype: file.mimetype,
    originalname:
      file.originalname,
    size: file.buffer.length,
    aborted: signal.aborted,
  });

  return {
    supplier_name:
      'Proveedor extraído',
    supplier_tax_id:
      '30-12345678-9',
    document_number:
      '0005-00012023',
    document_date:
      '2026-11-10',
    document_type:
      'Remito',

    lines: [
      {
        raw_description:
          '2.4 D LV ESTER ETIL HEXILICO (Baja volatilidad)',
        quantity: '420',
        unit: 'L',
        presentation: null,
        supplier_batch: null,
        expiration_date: null,
      },
    ],

    warnings: [],
  };
};

before(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE users(id uuid PRIMARY KEY,company_id uuid,full_name text,email text,enabled boolean DEFAULT true);
 CREATE TABLE products(id uuid PRIMARY KEY,company_id uuid,name text,unit text,enabled boolean DEFAULT true,price numeric);
 CREATE TABLE stock_batches(id uuid);CREATE TABLE stock_movements(id uuid);
 CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid,bucket_id text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`);
 await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../migrations/20261114_receipt_submissions.sql'),'utf8'));
 const query=async(sql,args=[])=>{queries.push({sql,args});if(failLine&&sql.includes('INSERT INTO receipt_submission_lines')&&args[2]===2)throw Error('synthetic second line failure');return db.query(sql,args);};
 pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=user;next();});
    app.use(
        '/api/receipts',
        routes({
            pool,
            storage,
            logger: {
            error() {},
            },
            receiptExtractor,
        }),
    );
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({message:error.status?error.message:'Error interno'}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin='http://127.0.0.1:'+server.address().port+'/api/receipts';
});

after(async()=>{await new Promise(r=>server.close(r));await db.close();});
afterEach(async()=>{
    extractorCalls = [];
    storedDocuments.clear();
    failLine=failStorage=publicBucket=false;

    for(const table of ['stock_batches','stock_movements'])
    assert.equal(
      (await db.query(
        'SELECT count(*)::int n FROM '+table
      )).rows[0].n,
      0
    );

  assert.ok(
    !queries.some(q =>
      /stock_batches|stock_movements|inventory_receipts/i.test(q.sql)
    ),
    'module never touches official inventory'
  );
});

async function fixture(company=uuid()){
 await db.query('INSERT INTO companies VALUES($1) ON CONFLICT DO NOTHING',[company]);
 const actor=uuid();await db.query("INSERT INTO users(id,company_id,full_name,email) VALUES($1,$2,'Empleado sintético','test@example.invalid')",[actor,company]);
 const product=uuid();await db.query("INSERT INTO products(id,company_id,name,unit,price) VALUES($1,$2,'Producto de prueba','kg',987654)",[product,company]);
 const capture={id:actor,company_id:company,role:0,custom_permissions:['receipts.capture']};user=capture;
 return {company,actor,product,capture,review:{...capture,custom_permissions:['receipts.review']}};
}
const line={raw_description:'Semilla documental',quantity:'2.123456',unit:'kg',presentation:'Bolsa',supplier_batch:'L1',expiration_date:'2027-04-30'};
async function request(method,path='',body){const res=await fetch(origin+path,{method,headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined});return {status:res.status,data:await res.json().catch(()=>null),headers:res.headers};}
async function create(body={}){const result=await request('POST','',body);assert.equal(result.status,201);return result.data;}
async function lines(id,items=[line]){return request('PUT','/'+id+'/lines',{lines:items});}
async function pending(){const r=await create();assert.equal((await lines(r.id)).status,200);assert.equal((await request('POST','/'+r.id+'/submit',{})).status,200);return r;}
const forbidden=['price','unit_price','subtotal','discount','discounts','tax','taxes','total','currency','acquisition_cost','cost','economics','raw_extraction'];
function noEconomics(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){assert.ok(!forbidden.includes(key),'economic key absent: '+key);noEconomics(item);}}
const headerKeys=['id','company_id','created_by','status','supplier_name','supplier_tax_id','document_number','document_type','source_filename','source_mime_type','source_storage_key','notes','submitted_at','reviewed_at','reviewed_by','rejected_at','rejected_by','rejection_reason','created_at','updated_at','document_date','created_by_name','line_count'];

test(
  'extract reads the private draft document and returns only a proposal',
  async () => {
    const a = await fixture();

    const receipt = await create({
      supplier_name:
        'Proveedor manual',
    });

    const attached =
      await upload(receipt.id);

    assert.equal(
      attached.status,
      200,
    );

    extractorCalls = [];

    const extracted =
      await request(
        'POST',
        '/' +
          receipt.id +
          '/extract',
        {},
      );

    assert.equal(
      extracted.status,
      200,
    );

    assert.equal(
      extractorCalls.length,
      1,
    );

    assert.equal(
      extractorCalls[0].mimetype,
      'application/pdf',
    );

    assert.equal(
      extractorCalls[0].originalname,
      'test.pdf',
    );

    assert.ok(
      extractorCalls[0].size > 0,
    );

    assert.equal(
      extractorCalls[0].aborted,
      false,
    );

    assert.equal(
      extracted.data.supplier_name,
      'Proveedor extraído',
    );

    assert.equal(
      extracted.data.lines.length,
      1,
    );

    assert.equal(
      extracted.data.lines[0]
        .raw_description,
      '2.4 D LV ESTER ETIL HEXILICO (Baja volatilidad)',
    );

    assert.equal(
      extracted.data.lines[0]
        .quantity,
      '420',
    );

    assert.equal(
      extracted.data.lines[0]
        .unit,
      'L',
    );

    /*
     * La extracción es solo una propuesta.
     * No debe modificar el remito.
     */
    const unchanged =
      await request(
        'GET',
        '/' + receipt.id,
      );

    assert.equal(
      unchanged.data.supplier_name,
      'Proveedor manual',
    );

    assert.equal(
      unchanged.data.lines.length,
      0,
    );

    /*
     * La lectura debe haber salido
     * del Storage privado.
     */
    assert.equal(
      storageCalls.filter(
        (call) =>
          call.op === 'download',
      ).length,
      1,
    );

    /*
     * Sigue sin tocar inventario.
     */
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM stock_batches',
        )
      ).rows[0].n,
      0,
    );

    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM stock_movements',
        )
      ).rows[0].n,
      0,
    );

    user = a.capture;
  },
);

test('capture alone creates/edits draft and receives the exact operational DTO',async()=>{
 const x=await fixture(),r=await create({supplier_name:'Proveedor',document_number:'R-1',document_date:'2026-11-14'});
 assert.equal(r.status,'draft');assert.equal(r.created_by,x.actor);assert.deepEqual(Object.keys(r).sort(),[...headerKeys,'lines','warnings'].sort());noEconomics(r);
 assert.equal((await request('PATCH','/'+r.id,{notes:'Nota'})).status,200);const saved=await lines(r.id);assert.equal(saved.status,200);assert.equal(saved.data.lines[0].quantity,'2.123456');
 assert.deepEqual(Object.keys(saved.data.lines[0]).sort(),['id','receipt_id','line_number','raw_description','quantity','unit','presentation','supplier_batch','expiration_date','matched_product_id','match_status','matched_product_name','created_at','updated_at'].sort());
 assert.equal(saved.data.lines[0].matched_product_id,null);
});
test('mine contains only own records in every state; capture cannot access a coworker',async()=>{
 const a=await fixture(),r=await pending(),b=await fixture(a.company),other=await create();
 for(const [method,path,body] of [['GET','/'+r.id],['PATCH','/'+r.id,{notes:'x'}],['PUT','/'+r.id+'/lines',{lines:[]}],['POST','/'+r.id+'/submit',{}],['GET','/'+r.id+'/document-url']])assert.equal((await request(method,path,body)).status,404);
 const mine=(await request('GET','/mine')).data;assert.deepEqual(mine.data.map(x=>x.id),[other.id]);
 user=a.capture;assert.equal((await request('GET','/mine')).data.data[0].status,'pending_validation');assert.equal((await request('GET','/'+other.id)).status,404);
});

test('all read/write/review/file paths isolate companies, including product matches',async()=>{
 storageCalls=[];

 const a=await fixture(),r=await pending(),b=await fixture();user=b.review;

 for(const [method,path,body] of [
  ['GET','/'+r.id],
  ['PATCH','/'+r.id,{notes:'foreign'}],
  ['PUT','/'+r.id+'/lines',{lines:[line]}],
  ['POST','/'+r.id+'/reject',{reason:'foreign'}],
  ['GET','/'+r.id+'/document-url']
 ])assert.equal((await request(method,path,body)).status,404);

 assert.equal((await request('GET','/review')).data.total_count,0);

 user=b.capture;

 assert.equal((await request('POST','/'+r.id+'/submit',{})).status,404);

 const own=await create();

 assert.equal(
  (await lines(
   own.id,
   [{...line,matched_product_id:a.product}]
  )).status,
  400
 );

 assert.equal(storageCalls.length,0);
});

test('economic data is not selected for capture, mine or reviewer without view_economics',async()=>{
 const a=await fixture(),r=await create();

 await db.query(
  "INSERT INTO receipt_submission_economics(receipt_id,company_id,currency,total,raw_extraction) VALUES($1,$2,'USD',987654,$3)",
  [
   r.id,
   a.company,
   JSON.stringify({secret:true})
  ]
 );

 for(const permissions of [
  ['receipts.capture'],
  ['receipts.capture','receipts.view_economics'],
  ['receipts.review']
 ]){
  user={
   ...a.capture,
   custom_permissions:permissions
  };

  queries=[];

  const read=await request(
   'GET',
   '/'+r.id+'?include_economics=true'
  );

  const list=await request(
   'GET',
   permissions.includes('receipts.review')
    ?'/review'
    :'/mine'
  );

  assert.equal(read.status,200);

  noEconomics(read.data);
  noEconomics(list.data);

  assert.ok(
   !JSON.stringify(read.data).includes('987654')
  );

  assert.ok(
   !queries.some(q=>
    /receipt_submission_economics|\bprice\b|raw_extraction/i.test(q.sql)
   )
  );

  assert.ok(
   !queries.some(q=>
    /SELECT\s+(?:\w+\.)?\*/i.test(q.sql)
   )
  );
 }

 user={
  ...a.review,
  custom_permissions:[
   'receipts.review',
   'receipts.view_economics'
  ]
 };

 queries=[];

 const data=(
  await request(
   'GET',
   '/'+r.id
  )
 ).data;

 assert.equal(
  data.economics.total,
  '987654'
 );

 assert.equal(
  data.economics.currency,
  'USD'
 );

 assert.equal(
  data.economics.raw_extraction,
  undefined
 );

 assert.equal(
  queries.filter(q=>
   q.sql.includes('receipt_submission_economics')
  ).length,
  1
 );
});

test('economic input and server-owned fields rejected with 400 at every operational level',async()=>{
 const a=await fixture(),r=await create();
 for(const key of [...forbidden,'company_id','created_by','status','source_storage_key','source_filename','source_mime_type']){
  for(const [method,path,body] of [['POST','',{[key]:'SENSITIVE'}],['PATCH','/'+r.id,{[key]:'SENSITIVE'}],['PUT','/'+r.id+'/lines',{lines:[{...line,[key]:'SENSITIVE'}]}]]){
   const result=await request(method,path,body);assert.equal(result.status,400,key);assert.ok(!JSON.stringify(result.data).includes('SENSITIVE'));
  }
 }
 assert.equal((await request('PUT','/'+r.id+'/lines',{lines:[line],economics:{total:1}})).status,400);
 user=a.review;assert.equal((await request('PATCH','/'+r.id,{total:1})).status,400);
});

test('submit locks capture editing; reviewer can correct and reject without deleting',async()=>{
 const a=await fixture(),r=await create();assert.equal((await request('POST','/'+r.id+'/submit',{})).status,400);
 await lines(r.id);const sent=await request('POST','/'+r.id+'/submit',{});assert.equal(sent.data.status,'pending_validation');assert.ok(sent.data.submitted_at);
 for(const [method,path,body] of [['PATCH','/'+r.id,{notes:'x'}],['PUT','/'+r.id+'/lines',{lines:[line]}],['POST','/'+r.id+'/submit',{}]])assert.equal((await request(method,path,body)).status,409);
 user=a.review;assert.equal((await request('GET','/review?status=pending_validation')).data.total_count,1);
 const patch=await request('PATCH','/'+r.id,{supplier_name:'Corregido'});assert.equal(patch.status,200);assert.equal(patch.data.reviewed_by,a.actor);assert.ok(patch.data.reviewed_at);
 assert.equal((await lines(r.id,[{...line,quantity:'3'}])).status,200);
 assert.equal((await request('POST','/'+r.id+'/reject',{reason:' '})).status,400);
 const rejected=await request('POST','/'+r.id+'/reject',{reason:'Documento ilegible'});assert.equal(rejected.data.status,'rejected');assert.equal(rejected.data.rejection_reason,'Documento ilegible');assert.equal(rejected.data.rejected_by,a.actor);assert.ok(rejected.data.rejected_at);assert.equal(rejected.data.lines.length,1);
 assert.equal((await request('PATCH','/'+r.id,{notes:'no'})).status,409);user=a.capture;assert.equal((await request('GET','/'+r.id)).data.status,'rejected');assert.equal((await request('POST','/'+r.id+'/submit',{})).status,409);
});

test('permissions all/custom and absent tenant; no approval endpoint even for approvers',async()=>{
 const a=await fixture(),r=await pending();
 assert.equal((await request('GET','/review')).status,403);assert.equal((await request('POST','/'+r.id+'/reject',{reason:'no'})).status,403);
 for(const permissions of [[],['receipts.approve'],['receipts.view_economics'],['inventory.edit']]){
  user={...a.capture,role:3,custom_permissions:permissions};assert.equal((await request('GET','/'+r.id)).status,403);assert.equal((await request('POST','',{})).status,403);
 }
 for(const permissions of [['receipts.capture'],['receipts.approve'],['all']]){user={...a.capture,custom_permissions:permissions};assert.equal((await request('POST','/'+r.id+'/approve',{})).status,404);}
 user={...a.capture,custom_permissions:['all']};assert.equal((await request('GET','/review')).status,200);
 user={...a.capture,company_id:null};assert.equal((await request('GET','/mine')).status,403);
});

test('safe product lookup requires no inventory.view and never selects prices',async()=>{
 const a=await fixture(),b=await fixture();user=a.capture;queries=[];
 const result=await request('GET','/products?search=Producto');assert.equal(result.status,200);assert.deepEqual(result.data.map(p=>p.id),[a.product]);assert.deepEqual(Object.keys(result.data[0]).sort(),['id','name','unit']);noEconomics(result.data);assert.ok(!queries.some(q=>q.sql.includes('price')));
});

test('line replacement rolls back entirely on second insert failure and validates quantity/unit/date/match',async()=>{
 const a=await fixture(),r=await create();await lines(r.id);const before=(await request('GET','/'+r.id)).data.lines;
 for(const patch of [{quantity:0},{quantity:-1},{quantity:'1.1234567'},{unit:'invalid'},{expiration_date:'2026-02-30'},{unit:'L',matched_product_id:a.product}])assert.equal((await lines(r.id,[{...line,...patch}])).status,400);
 failLine=true;assert.equal((await lines(r.id,[line,{...line,raw_description:'Segunda'}])).status,500);failLine=false;
 assert.deepEqual((await request('GET','/'+r.id)).data.lines,before);
 const matched=await lines(r.id,[{...line,matched_product_id:a.product}]);assert.equal(matched.status,200);assert.equal(matched.data.lines[0].match_status,'proposed');assert.equal(matched.data.lines[0].matched_product_name,'Producto de prueba');assert.equal(matched.data.lines[0].raw_description,'Semilla documental');
 assert.equal((await lines(r.id,[{raw_description:'Sin cantidad',quantity:null,unit:null}])).status,200);
});

test('duplicate warning includes supplier and tenant, never leaks IDs or blocks different suppliers',async()=>{
 const a=await fixture();await create({supplier_name:'Proveedor A',document_number:'1'});
 const duplicate=await create({supplier_name:' proveedor a ',document_number:'1'});assert.equal(duplicate.warnings[0].code,'possible_duplicate');assert.deepEqual(Object.keys(duplicate.warnings[0]).sort(),['code','message']);
 assert.equal((await create({supplier_name:'Proveedor B',document_number:'1'})).warnings.length,0);
 await fixture();assert.equal((await create({supplier_name:'Proveedor A',document_number:'1'})).warnings.length,0);
});

async function upload(id,bytes='%PDF-1.7 synthetic',type='application/pdf'){
 const body=new FormData();body.append('file',new Blob([bytes],{type}),'test.pdf');const response=await fetch(origin+'/'+id+'/document',{method:'PUT',body});return {status:response.status,data:await response.json()};
}

test('private documents enforce ownership/state/tenant, validate bytes and compensate failed upload',async()=>{
 const a=await fixture(),r=await create();storageCalls=[];
 const stranger=await fixture(a.company);assert.equal((await upload(r.id)).status,404);assert.equal(storageCalls.length,0);user=a.capture;
 assert.equal((await upload(r.id,'not pdf')).status,400);publicBucket=true;assert.equal((await upload(r.id)).status,503);publicBucket=false;
 failStorage=true;assert.equal((await upload(r.id)).status,503);failStorage=false;assert.equal(storageCalls.at(-1).op,'remove');assert.equal((await request('GET','/'+r.id)).data.source_storage_key,null);
 const attached=await upload(r.id);assert.equal(attached.status,200);assert.ok(attached.data.source_storage_key.startsWith(a.company+'/'+r.id+'/'));noEconomics(attached.data);
 assert.equal((await request('GET','/'+r.id+'/document-url')).status,200);assert.equal(storageCalls.at(-1).seconds,60);
 await lines(r.id);await request('POST','/'+r.id+'/submit',{});assert.equal((await upload(r.id)).status,409);
 await fixture();const count=storageCalls.length;assert.equal((await request('GET','/'+r.id+'/document-url')).status,404);assert.equal((await upload(r.id)).status,404);assert.equal(storageCalls.length,count);
});

test('migration denies direct API roles including economics and private Storage',async()=>{
 for(const role of ['anon','authenticated']){
  for(const table of ['receipt_submissions','receipt_submission_lines','receipt_submission_economics']){
   assert.equal((await db.query('SELECT has_table_privilege($1,$2,\'SELECT\') allowed',[role,table])).rows[0].allowed,false);
   assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE relname=$1',[table])).rows[0].relrowsecurity,true);
  }
 }
 assert.equal((await db.query("SELECT public FROM storage.buckets WHERE id='receipt-submissions'")).rows[0].public,false);
 assert.equal((await db.query("SELECT permissive FROM pg_policies WHERE policyname='receipt_documents_server_only'")).rows[0].permissive,'RESTRICTIVE');
});

test('review filters are tenant-scoped and duplicate warnings ignore rejected documents',async()=>{
 const a=await fixture(),r=await create({supplier_tax_id:'30-123',supplier_name:'Proveedor',document_number:'10',document_date:'2026-11-14'});
 await lines(r.id);await request('POST','/'+r.id+'/submit',{});user=a.review;
 assert.equal((await request('GET','/review?document_date=2026-11-14&supplier_name=PROVEEDOR&status=pending_validation')).data.total_count,1);
 assert.equal((await request('GET','/review?document_date=2026-11-13')).data.total_count,0);
 assert.equal((await request('GET','/review?supplier_name=Otro')).data.total_count,0);
 await request('POST','/'+r.id+'/reject',{reason:'Duplicado documental'});user=a.capture;
 assert.equal((await create({supplier_tax_id:'30-123',supplier_name:'Proveedor renombrado',document_number:'10'})).warnings.length,0);
 assert.equal((await create({supplier_tax_id:'30-123',supplier_name:'Otra variante',document_number:'10'})).warnings.length,1);
 assert.equal((await create({supplier_tax_id:'30-456',supplier_name:'Otra variante',document_number:'10'})).warnings.length,0);
});
test('storage policy blocks the new bucket even when an older policy permits authenticated reads',async()=>{
 await db.exec("GRANT USAGE ON SCHEMA storage TO authenticated;GRANT SELECT ON storage.objects TO authenticated;CREATE POLICY synthetic_permissive ON storage.objects FOR SELECT TO authenticated USING(true);");
 await db.query("INSERT INTO storage.objects VALUES($1,'receipt-submissions'),($2,'unrelated-bucket')",[uuid(),uuid()]);
 try{await db.exec('SET ROLE authenticated');assert.deepEqual((await db.query('SELECT bucket_id FROM storage.objects')).rows,[{bucket_id:'unrelated-bucket'}]);}
 finally{await db.exec('RESET ROLE');}
});


test('extract does not call the provider when disconnected during document download', async (t) => {
  const { EventEmitter } = require('node:events');
  const documents = require('../services/receiptDocuments');
  let finishDownload;
  t.mock.method(documents, 'readForExtraction', () => new Promise(resolve => {
    finishDownload = resolve;
  }));
  const extract = t.mock.fn(async () => ({}));
  const router = routes({ receiptExtractor: extract });
  const handler = router.stack.find(layer => layer.route?.path === '/:id/extract')
    .route.stack.at(-1).handle;
  const response = new EventEmitter();
  response.writableEnded = false;
  response.json = t.mock.fn();
  const next = t.mock.fn();
  const pending = handler({ body: {}, params: { id: uuid() }, user: {} }, response, next);

  // The connection closes while Storage is still pending, before AI starts.
  response.emit('close');
  finishDownload({ buffer: Buffer.from('%PDF-1.7 synthetic'), mimetype: 'application/pdf' });
  await pending;

  assert.equal(extract.mock.callCount(), 0);
  assert.equal(response.json.mock.callCount(), 0);
  assert.equal(next.mock.callCount(), 0);
  assert.equal(response.listenerCount('close'), 0);
});

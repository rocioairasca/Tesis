const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./publicRegistration.fixture');

async function counts(f, expected) {
  for (const table of ['companies','users']) {
    assert.equal(Number((await f.db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),expected,table);
  }
}

test('default, false-like values and production reject every simulated endpoint and registration',async t=>{
  const env = {};
  const f = await fixture(t,env);
  const id = randomUUID();
  await f.db.query(`INSERT INTO payments(id,plan,amount,payment_method,transaction_number,status)
    VALUES($1,'basic',20000,'qr','legacy-approved','approved')`,[id]);
  for(const mode of [{}, {NODE_ENV:'test'}, {NODE_ENV:'test',ALLOW_SIMULATED_PAYMENTS:'TRUE'},
    {NODE_ENV:'test',ALLOW_SIMULATED_PAYMENTS:'1'}, {NODE_ENV:'test',ALLOW_SIMULATED_PAYMENTS:'false'},
    {NODE_ENV:'test',ALLOW_SIMULATED_PAYMENTS:'true '}, {ALLOW_SIMULATED_PAYMENTS:'true'},
    {NODE_ENV:'production',ALLOW_SIMULATED_PAYMENTS:'true'}]) {
    delete env.NODE_ENV; delete env.ALLOW_SIMULATED_PAYMENTS; Object.assign(env,mode);
    assert.equal((await f.request('POST','/api/public/payments',{plan:'basic',payment_method:'qr'})).status,403);
    assert.equal((await f.request('POST',`/api/public/payments/${id}/confirm`,{})).status,403);
    assert.equal((await f.request('GET',`/api/public/payments/${id}`)).status,403);
    assert.equal((await f.register({paymentId:id})).status,403);
  }
  await counts(f,0); assert.equal(f.calls.auth.length,0);
  assert.equal(Number((await f.db.query('SELECT count(*) n FROM payments')).rows[0].n),1);
});

test('explicit test simulation supports create/confirm/read/register, only once',async t=>{
  const f = await fixture(t,{NODE_ENV:'test',ALLOW_SIMULATED_PAYMENTS:'true'});
  const created = await f.request('POST','/api/public/payments',{plan:'professional',payment_method:'card',amount:1});
  assert.equal(created.status,201); const id = created.data.payment.id;
  assert.equal(created.data.payment.amount,'45000.00');
  assert.equal((await f.register({paymentId:id})).status,402);
  assert.equal((await f.request('POST',`/api/public/payments/${id}/confirm`,{})).status,200);
  assert.equal((await f.request('GET',`/api/public/payments/${id}`)).data.payment.status,'approved');
  assert.equal((await f.register({paymentId:id})).status,201);
  assert.equal((await f.register({paymentId:id})).status,409);
  await counts(f,1); assert.equal(f.calls.auth.length,2);
});

test('server preference records trusted plan/amount/currency; valid real payment registers once',async t=>{
  const f = await fixture(t);
  const {reference} = await f.approved();
  const intent = (await f.db.query('SELECT * FROM company_registration_payments WHERE reference=$1',[reference])).rows[0];
  assert.equal(intent.plan,'basic'); assert.equal(Number(intent.amount),20000); assert.equal(intent.currency,'ARS');
  assert.equal(f.calls.preferences[0].items[0].unit_price,20000);
  const first = await f.register({mercadoPagoExternalReference:reference,plan:'professional',amount:1,currency:'USD'});
  assert.equal(first.status,201);
  assert.equal((await f.register({mercadoPagoExternalReference:reference})).status,409);
  await counts(f,1);
  const used = (await f.db.query('SELECT * FROM company_registration_payments WHERE reference=$1',[reference])).rows[0];
  assert.equal(used.company_id,first.data.company.id); assert.ok(used.consumed_at);
  assert.equal((await f.db.query('SELECT role FROM users')).rows[0].role,3);
  assert.equal(Number((await f.db.query('SELECT count(*) n FROM crops')).rows[0].n),5);
});

test('invalid, unapproved, sandbox, refunded or incoherent real payments cannot create any admin',async t=>{
  const f = await fixture(t);
  assert.equal((await f.register({mercadoPagoExternalReference:randomUUID()})).status,403);
  assert.equal((await f.register({})).status,402);
  for(const patch of [{status:'pending'}, {status:'rejected'}, {status:'refunded'}, {live_mode:false},
    {live_mode:undefined}, {metadata:{plan:'professional'}}, {metadata:{}}, {transaction_amount:1},
    {currency_id:'USD'}, {transaction_amount_refunded:1}]) {
    const {reference} = await f.approved(patch);
    assert.equal((await f.register({mercadoPagoExternalReference:reference})).status,402,JSON.stringify(patch));
  }
  // Even if search returns a stale/incorrect approved result, the full payment is verified again.
  const {reference,payment} = await f.approved();
  for(const patch of [{status:'pending'}, {external_reference:randomUUID()}, {id:'unrelated'}]) {
    f.faults.get = async()=>({...payment,...patch});
    assert.equal((await f.register({mercadoPagoExternalReference:reference})).status,402);
  }
  await counts(f,0); assert.equal(f.calls.auth.length,0);
});

test('two simultaneous real registrations consume a reference at most once',async t=>{
  const f = await fixture(t);
  const {reference} = await f.approved();
  let entered=0, release;
  const barrier = new Promise(resolve=>{release=resolve;});
  f.faults.get = async({id})=>{ if(++entered===2) release(); await barrier; return f.remote.get(String(id)); };
  const results = await Promise.all([f.register({mercadoPagoExternalReference:reference}),f.register({mercadoPagoExternalReference:reference})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  await counts(f,1); assert.equal(f.calls.auth.length,2);
});

test('a consumed provider payment ID cannot be reused under a different reference',async t=>{
  const f = await fixture(t);
  const a = await f.approved(), b = await f.approved();
  assert.equal((await f.register({mercadoPagoExternalReference:a.reference})).status,201);
  f.faults.search = async()=>({results:[{...a.payment,external_reference:b.reference}]});
  f.faults.get = async()=>({...a.payment,external_reference:b.reference});
  assert.equal((await f.register({mercadoPagoExternalReference:b.reference})).status,409);
  await counts(f,1); assert.equal(f.calls.auth.length,2);
  assert.equal((await f.db.query('SELECT company_id FROM company_registration_payments WHERE reference=$1',[b.reference])).rows[0].company_id,null);
});

test('Auth0 failure rolls back company, crops, user and payment consumption',async t=>{
  const f = await fixture(t); const {reference} = await f.approved();
  f.faults.auth = async()=>{throw Error('synthetic provider failure');};
  assert.equal((await f.register({mercadoPagoExternalReference:reference})).status,500);
  await counts(f,0);
  const intent = (await f.db.query('SELECT * FROM company_registration_payments WHERE reference=$1',[reference])).rows[0];
  assert.equal(intent.company_id,null); assert.equal(intent.provider_payment_id,null);
  assert.equal(Number((await f.db.query('SELECT count(*) n FROM crops')).rows[0].n),0);
  delete f.faults.auth;
  assert.equal((await f.register({mercadoPagoExternalReference:reference})).status,201);
});

test('direct controllers also deny simulation without opt-in',async t=>{
  const f = await fixture(t);
  for(const controller of Object.values(f.payments)) {
    const res = {status(code){this.code=code;return this;},json(){return this;}};
    await controller({body:{plan:'basic'},params:{id:randomUUID()}},res);
    assert.equal(res.code,403);
  }
  await counts(f,0);
});


test('SQL failure after Auth0 creation rolls back local company/user/consumption',async t=>{
  const f = await fixture(t); const {reference} = await f.approved();
  await f.db.exec(`CREATE FUNCTION fail_registration_user() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic insert failure'; END $$;
    CREATE TRIGGER fail_registration_user BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION fail_registration_user();`);
  assert.equal((await f.register({mercadoPagoExternalReference:reference})).status,500);
  await counts(f,0);
  const intent = (await f.db.query('SELECT * FROM company_registration_payments WHERE reference=$1',[reference])).rows[0];
  assert.equal(intent.company_id,null); assert.equal(intent.consumed_at,null);
  assert.equal(f.calls.auth.length,2); // External Auth0 creation cannot be rolled back by SQL.
});

test('payment ledger denies direct anon/authenticated access and retains consumed payments',async t=>{
  const f = await fixture(t); const {reference} = await f.approved();
  const registered = await f.register({mercadoPagoExternalReference:reference});
  assert.equal(registered.status,201);
  const client = await f.pool.connect();
  try {
    for(const role of ['anon','authenticated']) {
      for(const sql of ['SELECT * FROM public.company_registration_payments',
        "INSERT INTO public.company_registration_payments(provider,reference,plan,amount,currency) VALUES('simulated',gen_random_uuid(),'basic',20000,'ARS')",
        'DELETE FROM public.company_registration_payments',
        "UPDATE public.company_registration_payments SET company_id=NULL,consumed_at=NULL"]) {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(client.query(sql),e=>e.code==='42501');
        await client.query('ROLLBACK');
      }
    }
  } finally { client.release(); }
  // No deletion/cascade of a company can silently make its payment available again.
  await f.db.query('DELETE FROM users WHERE company_id=$1',[registered.data.company.id]);
  await f.db.query('DELETE FROM crops WHERE company_id=$1',[registered.data.company.id]);
  await assert.rejects(f.db.query('DELETE FROM companies WHERE id=$1',[registered.data.company.id]),
    e=>['23001','23503'].includes(e.code) && e.constraint==='company_registration_payments_company_fk');
});


test('PostgreSQL constraints reject duplicate reference/payment IDs and inconsistent consumption directly',async t=>{
  const f = await fixture(t);
  const a = await f.approved(), b = await f.approved();
  const first = await f.register({mercadoPagoExternalReference:a.reference});
  assert.equal(first.status,201);
  const used = (await f.db.query('SELECT * FROM public.company_registration_payments WHERE reference=$1',[a.reference])).rows[0];
  await assert.rejects(f.db.query(`INSERT INTO public.company_registration_payments
    (provider,reference,preference_id,plan,amount,currency,registration_token_hash) VALUES('mercadopago',$1,'other','basic',20000,'ARS',repeat('0',64))`,[a.reference]),
  e=>e.code==='23505' && e.constraint==='company_registration_payments_provider_reference_pk');
  await assert.rejects(f.db.query(`UPDATE public.company_registration_payments SET provider_payment_id=$2 WHERE reference=$1`,
    [b.reference,used.provider_payment_id]),
  e=>e.code==='23505' && e.constraint==='company_registration_payments_provider_payment_key');
  for(const sql of [
    'UPDATE public.company_registration_payments SET consumed_at=now() WHERE reference=$1',
    `UPDATE public.company_registration_payments SET company_id='${first.data.company.id}' WHERE reference=$1`,
  ]) {
    await assert.rejects(f.db.query(sql,[b.reference]),
      e=>e.code==='23514' && e.constraint==='company_registration_payments_consumption_check');
  }
  assert.equal((await f.db.query('SELECT company_id FROM public.company_registration_payments WHERE reference=$1',[b.reference])).rows[0].company_id,null);
});

test('RLS and ACLs survive broad Supabase defaults and allow only necessary server privileges',async t=>{
  const f = await fixture(t);
  const security = (await f.db.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.company_registration_payments'::regclass`)).rows[0];
  assert.equal(security.relrowsecurity,true);
  assert.equal(Number((await f.db.query(`SELECT count(*) n FROM pg_policy WHERE polrelid='public.company_registration_payments'::regclass`)).rows[0].n),0);
  for(const role of ['anon','authenticated','service_role']) {
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
      const {rows:[result]} = await f.db.query("SELECT has_table_privilege($1,'public.company_registration_payments',$2) allowed",[role,privilege]);
      assert.equal(result.allowed,role==='service_role' && ['SELECT','INSERT','UPDATE'].includes(privilege),role+': '+privilege);
    }
  }
  const client = await f.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE service_role');
    const reference = randomUUID();
    await client.query(`INSERT INTO public.company_registration_payments(provider,reference,plan,amount,currency,registration_token_hash)
      VALUES('simulated',$1,'basic',20000,'ARS',repeat('0',64))`,[reference]);
    await client.query('UPDATE public.company_registration_payments SET provider_payment_id=$2 WHERE reference=$1',[reference,randomUUID()]);
    assert.equal((await client.query('SELECT * FROM public.company_registration_payments WHERE reference=$1',[reference])).rows.length,1);
    await client.query('ROLLBACK');
  } finally { client.release(); }
});

test('failure after consumption update rolls back consumption, company, admin and seeds together',async t=>{
  const f = await fixture(t); const {reference} = await f.approved();
  await f.db.exec(`CREATE FUNCTION fail_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.company_id IS NOT NULL THEN RAISE EXCEPTION 'synthetic consumption failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_consumption AFTER UPDATE ON public.company_registration_payments
      FOR EACH ROW EXECUTE FUNCTION fail_consumption();`);
  assert.equal((await f.register({mercadoPagoExternalReference:reference})).status,500);
  await counts(f,0);
  assert.equal(Number((await f.db.query('SELECT count(*) n FROM crops')).rows[0].n),0);
  const row = (await f.db.query('SELECT * FROM public.company_registration_payments WHERE reference=$1',[reference])).rows[0];
  assert.equal(row.company_id,null); assert.equal(row.consumed_at,null); assert.equal(row.provider_payment_id,null);
});

test('public payment responses and stored audit data exclude provider secrets and full payloads',async t=>{
  const f = await fixture(t);
  const secret = 'NEVER_EXPOSE_PROVIDER_SECRET';
  const {reference,payment} = await f.approved({
    access_token:secret, payer:{email:secret}, card:{cardholder:{name:secret}},
    raw_payload:secret, metadata:{plan:'basic',private_token:secret},
  });
  const detail = await f.request('GET','/payment/'+payment.id);
  const byReference = await f.request('GET','/reference/'+reference);
  const registered = await f.register({mercadoPagoExternalReference:reference});
  assert.equal(registered.status,201);
  const expected = ['id','status','externalReference','amount','currency','plan'];
  assert.deepEqual(Object.keys(detail.data.payment).sort(),expected.sort());
  assert.deepEqual(Object.keys(byReference.data.payment).sort(),expected.sort());
  assert.deepEqual(Object.keys(registered.data).sort(),['company','message']);
  const rows = (await f.db.query('SELECT * FROM public.company_registration_payments')).rows;
  assert.deepEqual(Object.keys(rows[0]).sort(),[
    'provider','reference','preference_id','registration_token_hash','plan','amount','currency','provider_payment_id','company_id','consumed_at','created_at',
  ].sort());
  assert.equal(JSON.stringify({detail,byReference,registered,rows}).includes(secret),false);
  for(const response of [detail,byReference,registered]) {
    const serialized = JSON.stringify(response.data);
    for(const key of ['provider_payment_id','consumed_at','access_token','raw_payload','private_token']) assert.equal(serialized.includes(key),false,key);
  }
});


test('private intent returns a random secret once; only canonical SHA-256 is stored and nothing is sent/logged to provider',async t=>{
  const {createHash} = require('node:crypto');
  const f = await fixture(t);
  const a = await f.approved(), b = await f.approved();
  assert.match(a.registrationToken,/^[0-9a-f]{64}$/);
  assert.notEqual(a.registrationToken,b.registrationToken);
  const stored = (await f.db.query('SELECT * FROM public.company_registration_payments WHERE reference=$1',[a.reference])).rows[0];
  assert.equal(stored.registration_token_hash,createHash('sha256').update(a.registrationToken).digest('hex'));
  assert.equal(JSON.stringify(stored).includes(a.registrationToken),false);
  assert.equal(JSON.stringify(f.calls).includes(a.registrationToken),false);
  assert.equal(JSON.stringify(a.initial.preference).includes(a.registrationToken),false);
  for(const route of ['/reference/'+a.reference,'/payment/'+a.payment.id]) {
    const response = await f.request('GET',route);
    assert.equal(response.status,200);
    assert.equal(JSON.stringify(response).includes(a.registrationToken),false);
    assert.equal(JSON.stringify(response).includes('registration_token_hash'),false);
  }
  for(const invalid of [null,'','a'.repeat(63),'A'.repeat(64),'z'.repeat(64)]) {
    await assert.rejects(f.db.query('UPDATE public.company_registration_payments SET registration_token_hash=$2 WHERE reference=$1',[a.reference,invalid]),
      e=>e.code==='23502' || (e.code==='23514' && e.constraint==='company_registration_payments_token_hash_check'));
  }
});

test('reference or payment ID alone cannot disclose payment information or authorize company registration',async t=>{
  const f = await fixture(t); const a = await f.approved(), b = await f.approved();
  const attempts = [ {}, {'X-Registration-Token':'f'.repeat(64)}, {'X-Registration-Token':'short'},
    {'X-Registration-Token':b.registrationToken} ];
  for(const headers of attempts) {
    for(const route of ['/reference/'+a.reference,'/payment/'+a.payment.id]) {
      const response = await f.request('GET',route,undefined,{...headers,'X-Registration-Reference':a.reference});
      assert.equal(response.status,403);
      for(const value of [a.reference,a.payment.id,'externalReference','plan','amount']) assert.equal(JSON.stringify(response.data).includes(value),false);
    }
    assert.equal((await f.register({mercadoPagoExternalReference:a.reference},headers)).status,403);
  }
  const validHeaders = {'X-Registration-Token':a.registrationToken,'X-Registration-Reference':a.reference};
  assert.equal((await f.request('GET','/reference/'+b.reference,undefined,validHeaders)).status,403);
  assert.equal((await f.register({mercadoPagoExternalReference:b.reference},validHeaders)).status,403);
  assert.equal(f.calls.search.length,0); assert.equal(f.calls.get.length,0); assert.equal(f.calls.auth.length,0);
  // A legitimate intent cannot authorize a payment belonging to another reference either.
  assert.equal((await f.request('GET','/payment/'+b.payment.id,undefined,validHeaders)).status,403);
  await counts(f,0);
  assert.equal((await f.register({mercadoPagoExternalReference:a.reference},validHeaders)).status,201);
  assert.equal((await f.register({mercadoPagoExternalReference:a.reference},validHeaders)).status,409);
  assert.equal((await f.request('GET','/reference/'+a.reference,undefined,validHeaders)).status,409);
  await counts(f,1);
});

test('simulated creation/confirmation/read/redemption use the same private intent and never expose its hash',async t=>{
  const f = await fixture(t,{NODE_ENV:'test',ALLOW_SIMULATED_PAYMENTS:'true'});
  const created = await f.request('POST','/api/public/payments',{plan:'basic',payment_method:'qr'});
  assert.equal(created.status,201);
  const id = created.data.payment.id, token = created.data.registrationToken;
  assert.match(token,/^[0-9a-f]{64}$/);
  for(const headers of [{},{'X-Registration-Token':'0'.repeat(64)}]) {
    assert.equal((await f.request('GET',`/api/public/payments/${id}`,undefined,headers)).status,403);
    assert.equal((await f.request('POST',`/api/public/payments/${id}/confirm`,{},headers)).status,403);
    assert.equal((await f.register({paymentId:id},headers)).status,403);
  }
  const confirmed = await f.request('POST',`/api/public/payments/${id}/confirm`,{});
  assert.equal(confirmed.status,200);
  assert.equal(JSON.stringify(confirmed).includes(token),false);
  const rows = (await f.db.query('SELECT * FROM public.company_registration_payments')).rows;
  assert.equal(JSON.stringify(rows).includes(token),false);
  assert.equal(JSON.stringify(f.calls.logs).includes(token),false);
  const results = await Promise.all([f.register({paymentId:id}),f.register({paymentId:id})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal((await f.request('POST',`/api/public/payments/${id}/confirm`,{})).status,409);
  await counts(f,1);
});

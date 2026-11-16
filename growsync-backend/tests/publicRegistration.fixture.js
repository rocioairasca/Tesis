// Disposable DB and explicit provider/Auth0 doubles. Never imports .env or real clients.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');

function load(relative, overrides, env, logs = []) {
  const filename = path.resolve(__dirname, '..', relative);
  const actual = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process: { env }, URL, URLSearchParams,
    console: { log(...args) { logs.push(args); }, warn(...args) { logs.push(args); }, error(...args) { logs.push(args); } },
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : actual(name),
  }, { filename });
  return module.exports;
}

async function fixture(t, env = {}) {
  let db, pool;
  const connectionString = process.env.REGISTRATION_TEST_DATABASE_URL;
  if (connectionString) {
    const url = new URL(connectionString);
    if (!['localhost','127.0.0.1'].includes(url.hostname) || url.username !== 'registration_test') {
      throw new Error('Only a disposable local registration_test cluster is allowed');
    }
    const { Pool } = require('pg');
    const admin = new Pool({ connectionString });
    // Separate database: execute the exact public-qualified migration without rewriting SQL.
    const database = 'registration_test_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE DATABASE ${database}`);
    url.pathname = '/' + database;
    pool = new Pool({ connectionString: url.toString() });
    db = { query: (sql,args) => pool.query(sql,args), exec: sql => pool.query(sql) };
    t.after(async () => { await pool.end(); await admin.query(`DROP DATABASE ${database}`); await admin.end(); });
  } else {
    db = new PGlite();
    t.after(() => db.close());
    // PGlite has one session; reserve it for the whole transaction, just like pool.connect().
    let tail = Promise.resolve();
    pool = { async connect() {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      return { query: (sql,args) => db.query(sql,args), release };
    }, async query(sql,args) { const c = await pool.connect(); try { return await c.query(sql,args); } finally { c.release(); } } };
  }
  await db.exec(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    -- Reproduce the broad default ACLs present on older Supabase installations.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    CREATE TABLE companies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,inventory_control_start_date date);
    CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid REFERENCES companies,
      email text UNIQUE,full_name text,role integer,enabled boolean,auth0_id text,custom_permissions jsonb);
    CREATE TABLE crops(id uuid DEFAULT gen_random_uuid(),company_id uuid REFERENCES companies,name text);
    CREATE UNIQUE INDEX crops_company_name ON crops(company_id,(lower(btrim(name))));`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/create_payments_table.sql'),'utf8')
    .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261116_company_registration_payments.sql'),'utf8'));
  const calls = { auth: [], preferences: [], search: [], get: [], logs: [] };
  const tokens = new Map();
  const remote = new Map();
  const faults = {};
  const paymentClient = {
    async search(args) {
      calls.search.push(args);
      if (faults.search) return faults.search(args);
      return { results: [...remote.values()].filter(p => p.external_reference === args.options.external_reference) };
    },
    async get(args) { calls.get.push(args); return faults.get ? faults.get(args) : remote.get(String(args.id)); },
  };
  const simulation = load('services/simulatedPayments.js', {}, env);
  const registration = load('services/registrationPayments.js', { './simulatedPayments': simulation }, env);
  const supabase = { pool, from(table) {
    if (table !== 'payments') throw new Error('Unexpected Supabase table: '+table);
    let value, id, update = false;
    const q = {
      insert(v) { value=v; return q; }, update(v) { value=v; update=true; return q; },
      select() { return q; }, eq(key,v) { if(key!=='id') throw Error(key); id=v; return q; },
      async single() {
        const { rows } = await pool.query(`INSERT INTO payments(plan,amount,payment_method,transaction_number,status)
          VALUES($1,$2,$3,$4,$5) RETURNING *`, [value.plan,value.amount,value.payment_method,value.transaction_number,value.status]);
        return { data: rows[0] };
      },
      async maybeSingle() {
        const { rows } = await pool.query(update ? 'UPDATE payments SET status=$2 WHERE id=$1 RETURNING *' :
          'SELECT * FROM payments WHERE id=$1', update ? [id,value.status] : [id]);
        return { data: rows[0] || null };
      },
    };
    return q;
  } };
  const overrides = {
    '../db/supabaseClient': supabase,
    '../services/registrationPayments': registration,
    '../services/simulatedPayments': simulation,
    '../src/config/mercadoPago': {},
    mercadopago: {
      Payment: class { constructor() { return paymentClient; } },
      Preference: class { async create({body}) {
        calls.preferences.push(body);
        return { id: randomUUID(), init_point: 'https://checkout.example.invalid/' };
      } },
    },
    axios: { async post(url,body) {
      calls.auth.push({ url, body });
      if (faults.auth) await faults.auth(url,body);
      return { data: url.endsWith('/oauth/token') ? {access_token:'synthetic'} : {user_id:'auth0|'+randomUUID()} };
    } },
  };
  env.AUTH0_DOMAIN = 'auth.example.invalid';
  const controller = load('controllers/publicController.js', overrides, env, calls.logs);
  const payments = load('controllers/payments.js', overrides, env, calls.logs);
  const mercado = load('controllers/mercadoPagoController.js', overrides, env, calls.logs);
  const router = load('routes/public.routes.js', { ...overrides,
    '../controllers/publicController.js': controller, '../controllers/payments.js': payments }, env);
  const app = express(); app.use(express.json()); app.use('/api/public',router);
  app.post('/preference',mercado.createPaymentPreference);
  app.get('/payment/:paymentId',mercado.getPaymentStatus);
  app.get('/reference/:externalReference',mercado.getPaymentByReference);
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:'+server.address().port;
  async function request(method,route,body,headers) {
    // Existing happy-path tests act as the original browser session. Explicit {} sends NO credentials.
    if (headers === undefined) {
      const reference = body?.mercadoPagoExternalReference || body?.paymentId ||
        (route.startsWith('/payment/') ? remote.get(route.split('/').at(-1))?.external_reference :
          route.match(/(?:reference|payments)\/([^/]+)/)?.[1]);
      headers = tokens.has(reference) ? { 'X-Registration-Token':tokens.get(reference),'X-Registration-Reference':reference } : {};
    }
    const response = await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data = await response.json();
    if (data.registrationToken) tokens.set(data.preference?.externalReference || data.payment?.id,data.registrationToken);
    return { status:response.status, data };
  }
  async function approved(overrides = {}) {
    const response = await request('POST','/preference',{plan:'basic',amount:1,currency:'USD'});
    if(response.status!==201) throw Error(JSON.stringify(response));
    const reference = response.data.preference.externalReference;
    const payment = { id: String(remote.size+10001), status:'approved', external_reference:reference,
      metadata:{plan:'basic'}, transaction_amount:20000, currency_id:'ARS', live_mode:true,
      transaction_amount_refunded:0, ...overrides };
    remote.set(String(payment.id),payment);
    return { reference, payment, registrationToken: response.data.registrationToken, initial: response.data };
  }
  const body = (extra={}) => ({companyName:'Synthetic Company',adminName:'Synthetic Admin',
    email:randomUUID()+'@example.invalid',password:'synthetic-only',...extra});
  const register = (extra,headers) => request('POST','/api/public/register-company',body(extra),headers);
  return { db,pool,request,register,approved,calls,remote,faults,env,controller,payments,body,tokens };
}
module.exports = { fixture };

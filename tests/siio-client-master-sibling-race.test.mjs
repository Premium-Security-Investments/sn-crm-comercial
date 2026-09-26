import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// P1-1 (RED): the API authorizes a snapshot of sibling opportunity ids (requireSiblingOpportunityAuthorization
// -- a plain, unlocked SELECT) and then, in a later separate call, invokes the
// psi_persist_sales_opportunity RPC, which mutates every opportunity currently sharing the client_id. Nothing
// carries the authorized snapshot from the first step into the second, and nothing re-checks it once the RPC
// has the client/opportunity rows locked. Between the authorization read and the RPC's write, the sibling set
// can change (another request relinks a new, unauthorized opportunity onto the same client) and the RPC will
// still sync master-field changes onto it. The fix must:
//   1) have the API pass the exact, server-derived (never client/HTTP-body-supplied) authorized sibling id set
//      into the RPC call, for create/relink/sync paths alike, and
//   2) have the RPC itself, after locking the client and its current opportunities (`for update`), compare
//      that locked current sibling set against the authorized set byte-for-byte and fail closed (raising an
//      exception that rolls back the whole transaction, including any client-master row inserted earlier in
//      the same call) on any mismatch.
// Every assertion below documents one facet of that contract and fails against the current implementation.

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      try { resolve(text ? JSON.parse(text) : null); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
function requestJson(port, path, token, method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

const failures = [];
async function scenario(name, fn) {
  try {
    await fn();
  } catch (error) {
    failures.push(`[${name}] ${error && error.message ? error.message : error}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Section 1: HTTP-level contract -- what the API must send the RPC, for create/relink/sync alike.
// ---------------------------------------------------------------------------------------------

const actors = {
  'comercial-token': {
    user: { id: 'comercial-auth', email: 'comercial@example.test' },
    profile: { id: 'comercial-1', full_name: 'Comercial Uno', microsoft_email: 'comercial1@example.test', auth_user_id: 'comercial-auth', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: false },
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));

const owners = {
  'comercial-1': { id: 'comercial-1', active: true, role: 'comercial', can_own_opportunities: null },
};

const opportunities = {
  'opp-target': {
    id: 'opp-target', owner_id: 'comercial-1', client_id: 'client-pair',
    company_name: 'Empresa Par', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'opp-sib': {
    id: 'opp-sib', owner_id: 'comercial-1', client_id: 'client-pair',
    company_name: 'Empresa Par', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'opp-solo': {
    id: 'opp-solo', owner_id: 'comercial-1', client_id: null,
    company_name: 'Empresa Solo', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'opp-locked-sib': {
    id: 'opp-locked-sib', owner_id: 'comercial-2', client_id: 'client-locked',
    company_name: 'Empresa Bloqueada', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Ana Gomez', decision_maker_email: 'ana@example.test', decision_maker_phone: '3000000001',
  },
};

const clients = {
  'client-pair': {
    id: 'client-pair', company_name: 'Empresa Par', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'client-locked': {
    id: 'client-locked', company_name: 'Empresa Bloqueada', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Ana Gomez', decision_maker_email: 'ana@example.test', decision_maker_phone: '3000000001',
  },
};

const observed = [];
function record(req, url, body = undefined) {
  observed.push({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    ...(body === undefined ? {} : { body }),
  });
}
function resetObserved() { observed.length = 0; }
function rpcWrites() {
  return observed.filter(call => call.path === '/rest/v1/rpc/psi_persist_sales_opportunity' && call.method === 'POST');
}

let rpcResultCounter = 0;
const fakeSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/auth/v1/user') {
    record(req, url);
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }

  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    record(req, url);
    const authUserId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
    if (authUserId) {
      const actor = actorByAuthId.get(authUserId);
      assert.ok(actor, `unexpected auth profile lookup ${authUserId}`);
      return json(res, 200, actor.profile);
    }
    const ownerId = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
    assert.ok(ownerId, 'owner resolver must look up the canonical owner by id');
    if (!owners[ownerId]) return json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
    return json(res, 200, owners[ownerId]);
  }

  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    record(req, url);
    return json(res, 200, []);
  }

  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    record(req, url);
    return json(res, 200, [{ permission_code: 'modulo_oportunidades' }]);
  }

  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    const idParam = url.searchParams.get('id');
    if (req.method === 'GET') {
      const clientIdParam = url.searchParams.get('client_id');
      if (clientIdParam) {
        const clientId = clientIdParam.replace(/^eq\./, '');
        const skipId = idParam && idParam.startsWith('neq.') ? idParam.slice(4) : null;
        const siblings = Object.values(opportunities)
          .filter(o => o.client_id === clientId && o.id !== skipId)
          .map(o => ({ id: o.id, owner_id: o.owner_id }));
        return json(res, 200, siblings);
      }
      const id = idParam ? idParam.replace(/^eq\./, '') : null;
      const found = id ? opportunities[id] : null;
      return found ? json(res, 200, found) : json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
    }
    // Once atomicity (PR #229) landed, nothing may write this table directly -- only the RPC may.
    return json(res, 500, { message: 'direct write to psi_sales_opportunities is forbidden; use the atomic RPC' });
  }

  if (url.pathname === '/rest/v1/psi_sales_clients') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    const idParam = url.searchParams.get('id');
    if (req.method === 'GET') {
      if (idParam) {
        const id = idParam.replace(/^eq\./, '');
        const client = clients[id];
        return client ? json(res, 200, client) : json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
      }
      return json(res, 200, Object.values(clients));
    }
    return json(res, 500, { message: 'direct write to psi_sales_clients is forbidden; use the atomic RPC' });
  }

  if (url.pathname === '/rest/v1/rpc/psi_persist_sales_opportunity') {
    const args = await readJson(req);
    record(req, url, args);
    const id = `rpc-created-opportunity-${++rpcResultCounter}`;
    return json(res, 200, { id, client_id: args?.p_requested_client_id ?? null });
  }

  record(req, url);
  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

let appServer;
const originalConsoleError = console.error;
try {
  console.error = () => {};
  const { default: app } = await import('../server/index.js');
  appServer = http.createServer(app);
  const appPort = await listen(appServer);

  // Sync path: comercial-1 is genuinely authorized against every current sibling of client-pair
  // (opp-sib, also owned by comercial-1). The RPC call must still carry that exact
  // authenticated-server-derived sibling id set -- not an attacker-supplied one smuggled in the
  // request body -- so the RPC can re-verify it under lock. Today the API never sends this at all.
  await scenario('sync path sends the server-derived authorized sibling set, not the request body', async () => {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities/opp-target', 'comercial-token', 'PUT', {
      company_name: 'Empresa Par Actualizada',
      owner_id: 'comercial-1',
      service_type_code: 'vigilancia',
      stage_code: 'prospecto',
      customer_segment: 'cliente_actual',
      regional_nombre: 'Nariño',
      sede: 'Sede A',
      quote_city: 'Pasto',
      economic_sector: 'seguridad_fisica',
      decision_maker_name: 'Juan Perez',
      decision_maker_email: 'juan@example.test',
      decision_maker_phone: '3000000000',
      authorized_sibling_ids: ['forged-unauthorized-id'],
    });
    assert.equal(response.status, 200, `sync update must succeed once sibling ownership is actually authorized (got ${response.status}: ${JSON.stringify(response.body)})`);
    const calls = rpcWrites();
    assert.equal(calls.length, 1, 'sync update must call the persist RPC exactly once');
    const sentIds = [...(calls[0].body.p_authorized_sibling_ids || [])].sort();
    assert.deepEqual(sentIds, ['opp-sib'], 'the RPC must receive the exact authenticated-server-derived sibling id set from the sibling authorization query, never an id list taken from the request body');
  });

  // Relink path: opp-solo is being attached to client-locked, whose only current sibling
  // (opp-locked-sib) is owned by comercial-2. comercial-1 was never authorized against that
  // owner. Today resolveClientArgsForOpportunityUpdate's "relink" branch performs no sibling
  // authorization at all, so this succeeds; it must fail closed instead.
  await scenario('relink path fails closed against an unauthorized destination sibling', async () => {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities/opp-solo', 'comercial-token', 'PUT', {
      company_name: 'Empresa Solo',
      owner_id: 'comercial-1',
      service_type_code: 'vigilancia',
      stage_code: 'prospecto',
      customer_segment: 'cliente_actual',
      regional_nombre: 'Nariño',
      sede: 'Sede A',
      quote_city: 'Pasto',
      economic_sector: 'seguridad_fisica',
      decision_maker_name: 'Juan Perez',
      decision_maker_email: 'juan@example.test',
      decision_maker_phone: '3000000000',
      client_id: 'client-locked',
    });
    assert.equal(response.status, 403, `relinking onto a client whose current sibling owner was never authorized must fail closed before any write (got ${response.status}: ${JSON.stringify(response.body)})`);
    assert.equal(rpcWrites().length, 0, 'no persist RPC call may happen once the relink destination sibling authorization cannot be established');
  });

  // Create path: a new opportunity is attached (via client_id) straight to client-locked, whose
  // only current sibling is owned by comercial-2. Today prepareClientForNewOpportunity performs no
  // sibling authorization either, so this succeeds; it must fail closed instead.
  await scenario('create path fails closed against an unauthorized destination sibling', async () => {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities', 'comercial-token', 'POST', {
      company_name: 'Empresa Nueva',
      owner_id: 'comercial-1',
      service_type_code: 'vigilancia',
      stage_code: 'prospecto',
      customer_segment: 'cliente_actual',
      regional_nombre: 'Nariño',
      client_id: 'client-locked',
    });
    assert.equal(response.status, 403, `creating an opportunity attached to a client whose current sibling owner was never authorized must fail closed before any write (got ${response.status}: ${JSON.stringify(response.body)})`);
    assert.equal(rpcWrites().length, 0, 'no persist RPC call may happen once the create destination sibling authorization cannot be established');
  });
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------------------------
// Section 2: RPC-level contract -- the transactional, fail-closed re-check under lock.
// ---------------------------------------------------------------------------------------------

{
  const migrationPath = new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url);
  const BASE_SCHEMA = `
    create table public.psi_sales_opportunities (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid,
      company_name text,
      economic_sector text,
      decision_maker_name text,
      decision_maker_email text,
      decision_maker_phone text,
      quote_city text,
      quote_date date,
      offer_value numeric,
      service_type_code text,
      stage_code text,
      loss_reason_code text,
      loss_notes text,
      next_action_at timestamptz,
      expected_close_date date,
      commission_rate numeric,
      regional_nombre text,
      sede text,
      tipo_producto_original text,
      observaciones text,
      customer_segment text,
      external_source text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  async function migratedDb() {
    const db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      ${BASE_SCHEMA}
    `);
    await db.exec(readFileSync(migrationPath, 'utf8'));
    return db;
  }

  const RPC_SIGNATURE_WITH_SIBLINGS = 'public.psi_persist_sales_opportunity(text,uuid,uuid,uuid,jsonb,jsonb,uuid[])';
  const CLIENT = {
    company_name: 'Trio SA',
    customer_segment: 'cliente_nuevo',
    regional_nombre: 'Nariño',
    sede: 'Sede A',
    quote_city: 'Pasto',
    economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez',
    decision_maker_email: 'juan@example.test',
    decision_maker_phone: '3000000000',
  };
  const OPPORTUNITY = {
    owner_id: null,
    stage_code: 'prospecto',
    service_type_code: 'vigilancia',
  };

  async function callPersist(db, { mode = 'create', opportunityId = null, actorProfileId = null, requestedClientId = null, opportunity = OPPORTUNITY, client = CLIENT, authorizedSiblingIds = undefined } = {}) {
    if (authorizedSiblingIds === undefined) {
      return db.query(
        `select public.psi_persist_sales_opportunity($1,$2,$3,$4,$5::jsonb,$6::jsonb) as result`,
        [mode, opportunityId, actorProfileId, requestedClientId, JSON.stringify(opportunity), client === null ? null : JSON.stringify(client)],
      );
    }
    return db.query(
      `select public.psi_persist_sales_opportunity($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::uuid[]) as result`,
      [mode, opportunityId, actorProfileId, requestedClientId, JSON.stringify(opportunity), client === null ? null : JSON.stringify(client), authorizedSiblingIds],
    );
  }

  await scenario('rpc contract accepts an authorized sibling id set', async () => {
    const db = await migratedDb();
    try {
      const { rows } = await db.query(`select to_regprocedure('${RPC_SIGNATURE_WITH_SIBLINGS}') as proc`);
      assert.notEqual(rows[0].proc, null, `093 must define ${RPC_SIGNATURE_WITH_SIBLINGS} so the API can pass the authenticated-server-derived authorized sibling id set`);
    } finally {
      await db.close();
    }
  });

  await scenario('rpc fails closed when the locked current siblings do not match the authorized set', async () => {
    const db = await migratedDb();
    try {
      const created = await callPersist(db, { opportunity: { ...OPPORTUNITY, company_name: 'Trio SA' }, client: { ...CLIENT, company_name: 'Trio SA' } });
      const clientId = created.rows[0].result.client_id;
      const firstId = created.rows[0].result.opportunity_id;
      const second = await callPersist(db, { opportunity: { ...OPPORTUNITY, company_name: 'Trio SA' }, requestedClientId: clientId, client: null });
      const secondId = second.rows[0].result.opportunity_id;

      // Simulate the race directly at the storage layer: a third, previously unrelated
      // opportunity is attached to the same client_id between the moment an authorized sibling
      // snapshot would have been taken (just [secondId]) and the update call below that still
      // uses that now-stale snapshot.
      const third = await callPersist(db, { opportunity: { ...OPPORTUNITY, company_name: 'Ajeno SA' }, client: { ...CLIENT, company_name: 'Ajeno SA' } });
      const thirdId = third.rows[0].result.opportunity_id;
      await db.query('update public.psi_sales_opportunities set client_id = $1 where id = $2', [clientId, thirdId]);

      await assert.rejects(
        () => callPersist(db, {
          mode: 'update',
          opportunityId: firstId,
          requestedClientId: clientId,
          authorizedSiblingIds: [secondId],
          opportunity: { ...OPPORTUNITY, company_name: 'Trio Cambiada SA' },
          client: { ...CLIENT, company_name: 'Trio Cambiada SA' },
        }),
        /sibling/i,
        'a stale authorized sibling set (missing the concurrently-attached third opportunity) must be rejected inside the same locked transaction, not silently synced onto it',
      );

      const rows = await db.query(
        'select id, company_name from public.psi_sales_opportunities where id in ($1,$2,$3) order by id',
        [firstId, secondId, thirdId],
      );
      for (const row of rows.rows) {
        assert.notEqual(row.company_name, 'Trio Cambiada SA', 'a rejected sibling-mismatch call must leave no partial company_name update behind on any row');
      }
    } finally {
      await db.close();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Section 3: static deadlock-safe lock-ordering contract. PGlite exposes a single session, so a
// genuine two-connection deadlock cannot be reproduced here; instead these assertions inspect the
// 093 migration's SQL text directly for the locking protocol every protected (sibling-authorized)
// path must follow: (a) the resolved client row must be locked before any target/sibling
// opportunity row, so every caller acquires locks in the same client-then-opportunity order; (b)
// sibling rows must be locked in a deterministic (id) order, so two callers racing over
// overlapping sibling sets cannot lock them in opposite orders; and (c) a plain update that never
// requested a sibling re-check (`p_authorized_sibling_ids is null`) must not still pay for/take a
// `for update` lock on every current sibling row.
// ---------------------------------------------------------------------------------------------

{
  const sql = readFileSync(new URL('../supabase/migrations/093_siio_sales_clients.sql', import.meta.url), 'utf8');
  const functionMatch = sql.match(/create or replace function public\.psi_persist_sales_opportunity[\s\S]*?\$\$;/);

  await scenario('lock-ordering contract: psi_persist_sales_opportunity function body is present in 093', async () => {
    assert.ok(functionMatch, 'must find the psi_persist_sales_opportunity function body in the 093 migration to run static lock-ordering checks against');
  });

  const body = functionMatch ? functionMatch[0] : '';
  const targetLockMatch = body.match(/where\s+id\s*=\s*p_opportunity_id\s*for update;/);
  const clientLockMatch = body.match(/where\s+id\s*=\s*v_client_id\s*for update;/);
  const siblingsLockMatch = body.match(/where\s+client_id\s*=\s*v_client_id[\s\S]*?for update\s*\)\s*locked_siblings;/);
  const siblingsGuardMatch = body.match(/if\s+p_authorized_sibling_ids\s+is\s+not\s+null\s+then/i);

  await scenario('rpc locks the resolved client before locking the update-mode target opportunity row', async () => {
    assert.ok(targetLockMatch, 'must find the update-mode target opportunity row lock (`where id = p_opportunity_id ... for update`)');
    assert.ok(clientLockMatch, 'must find the resolved-client row lock (`where id = v_client_id ... for update`)');
    assert.ok(
      clientLockMatch.index < targetLockMatch.index,
      'the resolved client row must be locked (`for update`) before the update-mode target opportunity row is locked, so every protected path acquires locks in the same client-then-opportunity order and two concurrent callers cannot deadlock against each other -- today the target opportunity is locked first, at the top of the update-mode branch, before client resolution/locking runs at all',
    );
  });

  await scenario('rpc locks the resolved client before locking any sibling opportunity row', async () => {
    assert.ok(clientLockMatch, 'must find the resolved-client row lock (`where id = v_client_id ... for update`)');
    assert.ok(siblingsLockMatch, 'must find the sibling-opportunities locking subquery (`where client_id = v_client_id ... for update ... locked_siblings`)');
    assert.ok(
      clientLockMatch.index < siblingsLockMatch.index,
      'the resolved client row must be locked before any sibling opportunity row is locked, so every protected path acquires locks in the same client-then-opportunity order',
    );
  });

  await scenario('rpc locks sibling opportunity rows in a deterministic (id) order', async () => {
    assert.ok(siblingsLockMatch, 'must find the sibling-opportunities locking subquery (`where client_id = v_client_id ... for update ... locked_siblings`)');
    assert.ok(
      /order\s+by\s+id/i.test(siblingsLockMatch[0]),
      'the sibling-opportunities locking subquery must `order by id` before/while taking its `for update` locks, so two callers racing over an overlapping sibling set always acquire per-row locks in the same deterministic order and cannot deadlock against each other -- today the subquery has no ORDER BY at all',
    );
  });

  await scenario('rpc does not unconditionally lock every sibling row when no sibling authorization was requested', async () => {
    assert.ok(siblingsGuardMatch, 'must find the `if p_authorized_sibling_ids is not null then` guard around the sibling authorization re-check');
    assert.ok(siblingsLockMatch, 'must find the sibling-opportunities locking subquery (`where client_id = v_client_id ... for update ... locked_siblings`)');
    assert.ok(
      siblingsGuardMatch.index < siblingsLockMatch.index,
      'the sibling-opportunities `for update` lock must run only inside the `if p_authorized_sibling_ids is not null then` branch -- a plain call that passes p_authorized_sibling_ids = null (skipping the sibling re-check entirely, e.g. the backward-compatible trusted/service_role 6-arg setup calls) must not still lock every current sibling opportunity row; today that locking subquery runs unconditionally, before the null check exists at all',
    );
  });

}

if (failures.length > 0) {
  throw new Error(`P1-1 sibling-authorization race is not yet fixed -- ${failures.length} contract violation(s):\n- ${failures.join('\n- ')}`);
}

console.log('SIIO client master sibling-authorization race (P1-1) regression passed');

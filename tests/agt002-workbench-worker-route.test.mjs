import assert from 'node:assert/strict';
import http from 'node:http';

// Fase B2: pruebas de comportamiento del endpoint acotado y protegido por secreto
// POST /api/tender-dossier-workbench/worker/run, contra un servidor Express real en
// loopback y un Supabase falso también en loopback (mismo patrón que
// tests/tender-dossiers-api.test.mjs). El protocolo HMAC real del puente ya está
// probado exhaustivamente en tests/agt002-workbench-responder.test.mjs (Fase B1)
// contra el fixture sintético real; aquí el puente se sustituye por la semilla de
// inyección de dependencias exclusiva de pruebas del propio endpoint, para poder
// exigir una URL HTTPS válida en la configuración (como en producción) sin montar
// un servidor TLS de prueba. Sin red real, sin secretos reales.

const WORKER_SECRET = 'workbench-worker-route-test-secret';
const CRON_SECRET = 'cron-route-test-secret';
const AGENT_ID = '10000000-0000-4000-8000-000000000099';

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: payload !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null, raw: text }));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function jobRow(id) {
  return {
    id,
    thread_id: '10000000-0000-4000-8000-000000000101',
    origin_message_id: '10000000-0000-4000-8000-000000000102',
    opportunity_id: '10000000-0000-4000-8000-000000000103',
    tender_id: '10000000-0000-4000-8000-000000000104',
    snapshot_id: '10000000-0000-4000-8000-000000000105',
    base_version_id: null,
    capability_id: 'agt002.dossier-workbench.reply.v1',
    contract_version: 'agt002.dossier-workbench.v1',
    policy_version: 'agt002.dossier-workbench.policy.v1',
    context_links: [],
    message: 'Identifique los faltantes con sus fuentes.',
    requested_by: '10000000-0000-4000-8000-000000000106',
    idempotency_key: 'a'.repeat(64),
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

// --- Fake Supabase REST server (loopback only): just the RPCs the drain calls. ---
const scenario = {
  sweepReleased: 0,
  claim: { status: 'empty' },
  onClaim: null,
  completeStatus: 500,
  completeError: 'internal db failure: password=hunter2-should-never-leak',
};
const observedRpc = [];
const fakeSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const args = raw ? JSON.parse(raw) : {};

  if (url.pathname === '/rest/v1/rpc/psi_sweep_agt002_workbench_expired_leases') {
    observedRpc.push({ name: 'sweep', args });
    if (scenario.forceSweepFail) return json(res, 500, { message: scenario.completeError });
    return json(res, 200, { status: 'swept', released: scenario.sweepReleased, job_ids: [], max: args.p_max, more: false });
  }
  if (url.pathname === '/rest/v1/rpc/psi_claim_agt002_workbench_job') {
    observedRpc.push({ name: 'claim', args });
    if (typeof scenario.onClaim === 'function') scenario.onClaim();
    return json(res, 200, scenario.claim);
  }
  if (url.pathname === '/rest/v1/rpc/psi_append_agt002_workbench_job_event') {
    observedRpc.push({ name: 'append_event', args });
    return json(res, 200, { status: args.p_event_type, event_id: 'evt-route-test' });
  }
  if (url.pathname === '/rest/v1/rpc/psi_complete_agt002_workbench_job') {
    observedRpc.push({ name: 'complete', args });
    if (scenario.forceCompleteFail) return json(res, scenario.completeStatus, { message: scenario.completeError });
    return json(res, 200, { status: 'completed', message_id: 'msg-route-test', event_id: 'evt-route-test-2' });
  }
  return json(res, 404, { message: `Unhandled Supabase path ${url.pathname}` });
});
const fakeSupabasePort = await listen(fakeSupabase);

// --- Fake bridge client (no network at all), wired via the endpoint's own
// test-only DI seam. The real HMAC-signed bridge protocol is already proven end to
// end in tests/agt002-workbench-responder.test.mjs; this file only proves the
// route's own HTTP behavior (gate, auth, method, sanitized output).
const bridgeCalls = [];
const fakeBridgeClient = {
  async run(args) {
    bridgeCalls.push(args);
    return {
      content: JSON.stringify({ content_text: 'ok', source_links: [], missing_information: [], required_actions: [] }),
      usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null,
    };
  },
};

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakeSupabasePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.AGT002_WORKBENCH_RUNTIME = 'agt002_workbench_bridge_v1';
process.env.AGT002_WORKBENCH_DRAIN_ENABLED = 'true';
process.env.AGT002_WORKBENCH_MODEL = 'vigia-workbench-route-test-model';
// Debe ser HTTPS válido para superar la validación de configuración de producción,
// aunque el DI seam de abajo asegura que nunca se le hace una petición real.
process.env.AGT002_HETZNER_BRIDGE_URL = 'https://agt002-workbench-route-test.invalid/v1/agt002-preview/run';
process.env.AGT002_HETZNER_BRIDGE_HMAC_SECRET = 'b'.repeat(32);
process.env.AGT002_WORKBENCH_AGENT_ID = AGENT_ID;
process.env.AGT002_WORKBENCH_WORKER_ID = 'worker-route-test';
process.env.AGT002_WORKBENCH_WORKER_SECRET = WORKER_SECRET;
process.env.CRON_SECRET = CRON_SECRET;

const { default: app, __setAgt002WorkbenchWorkerTestBridgeClient } = await import('../server/index.js');
__setAgt002WorkbenchWorkerTestBridgeClient(fakeBridgeClient);
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = () => {};
console.warn = () => {};

const appServer = app.listen(0, '127.0.0.1');
await new Promise(resolve => appServer.once('listening', resolve));
const port = appServer.address().port;
const ROUTE = '/api/tender-dossier-workbench/worker/run';

function rpcCountsAfter(baseline) {
  return observedRpc.length - baseline;
}

try {
  // --- 404 when the drain gate is off, without exposing why ---
  {
    process.env.AGT002_WORKBENCH_DRAIN_ENABLED = 'false';
    const baseline = observedRpc.length;
    const res = await request(port, ROUTE, { method: 'POST', headers: { 'x-agt002-workbench-secret': WORKER_SECRET } });
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.raw, /HMAC|WORKER_SECRET|bridge|model/i, 'la respuesta 404 no debe explicar por qué está apagado');
    assert.equal(rpcCountsAfter(baseline), 0, 'con el gate apagado, nunca debe tocarse la base de datos');
    assert.equal(bridgeCalls.length, 0);
    process.env.AGT002_WORKBENCH_DRAIN_ENABLED = 'true';
  }

  // --- 403 with no secret; zero DB/bridge calls ---
  {
    const baseline = observedRpc.length;
    const res = await request(port, ROUTE, { method: 'POST' });
    assert.equal(res.status, 403);
    assert.equal(rpcCountsAfter(baseline), 0, 'sin secreto, nunca debe llamarse a la base de datos');
    assert.equal(bridgeCalls.length, 0);
  }

  // --- 403 when the server-side worker secret is absent, even if a header is supplied; zero DB/bridge calls ---
  {
    const baseline = observedRpc.length;
    const bridgeBaseline = bridgeCalls.length;
    const savedWorkerSecret = process.env.AGT002_WORKBENCH_WORKER_SECRET;
    delete process.env.AGT002_WORKBENCH_WORKER_SECRET;
    try {
      const res = await request(port, ROUTE, { method: 'POST', headers: { 'x-agt002-workbench-secret': WORKER_SECRET } });
      assert.equal(res.status, 403);
      assert.equal(rpcCountsAfter(baseline), 0, 'sin secreto esperado en servidor, nunca debe llamarse a la base de datos');
      assert.equal(bridgeCalls.length, bridgeBaseline, 'sin secreto esperado en servidor, nunca debe llamarse al puente');
    } finally {
      process.env.AGT002_WORKBENCH_WORKER_SECRET = savedWorkerSecret;
    }
  }

  // --- 403 with a wrong secret; zero DB/bridge calls ---
  {
    const baseline = observedRpc.length;
    const res = await request(port, ROUTE, { method: 'POST', headers: { 'x-agt002-workbench-secret': 'not-the-right-secret' } });
    assert.equal(res.status, 403);
    assert.equal(rpcCountsAfter(baseline), 0);
    assert.equal(bridgeCalls.length, 0);
  }

  // --- 405 on a non-POST method, even with a valid secret ---
  {
    const baseline = observedRpc.length;
    const res = await request(port, ROUTE, { method: 'GET', headers: { 'x-agt002-workbench-secret': WORKER_SECRET } });
    assert.equal(res.status, 405);
    assert.equal(rpcCountsAfter(baseline), 0);
  }
  {
    const res = await request(port, ROUTE, { method: 'PUT', headers: { 'x-agt002-workbench-secret': WORKER_SECRET } });
    assert.equal(res.status, 405);
  }

  // --- 200 single run when enabled + correct dedicated secret; sanitized body only ---
  {
    scenario.sweepReleased = 2;
    const expectedJobId = '10000000-0000-4000-8000-000000000301';
    scenario.claim = { status: 'claimed', claim_id: '10000000-0000-4000-8000-000000000201', job: jobRow(expectedJobId) };
    const baseline = observedRpc.length;
    const bridgeBaseline = bridgeCalls.length;
    const res = await request(port, ROUTE, { method: 'POST', headers: { 'x-agt002-workbench-secret': WORKER_SECRET } });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['job_id', 'status', 'swept']);
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.swept, 2);
    assert.equal(res.body.job_id, expectedJobId);
    assert.equal(rpcCountsAfter(baseline) > 0, true, 'la corrida exitosa debe tocar la base de datos exactamente un ciclo');
    assert.equal(bridgeCalls.length, bridgeBaseline + 1, 'debe invocarse el modelo exactamente una vez');
    const claimCalls = observedRpc.slice(baseline).filter(call => call.name === 'claim');
    assert.equal(claimCalls.length, 1, 'no debe reclamarse un segundo trabajo por invocación');
    scenario.claim = { status: 'empty' };
  }

  // --- Never requires/accepts actor_id: a forged one in the body has no effect ---
  {
    scenario.sweepReleased = 0;
    const res = await request(port, ROUTE, {
      method: 'POST',
      headers: { 'x-agt002-workbench-secret': WORKER_SECRET },
      body: { actor_id: 'forged-actor-should-be-ignored' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'idle', swept: 0 });
  }

  // --- CRON_SECRET bearer alternative works, matching the proven tender-worker pattern ---
  {
    const res = await request(port, ROUTE, { method: 'POST', headers: { authorization: `Bearer ${CRON_SECRET}` } });
    assert.equal(res.status, 200);
  }
  {
    const res = await request(port, ROUTE, { method: 'POST', headers: { authorization: 'Bearer not-the-cron-secret' } });
    assert.equal(res.status, 403);
  }

  // --- Dynamic gate flip mid-request: after claim but before the bridge call ---
  {
    scenario.claim = { status: 'claimed', claim_id: '10000000-0000-4000-8000-000000000202', job: jobRow('10000000-0000-4000-8000-000000000302') };
    scenario.onClaim = () => { process.env.AGT002_WORKBENCH_DRAIN_ENABLED = 'false'; };
    const bridgeBaseline = bridgeCalls.length;
    const res = await request(port, ROUTE, { method: 'POST', headers: { 'x-agt002-workbench-secret': WORKER_SECRET } });
    assert.equal(res.status, 200, 'un fallo de trabajo individual sigue siendo una corrida HTTP exitosa (fail-closed a nivel del trabajo, no del endpoint)');
    assert.equal(res.body.status, 'failed');
    assert.equal(bridgeCalls.length, bridgeBaseline, 'el modelo nunca debe invocarse tras el apagado dinámico a mitad de camino');
    scenario.onClaim = null;
    scenario.claim = { status: 'empty' };
    process.env.AGT002_WORKBENCH_DRAIN_ENABLED = 'true';
  }

  // --- Sanitized 503 on unexpected failure: never the raw DB/bridge error ---
  {
    scenario.forceSweepFail = true;
    const res = await request(port, ROUTE, { method: 'POST', headers: { 'x-agt002-workbench-secret': WORKER_SECRET } });
    assert.equal(res.status, 503);
    assert.deepEqual(Object.keys(res.body).sort(), ['code', 'error']);
    assert.equal(res.body.code, 'AGT002_WORKBENCH_WORKER_UNAVAILABLE');
    assert.doesNotMatch(res.raw, /hunter2/, 'el 503 nunca debe filtrar el error crudo de la base de datos');
    assert.doesNotMatch(res.raw, new RegExp(WORKER_SECRET), 'el 503 nunca debe filtrar el secreto');
    scenario.forceSweepFail = false;
  }
} finally {
  await Promise.all([
    new Promise(resolve => appServer.close(resolve)),
    new Promise(resolve => fakeSupabase.close(resolve)),
  ]);
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
}

console.log('AGT-002 workbench worker route (behavior, loopback fixtures) passed');

import assert from 'node:assert/strict';
import http from 'node:http';

// Behavior-level proof for the temporary AGT-002 fixed-canary secret
// (AGT002_FIXED_CANARY_SECRET / x-agt002-fixed-canary-secret), against a real Express
// server on loopback. No network Supabase calls happen in any scenario here: every
// case either fails authentication (before any loader runs) or fails a gate that sits
// strictly before the first database loader (input validation, runtime profile), so a
// syntactically valid but unreachable Supabase URL is enough. No provider is invoked.

const CANARY_SECRET = 'agt002-fixed-canary-route-test-secret';
const SCHEDULER_SECRET = 'tender-worker-scheduler-route-test-secret';
const CRON_SECRET = 'cron-route-test-secret';
const WORKBENCH_SECRET = 'workbench-worker-route-test-secret';
const WORKBENCH_AGENT_ID = '10000000-0000-4000-8000-000000000099';

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

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.AGT002_CANONICAL_ONLY = 'true';
process.env.AGT002_CONTEXT_V2 = 'true';
process.env.AGT002_DOCUMENT_RETRIEVAL = 'true';
delete process.env.AGT002_LEGAL_CORPUS;
delete process.env.AGT002_INTEGRAL_CONTRACT_V3;
process.env.TENDER_WORKER_SCHEDULER_SECRET = SCHEDULER_SECRET;
process.env.CRON_SECRET = CRON_SECRET;
process.env.AGT002_WORKBENCH_WORKER_SECRET = WORKBENCH_SECRET;
process.env.AGT002_FIXED_CANARY_SECRET = CANARY_SECRET;
delete process.env.TENDER_AUTO_ANALYSIS;
delete process.env.TENDER_DURABLE_PIPELINE;
delete process.env.AGT002_WORKBENCH_DRAIN_ENABLED;

const { default: app } = await import('../server/index.js');
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const loggedCalls = [];
console.error = (...args) => { loggedCalls.push(args); };
console.warn = (...args) => { loggedCalls.push(args); };

const appServer = app.listen(0, '127.0.0.1');
await new Promise(resolve => appServer.once('listening', resolve));
const port = appServer.address().port;

const ROUTE = '/api/agt002-reanalyze-fixed-snapshot';
const DURABLE_WORKER_ROUTE = '/api/tender-processing-worker-run';
const WORKBENCH_WORKER_ROUTE = '/api/tender-dossier-workbench/worker/run';

const WELL_FORMED_BODY = {
  opportunity_id: '54190e51-15fb-46af-b0aa-8f13461a3110',
  prior_analysis_run_id: 'b0f53383-3667-4897-8b77-e16b390a733e',
  expected_snapshot_id: 'be9d136f-fa26-49fc-acce-23ad0a7d6a32',
  expected_document_count: 2,
};

const allResponses = [];
async function tracked(...args) {
  const res = await request(...args);
  allResponses.push(res);
  return res;
}

try {
  // --- Absent, empty, and wrong canary secret all fail closed with 403 ---
  {
    const res = await tracked(port, ROUTE, { method: 'POST', body: {} });
    assert.equal(res.status, 403, 'no secret at all must be rejected');
  }
  {
    const res = await tracked(port, ROUTE, { method: 'POST', headers: { 'x-agt002-fixed-canary-secret': '' }, body: {} });
    assert.equal(res.status, 403, 'an empty canary secret header must be rejected');
  }
  {
    const res = await tracked(port, ROUTE, { method: 'POST', headers: { 'x-agt002-fixed-canary-secret': 'not-the-right-secret' }, body: {} });
    assert.equal(res.status, 403, 'a wrong canary secret must be rejected');
  }

  // --- Correct canary secret authenticates, but downstream validation still runs (no bypass) ---
  {
    const res = await tracked(port, ROUTE, { method: 'POST', headers: { 'x-agt002-fixed-canary-secret': CANARY_SECRET }, body: {} });
    assert.equal(res.status, 400, 'the canary secret must authenticate, then still hit request validation on a malformed body');
    assert.notEqual(res.status, 403, 'must not still be an auth failure once the canary secret is correct');
  }

  // --- Correct canary secret authenticates, but the runtime profile gate still runs (no bypass) ---
  {
    const res = await tracked(port, ROUTE, {
      method: 'POST',
      headers: { 'x-agt002-fixed-canary-secret': CANARY_SECRET },
      body: WELL_FORMED_BODY,
    });
    assert.equal(res.status, 409, 'a well-formed request must still fail the runtime profile gate (auto-analysis is off) even once authenticated by the canary secret');
  }

  // --- Existing TENDER_WORKER_SCHEDULER_SECRET / CRON_SECRET behavior is unchanged on this route ---
  {
    const res = await tracked(port, ROUTE, { method: 'POST', headers: { 'x-tender-worker-secret': SCHEDULER_SECRET }, body: {} });
    assert.equal(res.status, 400, 'the pre-existing scheduler secret must still authenticate and still hit validation identically');
  }
  {
    const res = await tracked(port, ROUTE, { method: 'POST', headers: { authorization: `Bearer ${CRON_SECRET}` }, body: {} });
    assert.equal(res.status, 400, 'the pre-existing CRON_SECRET bearer must still authenticate and still hit validation identically');
  }
  {
    const res = await tracked(port, ROUTE, { method: 'POST', headers: { 'x-tender-worker-secret': SCHEDULER_SECRET }, body: WELL_FORMED_BODY });
    assert.equal(res.status, 409, 'the pre-existing scheduler secret must hit the identical profile gate, not a special-cased outcome');
  }
  {
    const res = await tracked(port, ROUTE, { method: 'POST', headers: { authorization: 'Bearer not-the-cron-secret' }, body: {} });
    assert.equal(res.status, 403, 'a wrong CRON_SECRET bearer must still be rejected exactly as before');
  }

  // --- The temporary canary secret must not authorize the durable worker route ---
  {
    process.env.TENDER_DURABLE_PIPELINE = 'on';
    const res = await tracked(port, DURABLE_WORKER_ROUTE, { method: 'POST', headers: { 'x-agt002-fixed-canary-secret': CANARY_SECRET } });
    assert.equal(res.status, 403, 'the durable worker route must reject the temporary canary secret');
    delete process.env.TENDER_DURABLE_PIPELINE;
  }

  // --- The temporary canary secret must not authorize the Workbench worker route ---
  // isAgt002WorkbenchDrainEnabled deep-validates the whole runtime config (model,
  // bridge URL, HMAC secret, agent/worker id) before the route's own auth check even
  // runs; without a fully valid config the gate itself returns 404 first, which would
  // prove nothing about authorization. So the config is set to a valid (but
  // unreachable, never-dialed) shape purely to get past the gate and exercise the
  // 403 auth check itself.
  {
    process.env.AGT002_WORKBENCH_RUNTIME = 'agt002_workbench_bridge_v1';
    process.env.AGT002_WORKBENCH_DRAIN_ENABLED = 'true';
    process.env.AGT002_WORKBENCH_MODEL = 'vigia-workbench-route-test-model';
    process.env.AGT002_HETZNER_BRIDGE_URL = 'https://agt002-workbench-route-test.invalid/v1/agt002-preview/run';
    process.env.AGT002_HETZNER_BRIDGE_HMAC_SECRET = 'b'.repeat(32);
    process.env.AGT002_WORKBENCH_AGENT_ID = WORKBENCH_AGENT_ID;
    process.env.AGT002_WORKBENCH_WORKER_ID = 'worker-route-test';
    const res = await tracked(port, WORKBENCH_WORKER_ROUTE, { method: 'POST', headers: { 'x-agt002-fixed-canary-secret': CANARY_SECRET } });
    assert.equal(res.status, 403, 'the Workbench worker route must reject the temporary canary secret');
    delete process.env.AGT002_WORKBENCH_RUNTIME;
    delete process.env.AGT002_WORKBENCH_DRAIN_ENABLED;
    delete process.env.AGT002_WORKBENCH_MODEL;
    delete process.env.AGT002_HETZNER_BRIDGE_URL;
    delete process.env.AGT002_HETZNER_BRIDGE_HMAC_SECRET;
    delete process.env.AGT002_WORKBENCH_AGENT_ID;
    delete process.env.AGT002_WORKBENCH_WORKER_ID;
  }

  // --- The Workbench worker's own secret must not authorize the fixed-snapshot route (unchanged isolation) ---
  {
    const res = await tracked(port, ROUTE, { method: 'POST', headers: { 'x-agt002-workbench-secret': WORKBENCH_SECRET }, body: {} });
    assert.equal(res.status, 403, 'the Workbench worker secret must not authorize the fixed-snapshot route');
  }

  // --- Non-disclosure: no response body, and no logged call, ever contains any secret value ---
  {
    const secretPattern = new RegExp([CANARY_SECRET, SCHEDULER_SECRET, CRON_SECRET, WORKBENCH_SECRET].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
    for (const res of allResponses) {
      assert.doesNotMatch(res.raw, secretPattern, 'no response body may ever contain a secret value');
      assert.doesNotMatch(res.raw, /x-agt002-fixed-canary-secret/i, 'no response body may echo the header name');
    }
    for (const args of loggedCalls) {
      const serialized = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
      assert.doesNotMatch(serialized, secretPattern, 'no logged call may ever contain a secret value');
    }
  }
} finally {
  await new Promise(resolve => appServer.close(resolve));
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
}

console.log('AGT-002 fixed-canary secret route (behavior, loopback) passed');

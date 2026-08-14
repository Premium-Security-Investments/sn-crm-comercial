import assert from 'node:assert/strict';
import http from 'node:http';

const CANARY_SECRET = 'agt002-fixed-canary-route-test-secret';
const SCHEDULER_SECRET = 'tender-worker-scheduler-route-test-secret';
const CRON_SECRET = 'cron-route-test-secret';
const WORKBENCH_SECRET = 'workbench-worker-route-test-secret';
const WORKBENCH_AGENT_ID = '10000000-0000-4000-8000-000000000099';

function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request({ hostname:'127.0.0.1', port, path, method,
      headers: payload !== undefined ? {'Content-Type':'application/json', ...headers} : headers }, response => {
      let text=''; response.setEncoding('utf8'); response.on('data', c => { text += c; });
      response.on('end', () => { let body=null; try { body=text ? JSON.parse(text) : null; } catch { body=null; } resolve({status:response.statusCode, body, raw:text}); });
    });
    req.on('error', reject); if (payload !== undefined) req.write(payload); req.end();
  });
}

process.env.VERCEL='1';
process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';
process.env.AGT002_CANONICAL_ONLY='true';
process.env.AGT002_CONTEXT_V2='true';
process.env.AGT002_DOCUMENT_RETRIEVAL='true';
delete process.env.AGT002_LEGAL_CORPUS;
delete process.env.AGT002_INTEGRAL_CONTRACT_V3;
process.env.TENDER_WORKER_SCHEDULER_SECRET=SCHEDULER_SECRET;
process.env.CRON_SECRET=CRON_SECRET;
process.env.AGT002_WORKBENCH_WORKER_SECRET=WORKBENCH_SECRET;
process.env.AGT002_FIXED_CANARY_SECRET=CANARY_SECRET;
delete process.env.TENDER_AUTO_ANALYSIS;
delete process.env.TENDER_DURABLE_PIPELINE;
delete process.env.AGT002_WORKBENCH_DRAIN_ENABLED;

const {default:app}=await import('../server/index.js');
const originalConsoleError=console.error, originalConsoleWarn=console.warn;
const loggedCalls=[];
console.error=(...args)=>loggedCalls.push(args); console.warn=(...args)=>loggedCalls.push(args);
const appServer=app.listen(0,'127.0.0.1');
await new Promise(resolve=>appServer.once('listening',resolve));
const port=appServer.address().port;

const CANARY_ROUTE='/api/internal/agt002-fixed-snapshot-reanalysis';
const EXISTING_ROUTE='/api/agt002-reanalyze-fixed-snapshot';
const DURABLE_WORKER_ROUTE='/api/tender-processing-worker-run';
const WORKBENCH_WORKER_ROUTE='/api/tender-dossier-workbench/worker/run';
const WELL_FORMED_BODY={opportunity_id:'54190e51-15fb-46af-b0aa-8f13461a3110',prior_analysis_run_id:'b0f53383-3667-4897-8b77-e16b390a733e',expected_snapshot_id:'be9d136f-fa26-49fc-acce-23ad0a7d6a32',expected_document_count:2};
const allResponses=[];
async function tracked(...args){const r=await request(...args); allResponses.push(r); return r;}

try {
  for (const headers of [{},{'x-agt002-fixed-canary-secret':''},{'x-agt002-fixed-canary-secret':'wrong'}]) {
    assert.equal((await tracked(port,CANARY_ROUTE,{method:'POST',headers,body:{}})).status,403);
  }
  { const get=await tracked(port,CANARY_ROUTE,{method:'GET',headers:{'x-agt002-fixed-canary-secret':CANARY_SECRET}}); assert.equal(get.status,200); assert.match(get.raw,/<!doctype html>/i); }
  assert.equal((await tracked(port,CANARY_ROUTE,{method:'POST',headers:{'x-agt002-fixed-canary-secret':CANARY_SECRET},body:{}})).status,400);
  assert.equal((await tracked(port,CANARY_ROUTE,{method:'POST',headers:{'x-agt002-fixed-canary-secret':CANARY_SECRET},body:WELL_FORMED_BODY})).status,409);

  // Existing scheduler/cron authorization remains on the existing route.
  assert.equal((await tracked(port,EXISTING_ROUTE,{method:'POST',headers:{'x-tender-worker-secret':SCHEDULER_SECRET},body:{}})).status,400);
  assert.equal((await tracked(port,EXISTING_ROUTE,{method:'POST',headers:{authorization:`Bearer ${CRON_SECRET}`},body:{}})).status,400);
  assert.equal((await tracked(port,EXISTING_ROUTE,{method:'POST',headers:{authorization:'Bearer wrong'},body:{}})).status,403);

  // The ephemeral secret authenticates no route except the exact canary POST.
  assert.equal((await tracked(port,EXISTING_ROUTE,{method:'POST',headers:{'x-agt002-fixed-canary-secret':CANARY_SECRET},body:{}})).status,403);
  process.env.TENDER_DURABLE_PIPELINE='on';
  assert.equal((await tracked(port,DURABLE_WORKER_ROUTE,{method:'POST',headers:{'x-agt002-fixed-canary-secret':CANARY_SECRET}})).status,403);
  delete process.env.TENDER_DURABLE_PIPELINE;

  process.env.AGT002_WORKBENCH_RUNTIME='agt002_workbench_bridge_v1';
  process.env.AGT002_WORKBENCH_DRAIN_ENABLED='true';
  process.env.AGT002_WORKBENCH_MODEL='vigia-workbench-route-test-model';
  process.env.AGT002_HETZNER_BRIDGE_URL='https://agt002-workbench-route-test.invalid/v1/agt002-preview/run';
  process.env.AGT002_HETZNER_BRIDGE_HMAC_SECRET='b'.repeat(32);
  process.env.AGT002_WORKBENCH_AGENT_ID=WORKBENCH_AGENT_ID;
  process.env.AGT002_WORKBENCH_WORKER_ID='worker-route-test';
  assert.equal((await tracked(port,WORKBENCH_WORKER_ROUTE,{method:'POST',headers:{'x-agt002-fixed-canary-secret':CANARY_SECRET}})).status,403);
  delete process.env.AGT002_WORKBENCH_RUNTIME; delete process.env.AGT002_WORKBENCH_DRAIN_ENABLED;
  delete process.env.AGT002_WORKBENCH_MODEL; delete process.env.AGT002_HETZNER_BRIDGE_URL;
  delete process.env.AGT002_HETZNER_BRIDGE_HMAC_SECRET; delete process.env.AGT002_WORKBENCH_AGENT_ID;
  delete process.env.AGT002_WORKBENCH_WORKER_ID;

  assert.equal((await tracked(port,CANARY_ROUTE,{method:'POST',headers:{'x-agt002-workbench-secret':WORKBENCH_SECRET},body:{}})).status,403);
  const secretPattern=new RegExp([CANARY_SECRET,SCHEDULER_SECRET,CRON_SECRET,WORKBENCH_SECRET].map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'));
  for(const r of allResponses){assert.doesNotMatch(r.raw,secretPattern); assert.doesNotMatch(r.raw,/x-agt002-fixed-canary-secret/i);}
  for(const args of loggedCalls) assert.doesNotMatch(args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '),secretPattern);
} finally {
  await new Promise(resolve=>appServer.close(resolve)); console.error=originalConsoleError; console.warn=originalConsoleWarn;
}
console.log('AGT-002 fixed-canary secret route behavior passed');

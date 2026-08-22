import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getAgt002WorkbenchApi,
  postAgt002LearningReviewApi,
  postAgt002MessageApi,
  postAgt002RetryApi,
} from '../agt002-workbench-api.js';
import {
  AGT002_WORKBENCH_CAPABILITIES,
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
} from '../agt002-workbench-contract.js';

const ids = Object.freeze({
  actor: '10000000-0000-4000-8000-000000000001',
  outsider: '10000000-0000-4000-8000-000000000002',
  forged: '10000000-0000-4000-8000-000000000003',
  opportunity: '10000000-0000-4000-8000-000000000004',
  thread: '10000000-0000-4000-8000-000000000005',
  message: '10000000-0000-4000-8000-000000000006',
  snapshot: '10000000-0000-4000-8000-000000000007',
  job: '10000000-0000-4000-8000-000000000008',
  proposal: '10000000-0000-4000-8000-000000000009',
});
const operator = { id: ids.actor, active: true, identity_type: 'human', role: 'comercial', permissions: ['licitaciones'] };
const custodian = { ...operator, permissions: ['licitaciones', 'licitaciones_custodia'] };
const outsider = { id: ids.outsider, active: true, identity_type: 'human', role: 'colaborador', permissions: [] };

// La corrida canónica que el servidor lee en cada POST para derivar —y sobrescribir— el
// snapshot y los vínculos del mensaje. El body nunca es su origen.
const canonicalRun = Object.freeze({
  id: '10000000-0000-4000-8000-000000000030',
  opportunity_id: ids.opportunity,
  tender_id: '10000000-0000-4000-8000-000000000031',
  snapshot_id: ids.snapshot,
  producer: 'AGT-002',
  method: 'agent_ai',
  status: 'completed',
  canonical: true,
  context_version_id: null,
  legal_corpus_version_id: null,
  result: { questions: [] },
  created_at: '2026-08-20T10:00:00.000Z',
});

function fakeDb(response = {}, failure = null, runs = [canonicalRun]) {
  return {
    calls: [],
    async rpc(name, args) {
      this.calls.push({ name, args });
      return {
        data: failure ? null : (typeof response === 'function' ? response(name, args) : response),
        error: failure,
      };
    },
    from() {
      const filters = {};
      const builder = {
        select: () => builder,
        eq(column, value) { filters[column] = value; return builder; },
        order: () => builder,
        limit: count => Promise.resolve({
          data: runs.filter(row => Object.entries(filters).every(([column, value]) => row[column] === value)).slice(0, count),
          error: null,
        }),
      };
      return builder;
    },
  };
}

for (const call of [
  db => getAgt002WorkbenchApi(db, ids.opportunity, operator),
  db => postAgt002MessageApi(db, {}, operator),
  db => postAgt002RetryApi(db, {}, operator),
  db => postAgt002LearningReviewApi(db, {}, custodian),
]) {
  const db = fakeDb();
  await assert.rejects(() => call(db), error => error.status === 503 && error.code === 'AGT002_WORKBENCH_DISABLED');
  assert.equal(db.calls.length, 0);
}

const enabled = { enabled: true };
const unauthorizedDb = fakeDb();
await assert.rejects(
  () => getAgt002WorkbenchApi(unauthorizedDb, ids.opportunity, outsider, enabled),
  error => error.status === 403 && error.code === 'AGT002_WORKBENCH_FORBIDDEN',
);
assert.equal(unauthorizedDb.calls.length, 0);

const forgedDb = fakeDb();
await assert.rejects(() => postAgt002MessageApi(forgedDb, {
  opportunity_id: ids.opportunity,
  thread_id: ids.thread,
  client_message_id: ids.message,
  actor_id: ids.forged,
  content: 'Liste faltantes.',
  context_links: [],
  capability_id: AGT002_WORKBENCH_CAPABILITIES.reply,
  snapshot_id: ids.snapshot,
  base_version_id: null,
}, operator, enabled), error => error.status === 400
  && error.code === 'AGT002_WORKBENCH_BAD_REQUEST'
  && /actor_id|inesperad/i.test(error.message));
assert.equal(forgedDb.calls.length, 0);

const messageDb = fakeDb({ status: 'queued', job_id: ids.job });
const messageBody = {
  opportunity_id: ids.opportunity,
  thread_id: ids.thread,
  client_message_id: ids.message,
  content: 'Liste faltantes.',
  context_links: [],
  capability_id: AGT002_WORKBENCH_CAPABILITIES.reply,
  snapshot_id: ids.snapshot,
  base_version_id: null,
};
const queued = await postAgt002MessageApi(messageDb, messageBody, operator, enabled);
assert.equal(queued.status, 'queued');
assert.equal(messageDb.calls[0].name, 'psi_append_agt002_workbench_message');
assert.equal(messageDb.calls[0].args.p_actor_id, ids.actor);
assert.equal(messageDb.calls[0].args.p_message_id, ids.message);
assert.match(messageDb.calls[0].args.p_idempotency_key, /^[a-f0-9]{64}$/);
assert.equal(messageDb.calls[0].args.p_contract_version, AGT002_WORKBENCH_CONTRACT_VERSION);
assert.equal(messageDb.calls[0].args.p_policy_version, AGT002_WORKBENCH_POLICY_VERSION);
// Snapshot y vínculos persistidos son los que derivó el servidor de la corrida canónica,
// no los del body (que aquí llega con `context_links: []`).
assert.equal(messageDb.calls[0].args.p_snapshot_id, canonicalRun.snapshot_id);
assert.deepEqual(messageDb.calls[0].args.p_context_links.map(link => link.id), [canonicalRun.snapshot_id, canonicalRun.id]);

const secondDb = fakeDb({ status: 'existing', job_id: ids.job });
await postAgt002MessageApi(secondDb, messageBody, operator, enabled);
assert.equal(secondDb.calls[0].args.p_idempotency_key, messageDb.calls[0].args.p_idempotency_key);

const retryDb = fakeDb({ status: 'released' });
assert.equal((await postAgt002RetryApi(retryDb, { opportunity_id: ids.opportunity, job_id: ids.job }, operator, enabled)).status, 'released');
assert.equal(retryDb.calls[0].args.p_actor_id, ids.actor);

const reviewDb = fakeDb({ decision: 'approved' });
await assert.rejects(
  () => postAgt002LearningReviewApi(reviewDb, {
    opportunity_id: ids.opportunity, proposal_id: ids.proposal,
    decision: 'approved', scope: 'entity', comment: 'ok',
  }, operator, enabled),
  error => error.status === 403 && error.code === 'AGT002_WORKBENCH_FORBIDDEN',
);
assert.equal(reviewDb.calls.length, 0);
assert.equal((await postAgt002LearningReviewApi(reviewDb, {
  opportunity_id: ids.opportunity, proposal_id: ids.proposal,
  decision: 'approved', scope: 'entity', comment: 'ok',
}, custodian, enabled)).decision, 'approved');

const missingDb = fakeDb({}, { code: 'P0002', message: 'No existe.' });
await assert.rejects(
  () => getAgt002WorkbenchApi(missingDb, ids.opportunity, operator, enabled),
  error => error.status === 404 && error.code === 'AGT002_WORKBENCH_NOT_FOUND',
);
const conflictDb = fakeDb({}, { code: '23514', message: 'El trabajo sigue activo.' });
await assert.rejects(
  () => postAgt002RetryApi(conflictDb, { opportunity_id: ids.opportunity, job_id: ids.job }, operator, enabled),
  error => error.status === 409 && error.code === 'AGT002_WORKBENCH_IN_PROGRESS',
);

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
assert.equal(vercel, server, 'server/index.js y api/[...path].js deben ser byte-idénticos');
for (const route of [
  "app.get('/api/tender-dossier-workbench'",
  "app.post('/api/tender-dossier-workbench/messages'",
  "app.post('/api/tender-dossier-workbench/jobs/retry'",
  "app.post('/api/tender-dossier-workbench/learning/review'",
]) assert.ok(server.includes(route), `falta ruta ${route}`);
assert.match(server, /isAgt002WorkbenchApiEnabled\(process\.env\)/, 'las rutas deben evaluar el gate fail-closed por solicitud');
assert.doesNotMatch(server, /AGT002_WORKBENCH_RUNTIME_ENABLED\s*=\s*false/, 'no debe sobrevivir el literal antiguo');

console.log('AGT-002 workbench API + route parity passed');

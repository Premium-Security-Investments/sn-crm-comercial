import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgt002WorkbenchWorker } from '../agt002-workbench-worker.js';
import { createSyntheticAgt002Responder } from './fixtures/agt002-workbench-synthetic-responder.mjs';
import {
  AGT002_WORKBENCH_CAPABILITIES,
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
} from '../agt002-workbench-contract.js';

const ids = Object.freeze({
  actor: '10000000-0000-4000-8000-000000000001',
  agent: '10000000-0000-4000-8000-000000000002',
  opportunity: '10000000-0000-4000-8000-000000000003',
  thread: '10000000-0000-4000-8000-000000000004',
  tender: '10000000-0000-4000-8000-000000000005',
  snapshot: '10000000-0000-4000-8000-000000000006',
  artifact: '10000000-0000-4000-8000-000000000007',
  baseVersion: '10000000-0000-4000-8000-000000000008',
  otherVersion: '10000000-0000-4000-8000-000000000009',
});

function uuid(sequence) {
  return `20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

const limits = Object.freeze({
  workerId: 'worker-test', dailyMaxJobs: 20, maxConcurrent: 2, leaseSeconds: 300,
  responderTimeoutMs: 10, agentId: ids.agent,
});

function jobRow({ id, originMessageId, capabilityId, baseVersionId = null }) {
  return Object.freeze({
    id,
    thread_id: ids.thread,
    origin_message_id: originMessageId,
    opportunity_id: ids.opportunity,
    tender_id: ids.tender,
    snapshot_id: ids.snapshot,
    base_version_id: baseVersionId,
    capability_id: capabilityId,
    contract_version: AGT002_WORKBENCH_CONTRACT_VERSION,
    policy_version: AGT002_WORKBENCH_POLICY_VERSION,
    context_links: [],
    message: 'Identifique los faltantes con sus fuentes.',
    requested_by: ids.actor,
    idempotency_key: 'a'.repeat(64),
    created_at: '2026-01-01T00:00:00.000Z',
  });
}

function replyFixture(overrides = {}) {
  return {
    kind: 'reply',
    visible_agent_name: 'Vig-IA',
    human_review_required: true,
    snapshot_id: ids.snapshot,
    base_version_id: null,
    content_text: 'Se identificaron faltantes.',
    source_links: [],
    missing_information: ['Certificado de existencia.'],
    required_actions: ['La encargada debe adjuntar el certificado.'],
    ...overrides,
  };
}

function draftFixture(overrides = {}) {
  return {
    kind: 'draft',
    visible_agent_name: 'Vig-IA',
    human_review_required: true,
    snapshot_id: ids.snapshot,
    base_version_id: ids.baseVersion,
    artifact_id: ids.artifact,
    content_kind: 'markdown',
    content_text: '# Borrador',
    content_metadata: {},
    source_links: [],
    missing_information: [],
    required_actions: ['La encargada debe revisar el borrador.'],
    ...overrides,
  };
}

// Réplica en memoria del contrato de las RPC de persistencia (Task 2/3): claim con
// cola programada por escenario, y estado real para eventos/mensajes/versiones,
// para no fingir aserciones sin ejercitar el protocolo documentado.
function createScenarioPersistence(claimQueue = []) {
  const queue = [...claimQueue];
  const events = [];
  const messages = [];
  const versions = new Map();
  const calls = [];
  const forcedErrors = {};

  function recordEvent(jobId, claimId, eventType, metadata = {}) {
    events.push({ job_id: jobId, claim_id: claimId, event_type: eventType, metadata });
  }

  return {
    calls,
    events,
    messages,
    versions,
    forcedErrors,
    seedVersion(artifactId, versionId) {
      versions.set(artifactId, { id: versionId, version: 1 });
    },
    async claimAgt002WorkbenchJob(args) {
      calls.push({ name: 'claimAgt002WorkbenchJob', args });
      const next = queue.shift() ?? { status: 'empty' };
      if (next.status === 'claimed') recordEvent(next.job.id, next.claim_id, 'claimed');
      return next;
    },
    async appendAgt002WorkbenchJobEvent({ jobId, claimId, eventType, metadata }) {
      calls.push({ name: 'appendAgt002WorkbenchJobEvent', args: { jobId, claimId, eventType, metadata } });
      recordEvent(jobId, claimId, eventType, metadata);
      return { event_id: `evt-${events.length}`, status: eventType };
    },
    async completeAgt002WorkbenchJob({ jobId, claimId, agentId, input, result }) {
      calls.push({ name: 'completeAgt002WorkbenchJob', args: { jobId, claimId, agentId, input, result } });
      if (forcedErrors.completeAgt002WorkbenchJob) {
        const error = forcedErrors.completeAgt002WorkbenchJob;
        delete forcedErrors.completeAgt002WorkbenchJob;
        throw error;
      }
      const existing = messages.find(message => message.origin_job_id === jobId);
      if (existing) return { status: 'existing', message_id: existing.id };
      let pendingVersion = null;
      if (input.capability_id === AGT002_WORKBENCH_CAPABILITIES.draft) {
        const current = versions.get(result.artifact_id) ?? { id: null, version: 0 };
        if (current.id !== input.base_version_id) {
          recordEvent(jobId, claimId, 'stale', { expected_base_version_id: input.base_version_id, current_version_id: current.id });
          return { status: 'stale', current_version_id: current.id };
        }
        pendingVersion = { id: `ver-${versions.size + 1}-${current.version + 1}`, version: current.version + 1 };
      }
      const messageId = `msg-${messages.length + 1}`;
      if (pendingVersion) versions.set(result.artifact_id, pendingVersion);
      messages.push({
        id: messageId,
        thread_id: input.thread_id,
        opportunity_id: input.opportunity_id,
        author_kind: 'agent',
        visible_agent_name: result.visible_agent_name,
        content: result.content_text ?? result.proposed_rule,
        origin_job_id: jobId,
      });
      recordEvent(jobId, claimId, 'completed', { message_id: messageId });
      return { status: 'completed', message_id: messageId };
    },
  };
}

function refusingResponder() {
  return { async respond() { throw new Error('El responder no debía invocarse en este escenario.'); } };
}

// Caso 1: completed / claimed+completed / un mensaje Vig-IA.
{
  const job = jobRow({ id: uuid(1), originMessageId: uuid(1), capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply });
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(2), job }]);
  const fixture = replyFixture();
  const responder = {
    async respond(input) {
      assert.ok(Object.isFrozen(input), 'el input del trabajo debe estar congelado antes de invocar al responder');
      assert.ok(Object.isFrozen(input.context_links), 'el contexto anidado también debe quedar congelado');
      return createSyntheticAgt002Responder({ [job.origin_message_id]: fixture }).respond(input);
    },
  };
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  assert.deepEqual(outcome, { status: 'completed', job_id: job.id });
  assert.deepEqual(persistence.events.map(event => event.event_type), ['claimed', 'completed']);
  assert.equal(persistence.messages.length, 1);
  assert.equal(persistence.messages[0].visible_agent_name, 'Vig-IA');
}

// Caso 2: idle sin responder.
{
  const persistence = createScenarioPersistence([{ status: 'empty' }]);
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder: refusingResponder(), limits });
  assert.deepEqual(outcome, { status: 'idle' });
  assert.equal(persistence.events.length, 0);
}

// Caso 3: lease vigente sin doble ejecución (sólo un trabajo disponible; la segunda
// invocación no encuentra nada más para reclamar y el responder no vuelve a llamarse).
{
  const job = jobRow({ id: uuid(3), originMessageId: uuid(3), capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply });
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(4), job }]);
  let responderCalls = 0;
  const responder = {
    async respond(input) {
      responderCalls += 1;
      return createSyntheticAgt002Responder({ [job.origin_message_id]: replyFixture() }).respond(input);
    },
  };
  const first = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  const second = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  assert.deepEqual(first, { status: 'completed', job_id: job.id });
  assert.deepEqual(second, { status: 'idle' });
  assert.equal(responderCalls, 1);
  assert.equal(persistence.events.filter(event => event.event_type === 'completed').length, 1);
}

// Caso 4: lease vencido → nuevo claim y un solo resultado terminal por intento.
{
  const job = jobRow({ id: uuid(5), originMessageId: uuid(5), capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply });
  const persistence = createScenarioPersistence([
    { status: 'claimed', claim_id: uuid(6), job },
    { status: 'claimed', claim_id: uuid(7), job },
  ]);
  const responder = createSyntheticAgt002Responder({});
  const firstRun = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  assert.deepEqual(firstRun, { status: 'failed', job_id: job.id });

  const responderWithFixture = createSyntheticAgt002Responder({ [job.origin_message_id]: replyFixture() });
  const secondRun = await runAgt002WorkbenchWorker({ persistence, responder: responderWithFixture, limits });
  assert.deepEqual(secondRun, { status: 'completed', job_id: job.id });

  const terminalTypes = persistence.events.filter(event => event.job_id === job.id && event.event_type !== 'claimed').map(event => event.event_type);
  assert.deepEqual(terminalTypes, ['failed', 'completed']);
  assert.equal(persistence.messages.length, 1);
}

// Caso 5: misma idempotency key → existing, sin duplicar mensaje/versión.
{
  const job = jobRow({ id: uuid(8), originMessageId: uuid(8), capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply });
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(9), job }]);
  persistence.messages.push({
    id: 'msg-preexisting', thread_id: job.thread_id, opportunity_id: job.opportunity_id,
    author_kind: 'agent', visible_agent_name: 'Vig-IA', content: 'ya procesado', origin_job_id: job.id,
  });
  const responder = createSyntheticAgt002Responder({ [job.origin_message_id]: replyFixture() });
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  assert.deepEqual(outcome, { status: 'existing', job_id: job.id });
  assert.equal(persistence.messages.length, 1);
  assert.equal(persistence.events.some(event => event.event_type === 'completed'), false);
}

// Caso 6: cuota.
{
  const persistence = createScenarioPersistence([{ status: 'quota' }]);
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder: refusingResponder(), limits });
  assert.deepEqual(outcome, { status: 'quota' });
}

// Caso 7: saturación de concurrencia.
{
  const persistence = createScenarioPersistence([{ status: 'saturated' }]);
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder: refusingResponder(), limits });
  assert.deepEqual(outcome, { status: 'saturated' });
}

// Caso 8: el worker impone timeout real → evento failed con código estable.
{
  const job = jobRow({ id: uuid(10), originMessageId: uuid(10), capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply });
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(11), job }]);
  const responder = {
    async respond() { return new Promise(() => {}); },
  };
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  assert.deepEqual(outcome, { status: 'failed', job_id: job.id });
  const failedEvent = persistence.events.at(-1);
  assert.equal(failedEvent.event_type, 'failed');
  assert.equal(failedEvent.metadata.code, 'AGT002_RESPONDER_TIMEOUT');
}

// Caso 9: navegador cerrado/ausente no afecta al worker.
{
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const job = jobRow({ id: uuid(12), originMessageId: uuid(12), capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply });
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(13), job }]);
  const responder = createSyntheticAgt002Responder({ [job.origin_message_id]: replyFixture() });
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  assert.deepEqual(outcome, { status: 'completed', job_id: job.id });
}

// Caso 10: persistencia parcial nunca afirma completed.
{
  const job = jobRow({
    id: uuid(14), originMessageId: uuid(14), capabilityId: AGT002_WORKBENCH_CAPABILITIES.draft, baseVersionId: null,
  });
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(15), job }]);
  persistence.forcedErrors.completeAgt002WorkbenchJob = Object.assign(new Error('Persistencia caída.'), { code: 'AGT002_PERSISTENCE_DOWN' });
  const responder = createSyntheticAgt002Responder({
    [job.origin_message_id]: draftFixture({ base_version_id: null }),
  });
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  assert.equal(outcome.status, 'failed');
  assert.notEqual(outcome.status, 'completed');
  assert.equal(persistence.versions.has(ids.artifact), false, 'la transacción terminal debe hacer rollback total');
  assert.equal(persistence.messages.length, 0);
  const failedEvent = persistence.events.at(-1);
  assert.equal(failedEvent.event_type, 'failed');
  assert.equal(failedEvent.metadata.code, 'AGT002_PERSISTENCE_DOWN');
}

// Caso 11: base_version_id cambiado → stale, cero versión nueva ni mensaje.
{
  const job = jobRow({
    id: uuid(16), originMessageId: uuid(16), capabilityId: AGT002_WORKBENCH_CAPABILITIES.draft, baseVersionId: ids.baseVersion,
  });
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(17), job }]);
  persistence.seedVersion(ids.artifact, ids.otherVersion);
  const responder = createSyntheticAgt002Responder({
    [job.origin_message_id]: draftFixture({ base_version_id: ids.baseVersion }),
  });
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder, limits });
  assert.deepEqual(outcome, { status: 'stale', job_id: job.id });
  assert.equal(persistence.versions.get(ids.artifact).id, ids.otherVersion);
  assert.equal(persistence.messages.length, 0);
  assert.equal(persistence.calls.filter(call => call.name === 'completeAgt002WorkbenchJob').length, 1);
}

// Responder faltante lanza AGT002_RESPONDER_NOT_CONFIGURED antes del claim.
{
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(18), job: jobRow({ id: uuid(18), originMessageId: uuid(18), capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply }) }]);
  await assert.rejects(
    () => runAgt002WorkbenchWorker({ persistence, responder: undefined, limits }),
    error => error.code === 'AGT002_RESPONDER_NOT_CONFIGURED',
  );
  assert.equal(persistence.calls.length, 0);
}

// Input de trabajo corrupto se rechaza antes de invocar al responder.
{
  const corruptJob = { ...jobRow({ id: uuid(19), originMessageId: uuid(19), capabilityId: AGT002_WORKBENCH_CAPABILITIES.reply }), capability_id: 'agt002.otra-capacidad' };
  const persistence = createScenarioPersistence([{ status: 'claimed', claim_id: uuid(20), job: corruptJob }]);
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder: refusingResponder(), limits });
  assert.deepEqual(outcome, { status: 'failed', job_id: corruptJob.id });
  const failedEvent = persistence.events.at(-1);
  assert.equal(failedEvent.event_type, 'failed');
  assert.equal(failedEvent.metadata.code, 'AGT002_INVALID_JOB_INPUT');
}

function productionJavaScriptFiles(directory) {
  const ignored = new Set(['.git', 'dist', 'node_modules', 'tests']);
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...productionJavaScriptFiles(path));
    else if (/\.(?:js|mjs|ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

for (const path of productionJavaScriptFiles(new URL('..', import.meta.url).pathname)) {
  assert.doesNotMatch(
    readFileSync(path, 'utf8'),
    /agt002-workbench-synthetic-responder/,
    `el fixture sintético no puede importarse desde producción: ${path}`,
  );
}

console.log('AGT-002 workbench worker passed');

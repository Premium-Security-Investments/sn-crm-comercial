import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getAgt002WorkbenchApi,
  postAgt002LearningReviewApi,
  postAgt002MessageApi,
  postAgt002RetryApi,
} from '../verticales/licitaciones/agt002-workbench-api.js';
import {
  AGT002_WORKBENCH_CAPABILITIES,
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
  validateAgt002WorkbenchJobInput,
} from '../verticales/licitaciones/agt002-workbench-contract.js';

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

// ---------------------------------------------------------------------------
// Borradores: el pedido nombra el documento, el servidor deriva el vínculo.
// ---------------------------------------------------------------------------
const draftIds = Object.freeze({
  artifact: '10000000-0000-4000-8000-000000000040',
  version: '10000000-0000-4000-8000-000000000041',
  empty: '10000000-0000-4000-8000-000000000042',
  foreign: '10000000-0000-4000-8000-000000000043',
});

// El expediente tal como lo proyecta psi_get_tender_dossier_workspace: un documento con versión
// humana vigente (el caso real de Terminal) y otro sin ninguna versión.
function workspaceResponse(longContent = false) {
  return (name, args) => {
    if (name !== 'psi_get_tender_dossier_workspace') return { status: 'queued', job_id: ids.job };
    assert.equal(args.p_opportunity_id, ids.opportunity);
    return {
      opportunity_id: ids.opportunity,
      checklist: [],
      artifacts: [
        {
          id: draftIds.artifact,
          title: 'Anexo 7 · Certificaciones de experiencia',
          required: true,
          review_status: 'pendiente',
          version_count: 1,
          current_version: {
            id: draftIds.version,
            version: 1,
            content_kind: 'markdown',
            content_text: longContent ? 'dato '.repeat(600) : 'Relación de contratos de vigilancia ejecutados.',
            author_kind: 'human',
            origin_agent_job_id: null,
          },
        },
        {
          id: draftIds.empty,
          title: 'Propuesta técnica base',
          required: true,
          review_status: 'pendiente',
          version_count: 0,
          current_version: null,
        },
      ],
    };
  };
}

function draftBody(overrides = {}) {
  return {
    opportunity_id: ids.opportunity,
    thread_id: ids.thread,
    client_message_id: ids.message,
    content: 'Redacta una nueva versión del Anexo 7.',
    context_links: [],
    capability_id: AGT002_WORKBENCH_CAPABILITIES.draft,
    snapshot_id: ids.snapshot,
    base_version_id: draftIds.version,
    artifact_id: draftIds.artifact,
    ...overrides,
  };
}

// Una capacidad fuera del contrato se rechaza en la puerta, sin tocar la base.
const badCapabilityDb = fakeDb(workspaceResponse());
await assert.rejects(
  () => postAgt002MessageApi(badCapabilityDb, draftBody({ capability_id: 'agt002.dossier-workbench.aprobar.v1' }), operator, enabled),
  error => error.status === 400 && error.code === 'AGT002_WORKBENCH_BAD_REQUEST',
);
assert.equal(badCapabilityDb.calls.length, 0);

// Un borrador sin documento no se encola: el responder lo rechazaría después del claim.
const noArtifactDb = fakeDb(workspaceResponse());
await assert.rejects(
  () => postAgt002MessageApi(noArtifactDb, { ...draftBody(), artifact_id: null }, operator, enabled),
  error => error.status === 400 && error.code === 'AGT002_WORKBENCH_BAD_REQUEST',
);
assert.equal(noArtifactDb.calls.length, 0);

// Una respuesta no escribe documentos, así que mandar artifact_id es un cliente equivocado.
const replyWithArtifactDb = fakeDb(workspaceResponse());
await assert.rejects(
  () => postAgt002MessageApi(replyWithArtifactDb, draftBody({
    capability_id: AGT002_WORKBENCH_CAPABILITIES.reply, artifact_id: draftIds.artifact,
  }), operator, enabled),
  error => error.status === 400 && error.code === 'AGT002_WORKBENCH_BAD_REQUEST',
);
assert.equal(replyWithArtifactDb.calls.length, 0);

// El body sigue cerrado: una clave que no está en ninguna de las dos listas se rechaza igual.
const forgedActorDb = fakeDb(workspaceResponse());
await assert.rejects(
  () => postAgt002MessageApi(forgedActorDb, { ...draftBody(), actor_id: ids.forged }, operator, enabled),
  error => error.status === 400 && error.code === 'AGT002_WORKBENCH_BAD_REQUEST',
);
assert.equal(forgedActorDb.calls.length, 0);

// Un documento que no está en este expediente no produce vínculo ni trabajo.
const foreignDb = fakeDb(workspaceResponse());
await assert.rejects(
  () => postAgt002MessageApi(foreignDb, draftBody({ artifact_id: draftIds.foreign, base_version_id: null }), operator, enabled),
  error => error.status === 404 && error.code === 'AGT002_WORKBENCH_NOT_FOUND',
);
assert.ok(!foreignDb.calls.some(call => call.name === 'psi_append_agt002_workbench_message'));

// La trampa real: pedir el borrador con base_version_id en blanco sobre un documento que ya tiene
// versión vigente. La RPC respondería `stale` y no escribiría; aquí se rechaza antes de gastar el
// trabajo, con un mensaje que la pantalla puede mostrar.
const staleDb = fakeDb(workspaceResponse());
await assert.rejects(
  () => postAgt002MessageApi(staleDb, draftBody({ base_version_id: null }), operator, enabled),
  error => error.status === 409 && error.code === 'AGT002_WORKBENCH_STALE_ARTIFACT',
);
assert.ok(!staleDb.calls.some(call => call.name === 'psi_append_agt002_workbench_message'));

// Camino feliz sobre la versión humana vigente: un único vínculo `artifact`, derivado del
// expediente, con la versión congelada que la RPC terminal va a comparar.
const draftDb = fakeDb(workspaceResponse());
assert.equal((await postAgt002MessageApi(draftDb, draftBody(), operator, enabled)).status, 'queued');
const draftCall = draftDb.calls.find(call => call.name === 'psi_append_agt002_workbench_message').args;
assert.equal(draftCall.p_capability_id, AGT002_WORKBENCH_CAPABILITIES.draft);
assert.equal(draftCall.p_base_version_id, draftIds.version);
assert.equal(draftCall.p_snapshot_id, canonicalRun.snapshot_id);
const artifactLinks = draftCall.p_context_links.filter(link => link.kind === 'artifact');
assert.equal(artifactLinks.length, 1, 'el responder toma el primer vínculo artifact: debe haber exactamente uno');
assert.equal(artifactLinks[0].id, draftIds.artifact);
assert.match(artifactLinks[0].label, /Anexo 7/);
assert.match(artifactLinks[0].source_ref, /versión vigente 1/);
assert.match(artifactLinks[0].source_ref, /Relación de contratos de vigilancia ejecutados\./);
// Las referencias de origen siguen primero y el artefacto va antes de cualquier relleno.
assert.deepEqual(draftCall.p_context_links.map(link => link.kind), ['snapshot', 'source', 'artifact']);
// Lo que se encola tiene que ser admisible para el contrato tal como lo lee el worker: si el
// vínculo derivado no pasara este validador, el trabajo moriría con AGT002_INVALID_JOB_INPUT
// después del claim, no en el POST.
const frozenJobInput = {
  job_id: ids.job,
  thread_id: ids.thread,
  origin_message_id: ids.message,
  opportunity_id: ids.opportunity,
  tender_id: canonicalRun.tender_id,
  snapshot_id: draftCall.p_snapshot_id,
  base_version_id: draftCall.p_base_version_id,
  capability_id: draftCall.p_capability_id,
  contract_version: draftCall.p_contract_version,
  policy_version: draftCall.p_policy_version,
  context_links: draftCall.p_context_links,
  message: draftCall.p_content,
};
validateAgt002WorkbenchJobInput(frozenJobInput);
// Misma pregunta, otra capacidad: la idempotencia no las confunde.
const sameQuestionDb = fakeDb(workspaceResponse());
const replyBody = draftBody({ capability_id: AGT002_WORKBENCH_CAPABILITIES.reply, base_version_id: null });
delete replyBody.artifact_id;
await postAgt002MessageApi(sameQuestionDb, replyBody, operator, enabled);
assert.notEqual(
  sameQuestionDb.calls.find(call => call.name === 'psi_append_agt002_workbench_message').args.p_idempotency_key,
  draftCall.p_idempotency_key,
);

// Primer borrador de un documento sin versión: base en null, y la procedencia lo dice.
const firstDraftDb = fakeDb(workspaceResponse());
await postAgt002MessageApi(firstDraftDb, draftBody({ artifact_id: draftIds.empty, base_version_id: null }), operator, enabled);
const firstDraftCall = firstDraftDb.calls.find(call => call.name === 'psi_append_agt002_workbench_message').args;
assert.equal(firstDraftCall.p_base_version_id, null);
const firstLink = firstDraftCall.p_context_links.find(link => link.kind === 'artifact');
assert.equal(firstLink.id, draftIds.empty);
assert.match(firstLink.source_ref, /sin versión registrada/);
assert.match(firstLink.source_ref, /sin contenido que tomar como base/);

// Un contenido vigente más largo que el tope del contrato se recorta y lo declara.
const longDb = fakeDb(workspaceResponse(true));
await postAgt002MessageApi(longDb, draftBody(), operator, enabled);
const longLink = longDb.calls.find(call => call.name === 'psi_append_agt002_workbench_message').args
  .p_context_links.find(link => link.kind === 'artifact');
assert.ok(longLink.source_ref.length <= 1000);
assert.match(longLink.source_ref, /contenido recortado/);
validateAgt002WorkbenchJobInput({ ...frozenJobInput, context_links: longDb.calls
  .find(call => call.name === 'psi_append_agt002_workbench_message').args.p_context_links });

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

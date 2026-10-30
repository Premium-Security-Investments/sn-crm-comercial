import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planEmptyDiscovery,
  tenderEmptyDiscoveryDelayMs,
  TENDER_DOCUMENTS_NOT_PUBLISHED_CODE,
  TENDER_DOCUMENTS_PENDING_STATUS,
  TENDER_EMPTY_DISCOVERY_EXHAUSTED_CODE,
  TENDER_EMPTY_DISCOVERY_MAX_ATTEMPTS,
} from '../verticales/licitaciones/tender-empty-discovery.js';
import { createTenderProcessingWorker, isWorkerYieldStatus } from '../verticales/licitaciones/tender-processing-worker.js';

// El 2026-10-28, cuatro licitaciones recién convertidas (Rama Judicial Pereira y Manizales,
// Terminal de Transporte y Fiscalía Eje Cafetero) quedaron con 0 documentos y el trabajo
// aparcado en `needs_attention`, sin reintento, sin próxima fecha y sin mensaje. SECOP
// efectivamente no había publicado nada todavía: el control fue SIC 23 de 2026, con 13
// publicados y 13 importados. Pruebas puras: sin red ni base de datos.

const HOUR = 60 * 60 * 1000;

test('la primera revisión vacía reprograma en vez de aparcar', () => {
  const plan = planEmptyDiscovery({ attempt: 1, now: 0 });
  assert.equal(plan.retry, true);
  assert.equal(plan.status, 'queued', 'sólo "queued" vuelve a ejecutar el descubrimiento');
  assert.equal(plan.currentStep, 'documents');
  assert.equal(plan.attempt, 1);
  assert.equal(plan.nextAttemptAt, new Date(HOUR).toISOString());
  assert.equal(plan.errorCode, TENDER_DOCUMENTS_NOT_PUBLISHED_CODE);
  assert.equal(plan.outcome, TENDER_DOCUMENTS_PENDING_STATUS);
  assert.match(plan.errorMessage, /aún no ha publicado documentos/);
  assert.match(plan.errorMessage, /en 1 hora/);
});

test('la espera crece y se estabiliza en un día', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 11].map(a => tenderEmptyDiscoveryDelayMs(a) / HOUR),
    [1, 3, 6, 12, 24, 24, 24],
  );
  // Un intento fuera de rango no puede producir NaN ni una espera negativa.
  for (const raro of [0, -5, null, undefined, 'x']) {
    const ms = tenderEmptyDiscoveryDelayMs(raro);
    assert.ok(Number.isFinite(ms) && ms > 0, String(raro));
  }
});

test('agotados los intentos sí se aparca, y con motivo', () => {
  const plan = planEmptyDiscovery({ attempt: TENDER_EMPTY_DISCOVERY_MAX_ATTEMPTS, now: 0 });
  assert.equal(plan.retry, false);
  assert.equal(plan.status, 'needs_attention');
  assert.equal(plan.nextAttemptAt, null, 'aparcado no lleva próxima revisión');
  assert.equal(plan.errorCode, TENDER_EMPTY_DISCOVERY_EXHAUSTED_CODE);
  assert.equal(plan.outcome, 'needs_attention');
  assert.match(plan.errorMessage, /Requiere que una persona lo revise/);
  // El mensaje no puede inventar un plazo: debe nombrar días reales.
  assert.match(plan.errorMessage, /durante unos \d+ días/);
});

test('el resultado reprogramado es un estado de cesión del drenaje', () => {
  assert.ok(isWorkerYieldStatus(TENDER_DOCUMENTS_PENDING_STATUS),
    'si no cede, el drenaje reclamaría en bucle un trabajo que sólo devolvería "empty"');
});

function makeDeps(overrides = {}) {
  const calls = { updateJob: [], appendEvent: [], importOneDocument: [] };
  const deps = {
    claimJob: async () => null,
    updateJob: async (jobId, leaseId, patch) => { calls.updateJob.push(patch); },
    recordImportItem: async () => {},
    appendEvent: async (event) => { calls.appendEvent.push(event); },
    revalidateOfficialStatus: async () => ({ terminal: false }),
    discoverDocuments: async () => [],
    importOneDocument: async (args) => { calls.importOneDocument.push(args); return { status: 'imported', hasText: true }; },
    publishSnapshot: async () => ({ id: 'snap-1' }),
    requestAgt002: async () => ({ status: 'quota' }),
    now: () => 0,
    ...overrides,
  };
  return { deps, calls };
}

const claimEnQueued = (attemptCount = 0) => async () => ({
  job_id: 'job-1', lease_id: 'lease-1', tender_id: 'tender-1', opportunity_id: 'opp-1',
  status: 'queued', current_step: 'documents', attempt_count: attemptCount,
});

test('descubrimiento vacío: el trabajo queda reprogramado, no aparcado', async () => {
  const { deps, calls } = makeDeps({ claimJob: claimEnQueued(0) });
  const result = await createTenderProcessingWorker(deps).runOnce({});

  assert.equal(result.status, TENDER_DOCUMENTS_PENDING_STATUS);
  assert.equal(result.discovered, 0);

  assert.equal(calls.updateJob.length, 1);
  const patch = calls.updateJob[0];
  assert.equal(patch.status, 'queued', 'NO needs_attention: de ahí no vuelve solo');
  assert.equal(patch.documents_discovered, 0);
  assert.equal(patch.attempt_count, 1);
  assert.equal(patch.next_attempt_at, new Date(HOUR).toISOString());
  assert.equal(patch.last_error_code, TENDER_DOCUMENTS_NOT_PUBLISHED_CODE);
  assert.ok(patch.last_error_message, 'la razón se escribe, no se calla');

  // El evento lleva la razón para que la ficha pueda mostrarla.
  assert.equal(calls.appendEvent.length, 1);
  assert.equal(calls.appendEvent[0].metadata.discovered, 0);
  assert.equal(calls.appendEvent[0].metadata.retry, true);
  assert.equal(calls.appendEvent[0].metadata.reason_code, TENDER_DOCUMENTS_NOT_PUBLISHED_CODE);

  // Sin documentos no se intenta importar ninguno.
  assert.equal(calls.importOneDocument.length, 0);
});

test('cada revisión vacía sucesiva espera más, y la última aparca', async () => {
  const { deps, calls } = makeDeps({ claimJob: claimEnQueued(1) });
  await createTenderProcessingWorker(deps).runOnce({});
  assert.equal(calls.updateJob[0].attempt_count, 2);
  assert.equal(calls.updateJob[0].next_attempt_at, new Date(3 * HOUR).toISOString());

  const ultimo = makeDeps({ claimJob: claimEnQueued(TENDER_EMPTY_DISCOVERY_MAX_ATTEMPTS - 1) });
  const result = await createTenderProcessingWorker(ultimo.deps).runOnce({});
  assert.equal(result.status, 'needs_attention');
  assert.equal(ultimo.calls.updateJob[0].status, 'needs_attention');
  assert.equal(ultimo.calls.updateJob[0].next_attempt_at, null);
  assert.equal(ultimo.calls.updateJob[0].last_error_code, TENDER_EMPTY_DISCOVERY_EXHAUSTED_CODE);
});

test('con documentos el descubrimiento sigue comportándose igual que antes', async () => {
  const { deps, calls } = makeDeps({
    claimJob: claimEnQueued(0),
    discoverDocuments: async () => ({
      items: [{ sourceDocumentId: 'd1', name: 'Pliego.pdf', source: 'SECOP II' }],
      coverage: null,
    }),
  });
  const result = await createTenderProcessingWorker(deps).runOnce({});
  assert.equal(result.status, 'discovered');
  assert.equal(result.discovered, 1);
  assert.equal(calls.updateJob[0].status, 'importing_documents');
  assert.equal(calls.updateJob[0].documents_discovered, 1);
  assert.equal(calls.updateJob[0].next_attempt_at, undefined, 'el camino feliz no toca la reprogramación');
});

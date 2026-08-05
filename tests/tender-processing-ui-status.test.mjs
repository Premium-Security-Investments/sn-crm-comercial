import assert from 'node:assert/strict';
import { deriveTenderProcessingPresentation, isTenderProcessingActive, shouldReloadTenderArtifacts, tenderProcessingLabel } from '../src/tenders/processingStatus.ts';

const status = (value, jobId = 'job-1') => ({ job_id: jobId, status: value });

assert.equal(isTenderProcessingActive('queued'), true);
assert.equal(isTenderProcessingActive('waiting_agent_capacity'), true);
assert.equal(isTenderProcessingActive('retry_wait'), true);
assert.equal(isTenderProcessingActive('needs_attention'), false);
assert.equal(isTenderProcessingActive('completed'), false);
assert.equal(isTenderProcessingActive('no_job'), false);

assert.equal(shouldReloadTenderArtifacts(null, status('completed'), null), false, 'initial load already fetches persisted artifacts');
assert.equal(shouldReloadTenderArtifacts(status('analyzing'), status('completed'), null), true);
assert.equal(shouldReloadTenderArtifacts(status('analyzing'), status('completed'), 'job-1'), false, 'same job reloads once');
assert.equal(shouldReloadTenderArtifacts(status('analyzing', 'job-2'), status('completed', 'job-2'), 'job-1'), true, 'a new job may reload after its own transition');
assert.equal(shouldReloadTenderArtifacts(status('analyzing'), status('completed', 'job-2'), null), false, 'different jobs are not a transition');
assert.equal(shouldReloadTenderArtifacts(status('completed'), status('completed'), null), false);

assert.match(tenderProcessingLabel('queued'), /En cola/);
assert.match(tenderProcessingLabel('waiting_agent_capacity'), /Vig-IA/);
assert.match(tenderProcessingLabel('needs_attention'), /intervención humana/);
assert.match(tenderProcessingLabel('completed'), /completado/);
assert.match(tenderProcessingLabel('unknown_state'), /unknown_state/);

// deriveTenderProcessingPresentation collapses the durable job plus the current analysis into
// the single body signal TenderAnalysisSection may show: never raw counts/step/ids, never a
// duplicate CTA, and exactly one Reintentar action when the job is stuck and retryable.
const job = (overrides = {}) => ({ job_id: 'job-1', status: 'queued', idempotency_key: 'idem-1', updated_at: '2026-08-05T10:00:00.000Z', ...overrides });
const canonicalAnalysis = { run_id: 'run-old', status: 'completed', current: true, completed_at: '2026-08-01T00:00:00.000Z' };

for (const hidden of ['no_job', 'completed', 'cancelled']) {
  const presentation = deriveTenderProcessingPresentation(job({ status: hidden }), null);
  assert.equal(presentation.visible, false, `${hidden} no debe mostrar una señal durable.`);
  assert.equal(presentation.message, '', `${hidden} no debe dejar un mensaje residual.`);
  assert.equal(presentation.primaryAction, 'normal', `${hidden} no debe deshabilitar la acción de Vig-IA.`);
}
assert.equal(deriveTenderProcessingPresentation(null, null).visible, false, 'Sin job durable no hay señal.');

{
  // A stale wait/retry superseded by a later canonical analysis must stay hidden too.
  const superseded = job({ status: 'waiting_agent_capacity', updated_at: '2026-07-01T00:00:00.000Z' });
  assert.equal(deriveTenderProcessingPresentation(superseded, canonicalAnalysis).visible, false, 'Un job superado por análisis vigente no debe mostrar señal.');
}

{
  const waiting = deriveTenderProcessingPresentation(job({ status: 'waiting_agent_capacity' }), null);
  assert.equal(waiting.visible, true);
  assert.equal(waiting.tone, 'status');
  assert.match(waiting.message, /Vig-IA está esperando capacidad/, 'Debe usar el mensaje humano estable de espera de capacidad.');
  assert.match(waiting.message, /continuará automáticamente/, 'Debe aclarar que continuará automáticamente.');
  assert.equal(waiting.primaryAction, 'disabled', 'No debe permitir una corrida duplicada mientras está en cola.');
  assert.equal(waiting.showRetry, false, 'No debe ofrecer un botón de reintento mientras espera capacidad.');
}

for (const active of ['queued', 'discovering_documents', 'importing_documents', 'building_snapshot', 'analyzing']) {
  const presentation = deriveTenderProcessingPresentation(job({ status: active }), null);
  assert.equal(presentation.visible, true, `${active} debe mostrar una señal única.`);
  assert.equal(presentation.tone, 'status');
  assert.ok(presentation.message.length > 0, `${active} debe traer un mensaje humano.`);
  assert.doesNotMatch(presentation.message, /\d/, `${active} no debe filtrar conteos internos en el mensaje.`);
  assert.equal(presentation.primaryAction, 'disabled', `${active} debe deshabilitar la acción que crearía una corrida duplicada.`);
  assert.equal(presentation.showRetry, false, `${active} no es reintentable manualmente.`);
}

{
  const retryable = deriveTenderProcessingPresentation(job({ status: 'retry_wait', idempotency_key: 'idem-1' }), null);
  assert.equal(retryable.visible, true);
  assert.equal(retryable.primaryAction, 'hidden', 'Debe quedar exactamente una acción: Reintentar.');
  assert.equal(retryable.showRetry, true, 'Debe ofrecer Reintentar cuando existe idempotency_key.');
  const withoutKey = deriveTenderProcessingPresentation(job({ status: 'retry_wait', idempotency_key: null }), null);
  assert.equal(withoutKey.showRetry, false, 'Sin idempotency_key no puede ofrecer un reintento accionable.');
  assert.equal(withoutKey.primaryAction, 'hidden', 'Aun sin reintento accionable no debe reaparecer una acción de análisis duplicada.');
}

{
  const attention = deriveTenderProcessingPresentation(job({ status: 'needs_attention', idempotency_key: 'idem-1' }), null);
  assert.equal(attention.visible, true);
  assert.equal(attention.tone, 'error', 'needs_attention debe anunciarse como error accesible.');
  assert.equal(attention.primaryAction, 'hidden');
  assert.equal(attention.showRetry, true);
  const withoutKey = deriveTenderProcessingPresentation(job({ status: 'needs_attention', idempotency_key: null }), null);
  assert.equal(withoutKey.showRetry, false);
}

console.log('tender processing UI status helper contract passed');

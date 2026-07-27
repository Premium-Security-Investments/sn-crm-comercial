import { strict as assert } from 'node:assert';
import { logPipelineEvent, deriveJobMetrics, pipelineAlerts } from '../tender-pipeline-observability.js';

function captureLog(fn) {
  const original = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

// logPipelineEvent: whitelist estricta; claves peligrosas se descartan en silencio.
{
  const lines = captureLog(() => logPipelineEvent('document_imported', {
    job_id: 'job-1',
    tender_id: 'tender-1',
    code: 'OK',
    status: 'importing_documents',
    current_step: 'documents',
    latency_ms: 120,
    attempt_count: 1,
    documents_imported: 38,
    documents_failed: 2,
    extracted_text: 'contenido sensible del documento',
    prompt: 'instrucciones del modelo',
    hmac: 'deadbeef',
    token: 'secret-token',
    result: { raw: 'respuesta cruda del proveedor' },
  }));
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, 'document_imported');
  assert.equal(parsed.job_id, 'job-1');
  assert.equal(parsed.documents_imported, 38);
  assert.equal(parsed.documents_failed, 2);
  assert.equal('extracted_text' in parsed, false);
  assert.equal('prompt' in parsed, false);
  assert.equal('hmac' in parsed, false);
  assert.equal('token' in parsed, false);
  assert.equal('result' in parsed, false);
}

// deriveJobMetrics: agrupa por estado y detecta lease expirado / stale analysis / fallback en automático.
{
  const now = 1_000_000;
  const jobs = [
    { id: 'j1', status: 'importing_documents', created_at: new Date(now - 10_000).toISOString(), lease_expires_at: new Date(now - 5_000).toISOString() },
    { id: 'j2', status: 'needs_attention', created_at: new Date(now - 7_200_000).toISOString(), lease_expires_at: null },
    { id: 'j3', status: 'completed', created_at: new Date(now - 1_000).toISOString(), analysis_producer: 'AGT-002', analysis_run_snapshot_id: 'snap-a', current_snapshot_id: 'snap-a' },
    { id: 'j4', status: 'completed', created_at: new Date(now - 1_000).toISOString(), analysis_producer: 'siio_rules_v1', automatic: true, fallback_shown: true },
    { id: 'j5', status: 'completed', created_at: new Date(now - 1_000).toISOString(), analysis_producer: 'AGT-002', analysis_run_snapshot_id: 'snap-old', current_snapshot_id: 'snap-new' },
  ];
  const metrics = deriveJobMetrics(jobs, now);
  assert.equal(metrics.by_status.importing_documents, 1);
  assert.equal(metrics.by_status.needs_attention, 1);
  assert.equal(metrics.by_status.completed, 3);
  assert.equal(metrics.lease_expired_count, 1);
  assert.equal(metrics.agt002_run_count, 2);
  assert.equal(metrics.rules_run_count, 1);
  assert.deepEqual(metrics.stale_analysis_job_ids, ['j5']);
  assert.equal(metrics.automatic_rules_fallback_count, 1);
  assert.equal(metrics.total_jobs, 5);
  const j2Active = metrics.active_jobs.find(j => j.id === 'j2');
  assert.ok(j2Active);
  assert.equal(j2Active.age_ms, 7_200_000);

  // pipelineAlerts: stalled_job cuando la antigüedad supera el umbral.
  const alerts = pipelineAlerts(metrics, { stalledJobAgeMs: 3_600_000, expectingAgt002Runs: true });
  const stalled = alerts.find(a => a.type === 'stalled_job');
  assert.ok(stalled);
  assert.deepEqual(stalled.job_ids, ['j2']);

  const needsAttention = alerts.find(a => a.type === 'needs_attention');
  assert.ok(needsAttention);
  assert.equal(needsAttention.count, 1);

  // rules_fallback_in_auto cuando un flujo automático mostró reglas.
  const rulesFallback = alerts.find(a => a.type === 'rules_fallback_in_auto');
  assert.ok(rulesFallback);
  assert.equal(rulesFallback.count, 1);

  const staleAnalysis = alerts.find(a => a.type === 'stale_analysis');
  assert.ok(staleAnalysis);
  assert.deepEqual(staleAnalysis.job_ids, ['j5']);
}

// pipelineAlerts: zero_agt002_runs y bridge_unhealthy son señales explícitas por umbral/estado, no adivinadas.
{
  const metrics = deriveJobMetrics([], 0);
  const alerts = pipelineAlerts(metrics, { expectingAgt002Runs: true, bridgeHealthy: false });
  assert.ok(alerts.some(a => a.type === 'zero_agt002_runs'));
  assert.ok(alerts.some(a => a.type === 'bridge_unhealthy'));
}

// Sin umbrales alcanzados, no hay alertas.
{
  const now = 1_000;
  const jobs = [{ id: 'ok', status: 'importing_documents', created_at: new Date(now - 10).toISOString() }];
  const metrics = deriveJobMetrics(jobs, now);
  const alerts = pipelineAlerts(metrics, { stalledJobAgeMs: 3_600_000 });
  assert.deepEqual(alerts, []);
}

console.log('tender-pipeline-observability contract passed');

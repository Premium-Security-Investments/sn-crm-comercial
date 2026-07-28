import { strict as assert } from 'node:assert';
import { createTenderProcessingWorker } from '../tender-processing-worker.js';

function makeDeps(overrides = {}) {
  const calls = {
    updateJob: [],
    recordImportItem: [],
    appendEvent: [],
    requestAgt002: [],
    publishSnapshot: [],
    discoverDocuments: [],
  };
  let clock = 0;
  const deps = {
    claimJob: async () => null,
    updateJob: async (jobId, leaseId, patch) => { calls.updateJob.push({ jobId, leaseId, patch }); },
    recordImportItem: async (item) => { calls.recordImportItem.push(item); },
    appendEvent: async (event) => { calls.appendEvent.push(event); },
    revalidateOfficialStatus: async () => ({ terminal: false }),
    discoverDocuments: async (args) => { calls.discoverDocuments.push(args); return []; },
    importOneDocument: async () => ({ status: 'imported', hasText: true }),
    publishSnapshot: async (args) => { calls.publishSnapshot.push(args); return { id: 'snap-1' }; },
    requestAgt002: async (args) => { calls.requestAgt002.push(args); return { status: 'quota' }; },
    now: () => clock,
    ...overrides,
  };
  return { deps, calls, advanceClock: (ms) => { clock += ms; } };
}

async function run() {
  // 1) job en queued con estado oficial terminal -> cancelled, evento cancelled, requestAgt002 NO llamado.
  {
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-1', lease_id: 'lease-1', tender_id: 'tender-1', opportunity_id: 'opp-1',
        status: 'queued', current_step: 'documents',
      }),
      revalidateOfficialStatus: async () => ({ terminal: true, status: 'cancelled' }),
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({});
    assert.equal(result.status, 'cancelled');
    assert.equal(calls.updateJob.length, 1);
    assert.equal(calls.updateJob[0].patch.status, 'cancelled');
    assert.equal(calls.appendEvent.length, 1);
    assert.equal(calls.appendEvent[0].eventType, 'cancelled');
    assert.equal(calls.requestAgt002.length, 0);
  }

  // 2) job importing_documents con 5 docs y batchSize:2 -> procesa 2, deja el resto pending, incrementa documents_processed.
  {
    const pending = Array.from({ length: 5 }, (_, i) => ({ source: 'SECOP II', sourceDocumentId: `d${i}`, name: `Doc ${i}`, critical: false }));
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-2', lease_id: 'lease-2', tender_id: 'tender-2', opportunity_id: 'opp-2',
        status: 'importing_documents', current_step: 'documents',
        documents_discovered: 5, documents_processed: 0, documents_imported: 0, documents_unchanged: 0, documents_failed: 0,
        pending_documents: pending,
      }),
      importOneDocument: async () => ({ status: 'imported', hasText: true }),
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({ batchSize: 2 });
    assert.equal(result.status, 'batch_processed');
    assert.equal(result.remaining, 3);
    assert.equal(calls.recordImportItem.length, 2);
    assert.equal(calls.updateJob.length, 1);
    assert.equal(calls.updateJob[0].patch.documents_processed, 2);
    assert.equal(calls.updateJob[0].patch.status, 'importing_documents');
  }

  // 3) importOneDocument lanza error retryable -> item failed_retryable con next_attempt_at; job NO needs_attention aún.
  {
    const pending = [{ source: 'SECOP II', sourceDocumentId: 'd1', name: 'Pliego', critical: false }];
    const err = new Error('timeout'); err.code = 'AGT002_CODEX_TIMEOUT';
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-3', lease_id: 'lease-3', tender_id: 'tender-3', opportunity_id: 'opp-3',
        status: 'importing_documents', current_step: 'documents',
        documents_discovered: 1, documents_processed: 0, documents_imported: 0, documents_unchanged: 0, documents_failed: 0,
        pending_documents: pending,
      }),
      importOneDocument: async () => { throw err; },
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({ batchSize: 3 });
    assert.equal(calls.recordImportItem.length, 1);
    assert.equal(calls.recordImportItem[0].status, 'failed_retryable');
    assert.ok(calls.recordImportItem[0].nextAttemptAt);
    assert.equal(calls.updateJob[0].patch.status, 'importing_documents');
    assert.notEqual(result.status, 'needs_attention');
  }

  // 3b) un fallo crítico terminal quedó persistido en un batch anterior
  //     (claim.any_critical_terminal_failure); el batch final del mismo job
  //     sí importa un documento con texto. El job NUNCA puede pasar a
  //     ready_for_snapshot solo porque el ÚLTIMO batch tuvo éxito local:
  //     un fallo crítico no puede excluirse silenciosamente (Bucaramanga LPR,
  //     job 374195eb).
  {
    const pending = [{ source: 'SECOP II', sourceDocumentId: 'd2', name: 'Anexo Precios.xlsx', critical: false }];
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-3b', lease_id: 'lease-3b', tender_id: 'tender-3b', opportunity_id: 'opp-3b',
        status: 'importing_documents', current_step: 'documents',
        documents_discovered: 2, documents_processed: 1, documents_imported: 0, documents_unchanged: 0, documents_failed: 1,
        pending_documents: pending,
        any_usable_text: false,
        any_critical_terminal_failure: true,
      }),
      importOneDocument: async () => ({ status: 'imported', hasText: true }),
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({ batchSize: 3 });
    assert.equal(result.status, 'needs_attention', 'un fallo crítico de un batch anterior debe bloquear el snapshot aunque el batch final importe con éxito');
    assert.equal(calls.updateJob[0].patch.status, 'needs_attention');
  }

  // 3c) simétricamente: el batch final no logra texto usable por sí solo,
  //     pero un batch anterior ya dejó evidencia usable (claim.any_usable_text)
  //     y no hay fallos críticos en ningún batch -> el job SÍ debe avanzar
  //     a ready_for_snapshot en vez de quedar needs_attention por accidente
  //     de orden de batch.
  {
    const err = new Error('texto no verificable'); err.code = 'TENDER_DOC_EMPTY_TEXT';
    const pending = [{ source: 'SECOP II', sourceDocumentId: 'd3', name: 'Formato menor.pdf', critical: false }];
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-3c', lease_id: 'lease-3c', tender_id: 'tender-3c', opportunity_id: 'opp-3c',
        status: 'importing_documents', current_step: 'documents',
        documents_discovered: 2, documents_processed: 1, documents_imported: 1, documents_unchanged: 0, documents_failed: 0,
        pending_documents: pending,
        any_usable_text: true,
        any_critical_terminal_failure: false,
      }),
      importOneDocument: async () => { throw err; },
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({ batchSize: 3 });
    assert.equal(result.status, 'ready_for_snapshot', 'evidencia usable de un batch anterior no puede perderse por un batch final sin éxito local');
    assert.equal(calls.updateJob[0].patch.status, 'ready_for_snapshot');
  }

  // 4) snapshot utilizable -> publishSnapshot llamado y evento snapshot_published.
  {
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-4', lease_id: 'lease-4', tender_id: 'tender-4', opportunity_id: 'opp-4',
        status: 'ready_for_snapshot', current_step: 'snapshot',
        analysis_authorized_by: null,
      }),
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({});
    assert.equal(result.status, 'snapshot_published');
    assert.equal(calls.publishSnapshot.length, 1);
    assert.equal(calls.appendEvent.length, 1);
    assert.equal(calls.appendEvent[0].eventType, 'snapshot_published');
    assert.equal(calls.updateJob[0].patch.snapshot_id, 'snap-1');
    // Sin autorización previa, el paso IA queda pendiente de autorización humana, no en curso.
    assert.equal(calls.updateJob[0].patch.status, 'awaiting_analysis_authorization');
  }

  // 5) capacidad 'quota' -> requestAgt002 retorna {status:'quota'} -> job waiting_agent_capacity;
  //    status nunca pasa a 'completed' por reglas (no fallback silencioso).
  {
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-5', lease_id: 'lease-5', tender_id: 'tender-5', opportunity_id: 'opp-5',
        status: 'waiting_agent_capacity', current_step: 'analysis', snapshot_id: 'snap-5',
      }),
      requestAgt002: async () => ({ status: 'quota' }),
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({});
    assert.equal(result.status, 'waiting_agent_capacity');
    assert.equal(calls.updateJob[0].patch.status, 'waiting_agent_capacity');
    assert.notEqual(calls.updateJob[0].patch.status, 'completed');
  }

  // 6) preanálisis por reglas mostrado -> nunca completa el pipeline (evento visible, sin fallback silencioso).
  {
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-6', lease_id: 'lease-6', tender_id: 'tender-6', opportunity_id: 'opp-6',
        status: 'waiting_agent_capacity', current_step: 'analysis', snapshot_id: 'snap-6',
      }),
      requestAgt002: async () => ({ status: 'rules_fallback' }),
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({});
    assert.notEqual(result.status, 'completed');
    assert.notEqual(calls.updateJob[0].patch.status, 'completed');
    assert.ok(calls.appendEvent.some(e => e.eventType === 'analysis_rules_fallback_shown'));
  }

  // 7) analysis run real completado -> job completed, evento analysis_completed.
  {
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-7', lease_id: 'lease-7', tender_id: 'tender-7', opportunity_id: 'opp-7',
        status: 'waiting_agent_capacity', current_step: 'analysis', snapshot_id: 'snap-7',
      }),
      requestAgt002: async () => ({ status: 'completed', analysisRunId: 'run-7' }),
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({});
    assert.equal(result.status, 'completed');
    assert.equal(calls.updateJob[0].patch.status, 'completed');
    assert.equal(calls.updateJob[0].patch.analysis_run_id, 'run-7');
    assert.ok(calls.appendEvent.some(e => e.eventType === 'analysis_completed'));
  }

  // 8) sin trabajo reclamable -> no-op, ninguna dependencia de escritura invocada.
  {
    const { deps, calls } = makeDeps({ claimJob: async () => null });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({});
    assert.equal(result.status, 'empty');
    assert.equal(calls.updateJob.length, 0);
    assert.equal(calls.appendEvent.length, 0);
  }

  // 9) toda escritura de estado pasa el lease_id recibido del claim.
  {
    const { deps, calls } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-9', lease_id: 'lease-9-xyz', tender_id: 'tender-9', opportunity_id: 'opp-9',
        status: 'ready_for_snapshot', current_step: 'snapshot',
      }),
    });
    const worker = createTenderProcessingWorker(deps);
    await worker.runOnce({});
    assert.ok(calls.updateJob.every(c => c.leaseId === 'lease-9-xyz'));
  }

  // 10) batchSize por defecto (sin especificar) = 1 documento por invocación.
  // Cada descarga oficial puede tardar hasta el timeout de red pinneada
  // (safe-official-fetch.js: 20s, hasta ~80s con la cadena de redirects
  // permitida) y el worker solo revisa el presupuesto de tiempo ANTES de
  // iniciar cada documento del lote, nunca a mitad de una descarga. Encolar
  // varios documentos por invocación (batchSize>1) arriesga exceder tanto el
  // timeBudgetMs del propio worker como el límite duro de la plataforma
  // (vercel.json api/[...path].js maxDuration=60s). Un documento por
  // invocación es la corrección mínima durable.
  {
    const pending = Array.from({ length: 3 }, (_, i) => ({ source: 'SECOP II', sourceDocumentId: `d${i}`, name: `Doc ${i}`, critical: false }));
    const { deps, calls, advanceClock } = makeDeps({
      claimJob: async () => ({
        job_id: 'job-10', lease_id: 'lease-10', tender_id: 'tender-10', opportunity_id: 'opp-10',
        status: 'importing_documents', current_step: 'documents',
        documents_discovered: 3, documents_processed: 0, documents_imported: 0, documents_unchanged: 0, documents_failed: 0,
        pending_documents: pending,
      }),
      // Simulates a realistic slow official-source download: each document
      // burns a third of the worker's time budget, well under any single
      // per-document network timeout.
      importOneDocument: async () => { advanceClock(20_000); return { status: 'imported', hasText: true }; },
    });
    const worker = createTenderProcessingWorker(deps);
    const result = await worker.runOnce({ timeBudgetMs: 45_000 });
    assert.equal(result.status, 'batch_processed');
    assert.equal(calls.recordImportItem.length, 1, 'debe importar como máximo un documento por invocación por defecto');
    assert.equal(result.remaining, 2);
  }

  console.log('tender-processing-worker contract passed');
}

run();

import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const processingStatusPath = new URL('../src/tenders/processingStatus.ts', import.meta.url);
const bundle = buildSync({ entryPoints: [processingStatusPath.pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const processingStatusUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const processing = await import(processingStatusUrl);
assert.equal(typeof processing.isTenderProcessingSuperseded, 'function', 'Debe existir una regla de presentación comprobable por comportamiento.');

const analysis = (overrides = {}) => ({
  run_id: 'run-new',
  snapshot_id: 'snapshot-new',
  status: 'completed',
  current: true,
  completed_at: '2026-08-04T19:25:26.000Z',
  ...overrides,
});
const job = (overrides = {}) => ({
  job_id: 'job-old',
  status: 'waiting_agent_capacity',
  snapshot_id: 'snapshot-old',
  analysis_run_id: null,
  updated_at: '2026-08-04T19:20:00.000Z',
  ...overrides,
});

assert.equal(processing.isTenderProcessingSuperseded(job(), analysis()), true, 'Una espera antigua queda superada por un análisis canónico posterior.');
assert.equal(processing.isTenderProcessingSuperseded(job({ status: 'retry_wait' }), analysis()), true, 'Un reintento antiguo queda superado por un análisis posterior.');
assert.equal(processing.isTenderProcessingSuperseded(job({ status: 'analyzing' }), analysis()), false, 'Una ejecución real de análisis nunca debe ocultarse.');
assert.equal(processing.isTenderProcessingSuperseded(job({ status: 'importing_documents' }), analysis()), false, 'Una importación realmente activa nunca debe ocultarse.');
assert.equal(processing.isTenderProcessingSuperseded(job({ updated_at: '2026-08-04T19:30:00.000Z' }), analysis()), false, 'Una espera más nueva que el análisis debe seguir visible.');
assert.equal(processing.isTenderProcessingSuperseded(job({ snapshot_id: 'snapshot-new', updated_at: '2026-08-04T19:30:00.000Z' }), analysis()), false, 'Compartir snapshot no puede ocultar un job más nuevo.');
assert.equal(processing.isTenderProcessingSuperseded(job({ analysis_run_id: 'run-new', updated_at: null }), analysis({ completed_at: null, created_at: null, generated_at: null })), true, 'El mismo run completado es evidencia suficiente aunque falten fechas.');
assert.equal(processing.isTenderProcessingSuperseded(job({ updated_at: null }), analysis({ completed_at: null, created_at: null, generated_at: null })), false, 'Fechas faltantes deben fallar seguro mostrando el aviso.');
assert.equal(processing.isTenderProcessingSuperseded(job({ updated_at: 'fecha-invalida' }), analysis()), false, 'Una fecha inválida del job debe fallar seguro.');
assert.equal(processing.isTenderProcessingSuperseded(job(), analysis({ current: false })), false, 'Un análisis no vigente no puede superar el job.');
assert.equal(processing.isTenderProcessingSuperseded(job(), analysis({ status: 'failed' })), false, 'Un análisis fallido no puede superar el job.');

console.log('tender processing supersession behavior checks passed');

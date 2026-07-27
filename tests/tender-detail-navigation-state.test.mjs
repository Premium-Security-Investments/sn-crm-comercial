import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/detailNavigationState.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { resolveTenderDetailIndicators } = await import(url);

const loading = { phase: 'loading' };
const base = {
  documents: loading,
  analysis: loading,
  decision: loading,
  preparation: loading,
  followUp: { code: 'closed', label: 'Cerrada', detail: 'No requiere próxima gestión' },
};
const resolve = overrides => resolveTenderDetailIndicators({ ...base, ...overrides });

assert.equal(resolve({})['tender-summary'], undefined);
assert.deepEqual(resolve({ documents: { phase: 'ready', value: { currentDocumentCount: 2, importError: false } } })['tender-document-review'], { tone: 'ready', label: 'Documentos vigentes' });
assert.equal(resolve({ documents: { phase: 'ready', value: { currentDocumentCount: 0, importError: false } } })['tender-document-review'].tone, 'unknown');
assert.equal(resolve({ documents: { phase: 'ready', value: { currentDocumentCount: 2, importError: true } } })['tender-document-review'].tone, 'error');
assert.equal(resolve({ documents: { phase: 'error', message: 'falló' } })['tender-document-review'].tone, 'error');
assert.deepEqual(resolve({ documents: { phase: 'pending', label: 'Importación en curso' } })['tender-document-review'], { tone: 'attention', label: 'Importación en curso' });

const currentAnalysis = { status: 'completed', current: true, critical_open_count: 0, run_id: 'r1', snapshot_id: 's1', producer: 'siio_rules_v1', method: 'rules' };
assert.deepEqual(resolve({ analysis: { phase: 'ready', value: currentAnalysis } })['tender-analysis'], { tone: 'ready', label: 'Análisis vigente' });
assert.equal(resolve({ analysis: { phase: 'ready', value: { ...currentAnalysis, current: false } } })['tender-analysis'].tone, 'attention');
assert.equal(resolve({ analysis: { phase: 'ready', value: { ...currentAnalysis, status: 'failed' } } })['tender-analysis'].tone, 'error');
assert.equal(resolve({ analysis: { phase: 'ready', value: null } })['tender-analysis'].tone, 'unknown');

const go = { id: 'd1', opportunity_id: 'o1', tender_id: 't1', decision: 'go', analysis_interaction_id: null, analysis_run_id: 'r1', justification: null, decided_by: 'u1', decided_at: '2026-07-27T12:00:00Z' };
const noGo = { ...go, id: 'd2', decision: 'no_go' };
assert.deepEqual(resolve({ decision: { phase: 'ready', value: go } })['tender-decision'], { tone: 'ready', label: 'GO autorizado' });
assert.deepEqual(resolve({ decision: { phase: 'ready', value: noGo } })['tender-decision'], { tone: 'ready', label: 'NO GO autorizado' });
assert.equal(resolve({ analysis: { phase: 'ready', value: currentAnalysis }, decision: { phase: 'ready', value: null } })['tender-decision'].tone, 'attention');

assert.equal(resolve({ preparation: { phase: 'error', message: 'falló' } })['tender-preparation'].tone, 'error');
assert.equal(resolve({ preparation: { phase: 'ready', value: { preparationStatus: null, decision: 'go', humanPendingCount: 0 } } })['tender-preparation'].tone, 'attention');
assert.equal(resolve({ preparation: { phase: 'ready', value: { preparationStatus: 'en_preparacion', decision: 'go', humanPendingCount: 0 } } })['tender-preparation'].tone, 'ready');
assert.equal(resolve({ preparation: { phase: 'ready', value: { preparationStatus: 'en_preparacion', decision: 'go', humanPendingCount: 2 } } })['tender-preparation'].tone, 'attention');
assert.equal(resolve({ preparation: { phase: 'ready', value: { preparationStatus: null, decision: 'no_go', humanPendingCount: 0 } } })['tender-preparation'].tone, 'unknown');

assert.equal(resolve({ followUp: { code: 'overdue', label: 'Vencida', detail: '1 día vencida' } })['tender-follow-up'].tone, 'error');
assert.equal(resolve({ followUp: { code: 'today', label: 'Hoy', detail: 'Gestionar hoy' } })['tender-follow-up'].tone, 'attention');
assert.equal(resolve({ followUp: { code: 'scheduled', label: 'Agendada', detail: '31 jul 2026' } })['tender-follow-up'].tone, 'ready');
assert.equal(resolve({ followUp: { code: 'closed', label: 'Cerrada', detail: 'No aplica' } })['tender-follow-up'].tone, 'unknown');

console.log('tender detail navigation state passed');

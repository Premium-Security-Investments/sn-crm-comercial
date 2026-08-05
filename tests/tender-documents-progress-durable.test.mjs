import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');

assert.match(types, /export type TenderProcessingStatus =/, 'Debe existir un tipo para el estado durable');
const start = main.indexOf('function TenderDocumentReviewPanel(');
const end = main.indexOf('\nfunction TenderOfferPreparationPanel(', start);
assert.ok(start >= 0 && end > start, 'Debe existir TenderDocumentReviewPanel');
const block = main.slice(start, end);
assert.match(block, /api<TenderProcessingStatus>\(`\/api\/tender-processing-status\?opportunity_id=/, 'Debe consultar el estado durable');
assert.match(block, /'\/api\/tender-processing-retry'/, 'Debe usar el endpoint de reintento');
assert.match(block, /idempotency_key: processingStatus\.idempotency_key/, 'El reintento debe usar la clave durable exacta');

// The coordinator only fetches and forwards the durable status now; TenderAnalysisSection
// owns the single consolidated presentation (no separate technical banner in this panel).
assert.match(block, /processingStatus=\{processingStatus\}/, 'El estado durable debe entregarse a la sección de análisis, exista o no analysis.');
assert.match(block, /onRetryProcessing=\{[^}]*retryDurableProcessing/, 'El reintento debe dispararse desde la señal única de TenderAnalysisSection.');
for (const forbidden of ['processingStatus.counts.processed', 'processingStatus.counts.discovered', 'processingStatus.failed_items.map', 'tender-processing-technical', '>Reintentar<']) {
  assert.ok(!block.includes(forbidden), `TenderDocumentReviewPanel no debe volver a renderizar directamente: ${forbidden}`);
}
assert.doesNotMatch(block, /processingStatus[\s\S]{0,300}(progress|%)/i, 'No debe inventar barra o porcentaje de progreso');

console.log('tender documents durable progress contract passed');

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
assert.match(block, /Procesando documentos en segundo plano/, 'Debe explicar el procesamiento asíncrono');
assert.match(block, /processingStatus\.counts\.processed/, 'Debe mostrar conteos reales procesados');
assert.match(block, /processingStatus\.counts\.discovered/, 'Debe mostrar conteos reales descubiertos');
assert.match(block, /processingStatus\.failed_items\.map/, 'Debe mostrar errores por ítem');
assert.match(block, /'\/api\/tender-processing-retry'/, 'Debe usar el endpoint de reintento');
assert.match(block, /idempotency_key: processingStatus\.idempotency_key/, 'El reintento debe usar la clave durable exacta');
assert.match(block, />Reintentar</, 'Debe ofrecer una acción Reintentar');
assert.doesNotMatch(block, /processingStatus[\s\S]{0,300}(progress|%)/i, 'No debe inventar barra o porcentaje de progreso');

console.log('tender documents durable progress contract passed');

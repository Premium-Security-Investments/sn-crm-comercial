import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

for (const relative of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const start = source.indexOf("app.get('/api/tender-processing-status'");
  const end = source.indexOf("app.post('/api/tender-processing-retry'", start);
  assert.ok(start >= 0 && end > start, `${relative}: falta endpoint de estado`);
  const block = source.slice(start, end);
  assert.match(block, /idempotency_key/, `${relative}: el estado debe entregar la clave necesaria para reintentar`);
  assert.match(block, /psi_tender_document_import_items/, `${relative}: el estado debe leer errores por documento`);
  assert.match(block, /failed_retryable/, `${relative}: debe incluir fallos reintentables`);
  assert.match(block, /failed_terminal/, `${relative}: debe incluir fallos terminales`);
  assert.match(block, /failed_items/, `${relative}: debe exponer una lista de ítems fallidos`);
}

console.log('tender processing status item errors contract passed');

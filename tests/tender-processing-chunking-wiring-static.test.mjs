import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const serverBuffer = readFileSync(new URL('../server/index.js', import.meta.url));
const apiBuffer = readFileSync(new URL('../api/[...path].js', import.meta.url));

function extractFunctionBody(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `no se encontró ${functionName} en el archivo`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`no se pudo balancear el cuerpo de ${functionName}`);
}

function assertBackend(source, label) {
  assert.ok(source.includes("import { createTenderProcessingWorker } from '../tender-processing-worker.js';"), `${label}: falta el import del worker durable`);
  assert.ok(source.includes('recordTenderDocumentChunk'), `${label}: falta el wrapper RPC psi_record_tender_document_chunk`);
  assert.ok(source.includes("from '../agt002-document-chunks.js'") && source.includes('buildAgt002DocumentChunks'), `${label}: falta el chunker puro del contrato Task 23`);

  const body = extractFunctionBody(source, 'buildTenderProcessingWorkerDeps');

  assert.ok(/chunkDocuments\s*:/.test(body), `${label}: buildTenderProcessingWorkerDeps no inyecta chunkDocuments al worker`);
  assert.ok(body.includes('buildAgt002DocumentChunks('), `${label}: chunkDocuments no usa el chunker puro Task 23`);
  assert.ok(body.includes('recordTenderDocumentChunk('), `${label}: chunkDocuments no persiste vía psi_record_tender_document_chunk`);
  assert.ok(body.includes('snapshotId'), `${label}: chunkDocuments debe recibir/usar snapshotId para ligar los chunks al snapshot`);
  assert.ok(/failed_terminal/.test(body), `${label}: chunkDocuments no cubre los import items failed_terminal como gap explícito`);

  // Regresión del techo histórico agt002-preview-input.js (12 documentos / 3000
  // caracteres): la nueva fase de chunking no debe reintroducirlo.
  assert.ok(!body.includes('AGT002_MAX_DOCUMENTS'), `${label}: chunkDocuments no debe reintroducir el techo de 12 documentos`);
  assert.ok(!body.includes('AGT002_MAX_DOCUMENT_CHARS'), `${label}: chunkDocuments no debe reintroducir el techo de 3000 caracteres`);

  // server/index.js debe pasar la dependencia real al worker (no dejarla huérfana).
  const wiringStart = source.indexOf('function buildTenderProcessingWorkerDeps');
  assert.ok(wiringStart >= 0);
  assert.ok(
    source.slice(0, wiringStart).includes('createTenderProcessingWorker(buildTenderProcessingWorkerDeps(database))')
    || source.slice(wiringStart).includes('createTenderProcessingWorker(buildTenderProcessingWorkerDeps(database))'),
    `${label}: buildTenderProcessingWorkerDeps debe seguir usándose para construir el worker`,
  );
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  console.log('tender-processing-chunking-wiring-static passed');
}
run();

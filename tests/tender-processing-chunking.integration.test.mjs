import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { createTenderProcessingWorker } from '../tender-processing-worker.js';
import { buildAgt002DocumentChunks } from '../agt002-document-chunks.js';
import { AGT002_MAX_DOCUMENTS, AGT002_MAX_DOCUMENT_CHARS } from '../agt002-preview-input.js';

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

// 14 documents mirrors the audited Manizales case referenced by the plan: the historical
// evidence-preparation ceiling (agt002-preview-input.js) allowed at most 12 documents and
// 3,000 chars each. This chunking phase must NOT inherit that ceiling. Of the 14: 11 import
// cleanly, one addendum takes precedence over the base documents, one imports but is
// illegible/empty, and one never imports at all (failed_terminal) — both gap kinds must
// surface as explicit, safe gaps ({document_id, reason}, no extracted text or error text).
function buildFourteenDocumentFixture() {
  const documents = [];
  const types = ['pliego', 'estudios_previos', 'anexo_tecnico', 'formatos', 'otro'];
  for (let i = 1; i <= 11; i += 1) {
    const documentType = types[i % types.length];
    const longText = i === 1
      ? `Objeto del contrato ${i}: vigilancia física y electrónica. ${'Cláusula relevante repetida para exceder el límite histórico. '.repeat(80)}`
      : i === 2
        ? 'Página uno, sección uno con alcance técnico.\n\nPágina uno, sección dos con requisitos habilitantes.\fPágina dos, sección uno con condiciones económicas.'
        : `Documento ${i} (${documentType}): contenido íntegro con evidencia relevante para el proceso de licitación número ${i}.`;
    documents.push({
      document_id: `doc-${String(i).padStart(2, '0')}`,
      document_version_id: `ver-${String(i).padStart(2, '0')}`,
      opportunity_id: 'opp-manizales',
      snapshot_id: null,
      document_type: documentType,
      name: `Documento ${i}.pdf`,
      version: 1,
      content_hash: hash(`doc-${i}-v1`),
      current: true,
      extracted_text: longText,
    });
  }
  // Document 12: an addendum that must take explicit precedence over the base documents
  // without erasing them — both remain chunked and citable.
  documents.push({
    document_id: 'doc-12', document_version_id: 'ver-12', opportunity_id: 'opp-manizales', snapshot_id: null,
    document_type: 'adenda', name: 'Adenda 1.pdf', version: 1, current: true,
    content_hash: hash('doc-12-v1'),
    extracted_text: 'La adenda modifica el plazo de ejecución del contrato original.',
  });
  // Document 13: illegible/empty extraction must become an explicit gap, not a fabricated chunk.
  documents.push({
    document_id: 'doc-13', document_version_id: 'ver-13', opportunity_id: 'opp-manizales', snapshot_id: null,
    document_type: 'otro', name: 'Documento 13.pdf', version: 1, current: true,
    content_hash: hash('doc-13-v1'), extracted_text: '   ',
  });
  // Document 14: never imported at all (import item failed_terminal). It has no
  // document_version_id, so it can never reach the pure chunker — the real adapter must
  // still surface it as an explicit, safe gap alongside the illegible one.
  const failedTerminalItem = {
    source_document_id: 'doc-14', name: 'Documento 14.pdf', status: 'failed_terminal',
    last_error_code: 'TENDER_DOC_SOURCE_UNAVAILABLE', last_error_message: 'detalle sensible que nunca debe filtrarse',
  };
  return { documents, failedTerminalItem };
}

function makeChunkPersistenceFake(documents, failedTerminalItem) {
  const store = new Map(); // chunk_id -> chunk row, mirrors 052's append-only dedup-by-chunk_id semantics.
  const calls = [];
  return {
    store,
    calls,
    chunkDocuments: async (args) => {
      calls.push(args);
      const { chunks, gaps } = buildAgt002DocumentChunks(documents);
      for (const chunk of chunks) {
        const existing = store.get(chunk.chunk_id);
        if (existing) {
          assert.equal(existing.chunk_hash, chunk.chunk_hash, 'reprocesar el mismo chunk_id nunca debe cambiar su contenido');
          continue;
        }
        store.set(chunk.chunk_id, chunk);
      }
      const gapDetails = [
        ...gaps.map(gap => ({ document_id: gap.document_id, reason: gap.reason })),
        { document_id: failedTerminalItem.source_document_id, reason: 'failed_terminal' },
      ];
      return {
        documents: documents.length + 1,
        chunks: chunks.length,
        gaps: gapDetails.length,
        gapDetails,
      };
    },
  };
}

function makeWorkerDeps({ chunkDocuments }) {
  const calls = { updateJob: [], appendEvent: [], publishSnapshot: [] };
  const deps = {
    claimJob: async () => ({
      job_id: 'job-manizales', lease_id: 'lease-1', tender_id: 'tender-manizales', opportunity_id: 'opp-manizales',
      status: 'ready_for_snapshot', current_step: 'snapshot', analysis_authorized_by: null,
    }),
    updateJob: async (jobId, leaseId, patch) => { calls.updateJob.push({ jobId, leaseId, patch }); },
    recordImportItem: async () => {},
    appendEvent: async (event) => { calls.appendEvent.push(event); },
    revalidateOfficialStatus: async () => ({ terminal: false }),
    discoverDocuments: async () => [],
    importOneDocument: async () => ({ status: 'imported', hasText: true }),
    chunkDocuments,
    publishSnapshot: async (args) => { calls.publishSnapshot.push(args); return { id: 'snap-manizales' }; },
    requestAgt002: async () => ({ status: 'quota' }),
    now: () => 0,
  };
  return { deps, calls };
}

async function run() {
  const { documents, failedTerminalItem } = buildFourteenDocumentFixture();
  assert.ok(documents.length > AGT002_MAX_DOCUMENTS, 'el fixture debe superar el techo histórico de documentos del camino de evidencia al modelo');
  assert.ok(documents[0].extracted_text.length > AGT002_MAX_DOCUMENT_CHARS, 'el fixture debe superar el techo histórico de caracteres por documento');

  const fake = makeChunkPersistenceFake(documents, failedTerminalItem);
  const { deps, calls } = makeWorkerDeps({ chunkDocuments: fake.chunkDocuments });
  const worker = createTenderProcessingWorker(deps);

  const result = await worker.runOnce({});
  assert.equal(result.status, 'snapshot_published');
  assert.equal(fake.calls.length, 1);
  assert.equal(calls.publishSnapshot.length, 1, 'el chunking no debe reemplazar la publicación del snapshot');
  assert.equal(fake.calls[0].snapshotId, 'snap-manizales', 'chunkDocuments debe recibir el snapshotId ya creado por publishSnapshot');

  const chunkEvent = calls.appendEvent.find(event => event.eventType === 'documents_chunked');
  assert.ok(chunkEvent, 'debe registrarse un evento de chunking con el resumen de cobertura');
  assert.equal(chunkEvent.metadata.documents, 14);
  assert.equal(chunkEvent.metadata.gaps, 2, 'debe haber un gap ilegible y un gap failed_terminal');

  // Los gaps expuestos en el evento deben ser explícitos y seguros: sólo document_id y
  // reason, nunca texto extraído ni mensajes de error de importación.
  const gapDetails = chunkEvent.metadata.gap_details;
  assert.equal(gapDetails.length, 2);
  gapDetails.forEach(gap => assert.deepEqual(Object.keys(gap).sort(), ['document_id', 'reason']));
  assert.ok(gapDetails.some(gap => gap.document_id === 'doc-13' && gap.reason === 'empty_document'), 'el documento ilegible debe quedar como gap explícito');
  assert.ok(gapDetails.some(gap => gap.document_id === 'doc-14' && gap.reason === 'failed_terminal'), 'el import item failed_terminal debe quedar como gap explícito');
  assert.ok(!JSON.stringify(gapDetails).includes('sensible'), 'el detalle del error de importación nunca debe filtrarse en el evento');

  // Coverage: los 14 documentos quedan cubiertos, ya sea con chunks o con un gap explícito.
  const chunkedDocumentIds = new Set([...fake.store.values()].map(chunk => chunk.document_id));
  const { gaps } = buildAgt002DocumentChunks(documents);
  const gapDocumentIds = new Set([...gaps.map(gap => gap.document_id), failedTerminalItem.source_document_id]);
  const coveredIds = new Set([...chunkedDocumentIds, ...gapDocumentIds]);
  assert.equal(coveredIds.size, 14, 'los 14 documentos deben quedar cubiertos por chunk o por gap explícito');
  assert.deepEqual([...coveredIds].sort(), [...documents.map(doc => doc.document_id), failedTerminalItem.source_document_id].sort());

  // El documento ilegible/vacío (doc-13) no produce chunks fantasma; sólo un gap.
  assert.ok(![...fake.store.values()].some(chunk => chunk.document_id === 'doc-13'));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].document_id, 'doc-13');
  assert.equal(gaps[0].reason, 'empty_document');

  // El documento failed_terminal (doc-14) tampoco produce chunks: nunca llegó a
  // importarse, así que jamás pasa por el chunker puro.
  assert.ok(![...fake.store.values()].some(chunk => chunk.document_id === 'doc-14'));

  // Sin techo de 12 documentos ni 3.000 caracteres: doc-01 (más largo que el histórico
  // límite por documento) conserva contenido más allá del carácter 3000 en algún chunk.
  const doc1Chunks = [...fake.store.values()].filter(chunk => chunk.document_id === 'doc-01').sort((a, b) => a.chunk_index - b.chunk_index);
  assert.ok(doc1Chunks.length > 1, 'un documento largo debe producir varias ventanas, no truncarse en una sola');
  const beyondOldCeiling = documents[0].extracted_text.slice(AGT002_MAX_DOCUMENT_CHARS, AGT002_MAX_DOCUMENT_CHARS + 40);
  assert.ok(doc1Chunks.some(chunk => chunk.text.includes(beyondOldCeiling.trim().slice(0, 20))), 'el texto más allá del límite histórico de 3.000 caracteres debe seguir presente en algún chunk');

  // Metadatos verificables dentro del propio snapshot representativo: página/sección y
  // hashes deben conservarse para citar la ubicación y demostrar integridad del texto.
  const persistedChunks = [...fake.store.values()];
  assert.ok(persistedChunks.some(chunk => chunk.page === 2), 'el snapshot debe conservar metadatos de una segunda página');
  assert.ok(persistedChunks.some(chunk => chunk.section === 2), 'el snapshot debe conservar metadatos de una segunda sección');
  for (const chunk of persistedChunks) {
    assert.ok(Number.isInteger(chunk.page) && chunk.page >= 1);
    assert.ok(Number.isInteger(chunk.section) && chunk.section >= 1);
    assert.equal(chunk.chunk_hash, hash(chunk.text), `chunk_hash inválido para ${chunk.chunk_id}`);
    const source = documents.find(document => document.document_version_id === chunk.document_version_id);
    assert.equal(chunk.content_hash, source.content_hash, `content_hash inválido para ${chunk.chunk_id}`);
  }

  // Precedencia de adenda sobre base sin borrar historia: ambos conjuntos de chunks existen.
  const baseChunk = persistedChunks.find(chunk => chunk.document_id === 'doc-01');
  const addendumChunk = [...fake.store.values()].find(chunk => chunk.document_id === 'doc-12');
  assert.ok(baseChunk && addendumChunk, 'tanto el documento base como la adenda deben tener chunks persistidos');
  assert.equal(baseChunk.precedence, 'base');
  assert.equal(baseChunk.superseded_by_addendum, true);
  assert.equal(addendumChunk.precedence, 'addendum');
  assert.equal(addendumChunk.superseded_by_addendum, false);

  // Orden estable: releer el store (sin depender del orden de inserción) reproduce el
  // mismo orden que produce el chunker puro directamente.
  const direct = buildAgt002DocumentChunks(documents);
  const storeOrderIds = [...fake.store.values()].sort((a, b) => a.chunk_id.localeCompare(b.chunk_id)).map(c => c.chunk_id);
  assert.deepEqual(storeOrderIds, direct.chunks.map(c => c.chunk_id).sort());

  // Reintento (por ejemplo tras pérdida de lease): reprocesar el mismo snapshot documental
  // no duplica chunks — dedup determinística por versión/hash.
  const sizeBeforeRetry = fake.store.size;
  await fake.chunkDocuments({ jobId: 'job-manizales', tenderId: 'tender-manizales', opportunityId: 'opp-manizales', snapshotId: 'snap-manizales' });
  assert.equal(fake.store.size, sizeBeforeRetry, 'reprocesar el mismo expediente documental debe ser idempotente');

  console.log('AGT-002 tender processing chunking integration passed');
}

run();

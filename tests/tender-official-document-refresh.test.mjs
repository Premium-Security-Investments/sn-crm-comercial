import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import {
  mergeTenderDocumentRecords,
  refreshOfficialTenderDocument,
  refreshTenderDocumentBatch,
  runOptionalTenderAnalysis,
  summarizeTenderDocumentRefresh,
  tenderDocumentContentHash,
  tenderDocumentVersionPath,
} from '../tender-document-versioning.js';

const content = Buffer.from('contenido oficial');
const hash = createHash('sha256').update(content).digest('hex');
assert.equal(tenderDocumentContentHash(content), hash, 'el hash debe ser SHA-256 del buffer original');
assert.equal(
  tenderDocumentVersionPath({ opportunityId: 'opp-1', sourceDocumentId: ' SECOP/Documento 7 ', contentHash: hash, name: 'Pliego final.pdf' }),
  `tender-documents/opp-1/SECOP-Documento-7/${hash}-Pliego-final.pdf`,
  'la ruta debe ser estable, segura y contener el hash de contenido'
);
assert.doesNotMatch(
  tenderDocumentVersionPath({ opportunityId: 'opp-1', sourceDocumentId: '../doc', contentHash: hash, name: '../adenda.pdf' }),
  /\.\./,
  'la ruta nunca puede conservar traversal'
);
assert.deepEqual(
  summarizeTenderDocumentRefresh([{ status: 'new' }, { status: 'updated' }, { status: 'unchanged' }, { status: 'failed' }, { status: 'failed' }]),
  { new_count: 1, updated_count: 1, unchanged_count: 1, failed_count: 2 },
  'el resumen debe distinguir documentos nuevos, modificados, sin cambios y fallidos'
);

const officialDocument = {
  name: '../Adenda oficial.pdf', mime_type: 'application/pdf', document_type: 'adenda',
  source_url: 'https://official.example/adenda', source_document_id: '  doc-7  ', errorPrefix: 'SECOP',
};

await (async function unchangedSkipsEveryDownstreamSideEffect() {
  const calls = { download: 0, extract: 0, storage: 0, upload: 0, rpc: 0 };
  const result = await refreshOfficialTenderDocument({
    opportunityId: 'opp-1', source: 'SECOP II', document: officialDocument,
    currentVersion: { content_hash: hash },
    download: async () => { calls.download += 1; return content; },
    extractText: async () => { calls.extract += 1; return 'texto'; },
    ensureStorage: async () => { calls.storage += 1; },
    upload: async () => { calls.upload += 1; },
    recordVersion: async () => { calls.rpc += 1; return { status: 'created' }; },
  });
  assert.deepEqual(result, { status: 'unchanged', source_document_id: 'doc-7' });
  assert.deepEqual(calls, { download: 1, extract: 0, storage: 0, upload: 0, rpc: 0 });
})();

await (async function changedDocumentUsesSanitizedVersionedPathAndRpcContract() {
  const observed = {};
  const result = await refreshOfficialTenderDocument({
    opportunityId: 'opp-1', source: 'SECOP II', document: officialDocument,
    currentVersion: { content_hash: '0'.repeat(64) },
    download: async () => content,
    cleanName: value => value.replace(/^\.\.\//, ''),
    extractText: async () => 'Texto verificable',
    ensureStorage: async () => { observed.storage = true; },
    upload: async (path, buffer, mime) => { observed.upload = { path, buffer, mime }; },
    recordVersion: async payload => { observed.rpc = payload; return { status: 'created', version: 2 }; },
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.source_document_id, 'doc-7');
  assert.equal(observed.storage, true);
  assert.equal(observed.rpc.source_document_id, 'doc-7', 'lookup/path/RPC reutilizan el ID normalizado');
  assert.equal(observed.rpc.name, 'Adenda oficial.pdf');
  assert.equal(observed.rpc.storage_path, observed.upload.path);
  assert.match(observed.rpc.storage_path, new RegExp(`^tender-documents/opp-1/doc-7/${hash}-`));
  assert.doesNotMatch(observed.rpc.storage_path, /\.\./);
  assert.equal(observed.rpc.size_bytes, content.length);
  assert.equal(observed.rpc.extracted_text, 'Texto verificable');
})();

await (async function rpcUnchangedWinsARaceWithoutMisreportingAnUpdate() {
  const result = await refreshOfficialTenderDocument({
    opportunityId: 'opp-1', source: 'SECOP II', document: { ...officialDocument, source_document_id: 'doc-race' },
    currentVersion: null,
    download: async () => content,
    cleanName: value => value.replace(/^\.\.\//, ''),
    extractText: async () => 'Texto verificable',
    ensureStorage: async () => {},
    upload: async () => {},
    recordVersion: async () => ({ status: 'unchanged', version: 1 }),
  });
  assert.equal(result.status, 'unchanged');
})();

await (async function partialFailureDoesNotStopTheBatch() {
  const seen = [];
  const results = await refreshTenderDocumentBatch([
    { source_document_id: 'bad', errorPrefix: 'SECOP' },
    { source_document_id: 'good', errorPrefix: 'SECOP' },
  ], async document => {
    seen.push(document.source_document_id);
    if (document.source_document_id === 'bad') throw new Error('descarga fallida');
    return { status: 'new', source_document_id: document.source_document_id };
  });
  assert.deepEqual(seen, ['bad', 'good']);
  assert.deepEqual(summarizeTenderDocumentRefresh(results), { new_count: 1, updated_count: 0, unchanged_count: 0, failed_count: 1 });
  assert.match(results[0].error, /SECOP: descarga fallida/);
})();

await (async function emptyExtractedTextThrowsClassifiableTerminalCode() {
  // Bucaramanga LPR (job 374195eb): 5 import items failed with this exact
  // message and last_error_code=null because the throw never tagged .code,
  // so classifyPipelineError() silently fell through to its 'operational'
  // default instead of the intended terminal TENDER_DOC_EMPTY_TEXT.
  await assert.rejects(
    () => refreshOfficialTenderDocument({
      opportunityId: 'opp-1', source: 'SECOP II', document: { ...officialDocument, source_document_id: 'doc-empty' },
      currentVersion: null,
      download: async () => content,
      cleanName: value => value.replace(/^\.\.\//, ''),
      extractText: async () => '   ',
      ensureStorage: async () => { throw new Error('ensureStorage must not run when text is unverifiable'); },
      upload: async () => { throw new Error('upload must not run when text is unverifiable'); },
      recordVersion: async () => { throw new Error('recordVersion must not run when text is unverifiable'); },
    }),
    error => {
      assert.equal(error.code, 'TENDER_DOC_EMPTY_TEXT', 'empty extracted text must carry the terminal code the pipeline classifier expects');
      assert.match(error.message, /No fue posible extraer texto verificable/);
      return true;
    }
  );
})();

await (async function oversizedDownloadThrowsClassifiableTerminalCode() {
  const oversized = Buffer.alloc(50 * 1024 * 1024 + 1);
  await assert.rejects(
    () => refreshOfficialTenderDocument({
      opportunityId: 'opp-1', source: 'SECOP II', document: { ...officialDocument, source_document_id: 'doc-big' },
      currentVersion: null,
      download: async () => oversized,
      extractText: async () => { throw new Error('extractText must not run past the size gate'); },
      ensureStorage: async () => { throw new Error('ensureStorage must not run past the size gate'); },
      upload: async () => { throw new Error('upload must not run past the size gate'); },
      recordVersion: async () => { throw new Error('recordVersion must not run past the size gate'); },
    }),
    error => {
      assert.equal(error.code, 'TENDER_DOC_SIZE_EXCEEDED', 'oversized downloads must carry the terminal code the pipeline classifier expects');
      return true;
    }
  );
})();

await (async function manualRefreshNeverLoadsOrGeneratesAnalysis() {
  let loads = 0;
  let generations = 0;
  const generated = await runOptionalTenderAnalysis({
    analyze: false,
    loadCurrentDocuments: async () => { loads += 1; return [{}]; },
    generate: async () => { generations += 1; },
  });
  assert.equal(generated, false);
  assert.deepEqual({ loads, generations }, { loads: 0, generations: 0 });
  assert.equal(await runOptionalTenderAnalysis({
    analyze: true,
    loadCurrentDocuments: async () => { loads += 1; return [{ id: 'doc' }]; },
    generate: async documents => { generations += documents.length; },
  }), true);
  assert.deepEqual({ loads, generations }, { loads: 1, generations: 1 });
})();

assert.deepEqual(
  mergeTenderDocumentRecords(
    [{ id: 'typed', source_document_id: ' doc-7 ', current: true }],
    [{ id: 'legacy-duplicate', source_document_id: 'doc-7' }, { id: 'legacy-other', source_document_id: 'doc-8' }, { id: 'manual' }],
  ).map(document => document.id),
  ['typed', 'legacy-other', 'manual'],
  'la versión tipada vigente gana y las cargas manuales/históricas no duplicadas permanecen'
);

for (const path of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /async function refreshTenderDocumentsFromOfficialSource\(database, opportunityId, currentProfile, \{ analyze = true \} = \{\}\)/);
  assert.match(source, /refreshTenderDocumentBatch\(toDownload/);
  assert.match(source, /p_opportunity_id: opportunityId, p_tender_id: tenderId/);
  assert.match(source, /kind: 'tender_document_refresh'/);
  assert.match(source, /runOptionalTenderAnalysis\(\{[\s\S]{0,80}analyze,/);
  assert.match(source, /refreshTenderDocumentsFromOfficialSource\(database, opportunityId, currentProfile, \{ analyze: false \}\)/);
}

console.log('tender official document refresh behavioral contract passed');

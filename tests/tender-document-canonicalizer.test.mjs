import { strict as assert } from 'node:assert';
import { canonicalizeTenderDocuments } from '../tender-document-canonicalizer.js';

// Observed production bug: after refresh, current UI document rows went from 31 to 45
// (Anexo 23->33, Estudios 4->6, Pliego 4->6) because documents with identical
// filename/size/content ended up under multiple source_document_id values, all
// marked current. This module is the reusable, final-barrier dedup applied before
// UI/snapshot/analysis consumption.

await (async function collapsesExactDuplicateContentHashRegardlessOfSourceId() {
  const typed = { id: 'typed-1', name: 'Anexo tecnico.pdf', version: 1, content_hash: 'a'.repeat(64), current: true, source_document_id: 'rotated-id-2' };
  const legacy = { id: 'legacy-1', name: 'Anexo tecnico.pdf', content_hash: 'a'.repeat(64), current: true, source_document_id: 'original-id-1' };
  const result = canonicalizeTenderDocuments([legacy, typed]);
  assert.equal(result.length, 1, 'typed+legacy with the same content_hash under different source ids must collapse to one document');
  assert.equal(result[0].id, 'typed-1', 'typed record must win over legacy when content is identical');
})();

await (async function collapsesDuplicateTypedCurrentDocsSameContentKeepingNewest() {
  const older = { id: 'v1', name: 'Estudios previos.pdf', version: 1, content_hash: 'b'.repeat(64), current: true, created_at: '2026-01-01T00:00:00Z', source_document_id: 'id-a' };
  const newer = { id: 'v2', name: 'Estudios previos.pdf', version: 2, content_hash: 'b'.repeat(64), current: true, created_at: '2026-02-01T00:00:00Z', source_document_id: 'id-b-rotated' };
  const result = canonicalizeTenderDocuments([older, newer]);
  assert.equal(result.length, 1, 'two typed current documents with identical content hash but different source ids must collapse to one');
  assert.equal(result[0].id, 'v2', 'the newest version must be kept when both are otherwise equally ranked');
})();

await (async function collapsesHashlessDuplicatesOnlyOnStrongNameAndSizeMatch() {
  const first = { id: 'legacy-a', name: '  Pliego  Definitivo.PDF ', size: 2048, current: true };
  const second = { id: 'legacy-b', name: 'pliego definitivo.pdf', size: 2048, current: true };
  const result = canonicalizeTenderDocuments([first, second]);
  assert.equal(result.length, 1, 'hash-less duplicates must still collapse on a strong normalized name+size match');
})();

await (async function collapsesMixedTypedHashAndHashlessLegacyOnStrongFallback() {
  const legacy = { id: 'legacy-no-hash', name: 'Anexo No. 7.pdf', size: 4096, current: true, source_document_id: 'legacy-id' };
  const typed = { id: 'typed-with-hash', name: '  anexo no. 7.pdf ', size_bytes: 4096, version: 2, content_hash: 'd'.repeat(64), current: true, source_document_id: 'rotated-id' };
  for (const input of [[legacy, typed], [typed, legacy]]) {
    const result = canonicalizeTenderDocuments(input);
    assert.equal(result.length, 1, 'typed+legacy duplicate must collapse when one side lacks a hash but normalized name+size match strongly');
    assert.equal(result[0].id, 'typed-with-hash', 'typed evidence with a verified hash must win over hashless legacy evidence');
  }
})();

await (async function preservesSameNameAndSizeWhenBothHashesProveDifferentContent() {
  const draft = { id: 'draft-hash', name: 'Pliego.pdf', size_bytes: 8192, version: 1, content_hash: 'e'.repeat(64), current: true };
  const final = { id: 'final-hash', name: 'Pliego.pdf', size_bytes: 8192, version: 2, content_hash: 'f'.repeat(64), current: true };
  assert.equal(canonicalizeTenderDocuments([draft, final]).length, 2, 'different valid content hashes are authoritative and must not collapse merely because name+size match');
})();

await (async function tieBreakIsDeterministicRegardlessOfInputOrder() {
  const a = { id: 'a-stable', name: 'Duplicado.pdf', size: 512, current: true };
  const b = { id: 'b-stable', name: 'Duplicado.pdf', size: 512, current: true };
  const winnerAB = canonicalizeTenderDocuments([a, b])[0].id;
  const winnerBA = canonicalizeTenderDocuments([b, a])[0].id;
  assert.equal(winnerAB, winnerBA, 'equal-rank duplicates must select the same stable winner regardless of database/input ordering');
})();

await (async function neverDedupesDifferentFilenamesJustBecauseSizesMatch() {
  const pliego = { id: 'pliego', name: 'Pliego.pdf', size: 2048, current: true };
  const anexo = { id: 'anexo', name: 'Anexo.pdf', size: 2048, current: true };
  const result = canonicalizeTenderDocuments([pliego, anexo]);
  assert.equal(result.length, 2, 'documents with different filenames must never be collapsed merely because their sizes match');
})();

await (async function neverDedupesSameNameWithDifferentSizeWithoutHash() {
  const draft = { id: 'draft', name: 'Anexo.pdf', size: 100, current: true };
  const final = { id: 'final', name: 'Anexo.pdf', size: 999, current: true };
  const result = canonicalizeTenderDocuments([draft, final]);
  assert.equal(result.length, 2, 'same normalized name but different size cannot be safely collapsed without a content hash');
})();

await (async function preservesDistinctLegitimateDocumentsWithNoIdentitySignal() {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const result = canonicalizeTenderDocuments([a, b]);
  assert.equal(result.length, 2, 'documents with neither a hash nor name+size cannot be verified as duplicates, so both must be preserved');
})();

await (async function prefersCurrentOverNoncurrentWhenHashesMatch() {
  const stale = { id: 'stale', name: 'Anexo.pdf', version: 1, content_hash: 'c'.repeat(64), current: false, source_document_id: 'id-1' };
  const fresh = { id: 'fresh', name: 'Anexo.pdf', version: 2, content_hash: 'c'.repeat(64), current: true, source_document_id: 'id-2' };
  const resultOrderA = canonicalizeTenderDocuments([stale, fresh]);
  const resultOrderB = canonicalizeTenderDocuments([fresh, stale]);
  assert.equal(resultOrderA.length, 1);
  assert.equal(resultOrderA[0].id, 'fresh');
  assert.equal(resultOrderB.length, 1);
  assert.equal(resultOrderB[0].id, 'fresh', 'result must not depend on input array order');
})();

console.log('tender document canonicalizer collapses true duplicates while preserving distinct documents');

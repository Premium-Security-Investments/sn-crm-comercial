import { strict as assert } from 'node:assert';
import { deterministicDocumentFallbackId } from '../tender-document-versioning.js';

// Root cause: the ESU fallback id generator hashed Date.now() when a document had
// neither a URL matching /procesos/descargar/<id> nor a name, producing a fresh
// non-deterministic source_document_id on every refresh -- each refresh then
// created its own independent "current" row. The SECOP fallback had a related bug:
// it hashed the (tokenized/expiring) download URL even when a stable filename was
// available, so id_documento-less documents got a new id whenever the token
// rotated. Both must be replaced by one deterministic, immutable-field-only helper.

await (async function isDeterministicAcrossRepeatedCalls() {
  const first = deterministicDocumentFallbackId({ name: 'Anexo tecnico.pdf', url: 'https://example.test/download?token=abc' });
  const second = deterministicDocumentFallbackId({ name: 'Anexo tecnico.pdf', url: 'https://example.test/download?token=abc' });
  assert.equal(first, second, 'the same inputs must always produce the same id');
})();

await (async function prefersStableFilenameOverATokenizedRotatingUrl() {
  const beforeRotation = deterministicDocumentFallbackId({ name: 'Anexo tecnico.pdf', url: 'https://example.test/download?token=abc123&expires=1' });
  const afterRotation = deterministicDocumentFallbackId({ name: 'Anexo tecnico.pdf', url: 'https://example.test/download?token=zzz999&expires=2' });
  assert.equal(beforeRotation, afterRotation, 'a rotating/tokenized URL must not change the id when a stable filename is available');
})();

await (async function fallsBackToUrlOnlyWhenNoNameIsAvailable() {
  const withUrlOnly = deterministicDocumentFallbackId({ name: '', url: 'https://example.test/download/7' });
  const sameUrlAgain = deterministicDocumentFallbackId({ name: null, url: 'https://example.test/download/7' });
  assert.equal(withUrlOnly, sameUrlAgain);
  const differentUrl = deterministicDocumentFallbackId({ name: '', url: 'https://example.test/download/8' });
  assert.notEqual(withUrlOnly, differentUrl, 'distinct URLs must still produce distinct ids when no filename exists');
})();

await (async function throwsInsteadOfFallingBackToClockOrRandomnessWhenNoStableFieldExists() {
  assert.throws(() => deterministicDocumentFallbackId({ name: '', url: '' }), /identidad estable/i);
  assert.throws(() => deterministicDocumentFallbackId({}), /identidad estable/i);
})();

await (async function neverProducesTheSameIdForGenuinelyDifferentFilenames() {
  const anexo = deterministicDocumentFallbackId({ name: 'Anexo tecnico.pdf', url: 'https://example.test/x' });
  const pliego = deterministicDocumentFallbackId({ name: 'Pliego.pdf', url: 'https://example.test/x' });
  assert.notEqual(anexo, pliego);
})();

console.log('deterministic document fallback id has no clock/randomness dependency and prefers stable filenames over tokenized URLs');

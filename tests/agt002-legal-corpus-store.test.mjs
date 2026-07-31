import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildAgt002LegalSource } from '../agt002-legal-corpus.js';
import { canonicalizeAgt002LegalManifest, computeAgt002LegalManifestContentHash } from '../scripts/validate_agt002_legal_corpus.mjs';
import { loadPublishedAgt002LegalCorpus } from '../agt002-legal-corpus-store.js';

const PUBLISHED_ID = '10101010-1010-4010-8010-101010101010';

function validSourceRow(overrides = {}) {
  return {
    corpus_version_id: PUBLISHED_ID,
    source_id: 'ley-80-1993-art-2',
    norm_type: 'Ley',
    norm_number: '80',
    year: 1993,
    article_or_section: 'Artículo 2',
    current_text: 'Texto vigente de la norma sobre modalidades de selección.',
    issuing_authority: 'Congreso de la República',
    issued_at: '1993-10-28T00:00:00.000Z',
    effective_from: '1993-10-28T00:00:00.000Z',
    effective_to: null,
    modifications: [],
    official_url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=304',
    topic: ['contratacion_estatal'],
    sector: ['vigilancia_privada'],
    verified_at: '2026-07-29T00:00:00.000Z',
    verification_status: 'verified',
    validity_status: 'confirmed',
    applicability_status: 'applicable',
    ...overrides,
  };
}

function versionRow(overrides = {}) {
  return {
    id: PUBLISHED_ID,
    corpus_version: 'legal-corpus-v1',
    status: 'published',
    content_sha256: null,
    published_at: '2026-07-30T00:00:00.000Z',
    published_by: '44444444-4444-4444-8444-444444444444',
    ...overrides,
  };
}

// Mirrors what the store itself does to reconstruct + hash a manifest, so tests can
// derive the exact expected hash for a given set of source rows without duplicating
// the store's internals via reimplementation drift.
function expectedHashFor(corpusVersion, sourceRows) {
  const sources = sourceRows
    .map(({ corpus_version_id: ignored, ...row }) => buildAgt002LegalSource({ ...row, corpus_version: corpusVersion }))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
  return computeAgt002LegalManifestContentHash({ corpus_version: corpusVersion, sources });
}

function makeQuery(rows, error = null) {
  let filtered = rows;
  const builder = {
    select() { return builder; },
    eq(column, value) {
      filtered = filtered.filter(row => row[column] === value);
      return builder;
    },
    then(resolve, reject) {
      return Promise.resolve({ data: error ? null : filtered, error }).then(resolve, reject);
    },
  };
  return builder;
}

function fakeDatabase({ versions = [], sources = [], versionsError = null, sourcesError = null } = {}) {
  return {
    from(table) {
      if (table === 'psi_agt002_legal_corpus_versions') return makeQuery(versions, versionsError);
      if (table === 'psi_agt002_legal_sources') return makeQuery(sources, sourcesError);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

// 1) Canonical hash is stable under object-key reordering but sensitive to content.
{
  const manifestA = { corpus_version: 'legal-corpus-v1', sources: [validSourceRow()] };
  const reordered = { sources: [{ ...validSourceRow() }], corpus_version: 'legal-corpus-v1' };
  // Also reorder keys within the nested source object itself.
  const [source] = reordered.sources;
  reordered.sources[0] = Object.fromEntries(Object.keys(source).reverse().map(key => [key, source[key]]));

  assert.equal(canonicalizeAgt002LegalManifest(manifestA), canonicalizeAgt002LegalManifest(reordered));
  assert.equal(computeAgt002LegalManifestContentHash(manifestA), computeAgt002LegalManifestContentHash(reordered));
  assert.match(computeAgt002LegalManifestContentHash(manifestA), /^[0-9a-f]{64}$/);

  const manifestB = { corpus_version: 'legal-corpus-v1', sources: [validSourceRow({ current_text: 'Texto distinto.' })] };
  assert.notEqual(computeAgt002LegalManifestContentHash(manifestA), computeAgt002LegalManifestContentHash(manifestB));
}

// 2) canonicalize/hash reject non-object input.
{
  assert.throws(() => canonicalizeAgt002LegalManifest(null), /objeto/i);
  assert.throws(() => canonicalizeAgt002LegalManifest('x'), /objeto/i);
  assert.throws(() => canonicalizeAgt002LegalManifest([1, 2]), /objeto/i);
}

// 3) Loader returns exactly one published version reconstructed to the closed manifest contract.
{
  const rows = [validSourceRow()];
  const hash = expectedHashFor('legal-corpus-v1', rows);
  const database = fakeDatabase({ versions: [versionRow({ content_sha256: hash })], sources: rows });

  const loaded = await loadPublishedAgt002LegalCorpus(database);
  assert.equal(loaded.legal_corpus_version_id, PUBLISHED_ID);
  assert.equal(loaded.corpus_version, 'legal-corpus-v1');
  assert.equal(loaded.content_sha256, hash);
  assert.equal(loaded.corpus.corpus_version, 'legal-corpus-v1');
  assert.equal(loaded.corpus.sources.length, 1);
  assert.equal(loaded.corpus.sources[0].source_id, 'ley-80-1993-art-2');
  assert.equal(loaded.corpus.sources[0].verification_status, 'verified');

  // The result is immutable.
  assert.throws(() => { loaded.legal_corpus_version_id = 'mutated'; }, TypeError);
  assert.throws(() => { loaded.corpus.corpus_version = 'mutated'; }, TypeError);
}

// 4) Multiple sources are reconstructed in a deterministic order, independent of DB row order.
{
  const rows = [
    validSourceRow({ source_id: 'ley-1150-2007-art-2', norm_number: '1150', year: 2007, issued_at: '2007-07-16T00:00:00.000Z', effective_from: '2007-07-16T00:00:00.000Z', official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1' }),
    validSourceRow(),
  ];
  const hash = expectedHashFor('legal-corpus-v1', rows);
  const database = fakeDatabase({ versions: [versionRow({ content_sha256: hash })], sources: rows });
  const loaded = await loadPublishedAgt002LegalCorpus(database);
  assert.deepEqual(loaded.corpus.sources.map(source => source.source_id), ['ley-1150-2007-art-2', 'ley-80-1993-art-2']);
}

// 5) No published version at all fails closed.
{
  const database = fakeDatabase({ versions: [], sources: [] });
  await assert.rejects(loadPublishedAgt002LegalCorpus(database), /no hay ninguna versión publicada/i);
}

// 6) A draft-only row (should never be returned by the published filter, but the loader
// must not trust the query and must fail closed if it somehow receives a non-published row).
{
  const database = {
    from(table) {
      if (table === 'psi_agt002_legal_corpus_versions') {
        // Simulates a corrupted/unfiltered response: the row is not actually published.
        return makeQuery([versionRow({ status: 'draft', content_sha256: null })].filter(() => true));
      }
      if (table === 'psi_agt002_legal_sources') return makeQuery([validSourceRow()]);
      throw new Error(`unexpected table ${table}`);
    },
  };
  await assert.rejects(loadPublishedAgt002LegalCorpus(database), /publicada/i);
}

// 7) Multiple published versions returned by the DB fails closed (defense in depth).
{
  const rows = [validSourceRow()];
  const hash = expectedHashFor('legal-corpus-v1', rows);
  const database = fakeDatabase({
    versions: [versionRow({ content_sha256: hash }), versionRow({ id: '20202020-2020-4020-8020-202020202020', corpus_version: 'legal-corpus-v2', content_sha256: hash })],
    sources: rows,
  });
  await assert.rejects(loadPublishedAgt002LegalCorpus(database), /más de una versión publicada/i);
}

// 8) Hash mismatch between the stored content_sha256 and the reconstructed manifest fails closed.
{
  const rows = [validSourceRow()];
  const database = fakeDatabase({ versions: [versionRow({ content_sha256: 'a'.repeat(64) })], sources: rows });
  await assert.rejects(loadPublishedAgt002LegalCorpus(database), /hash/i);
}

// 9) A malformed/invalid content_sha256 on the version row fails closed.
{
  const rows = [validSourceRow()];
  const database = fakeDatabase({ versions: [versionRow({ content_sha256: 'not-a-hash' })], sources: rows });
  await assert.rejects(loadPublishedAgt002LegalCorpus(database), /sha-256|hash/i);
}

// 10) A malformed source row (fails the Task29 closed contract) fails closed.
{
  const rows = [validSourceRow({ current_text: '' })];
  const database = fakeDatabase({ versions: [versionRow({ content_sha256: 'b'.repeat(64) })], sources: rows });
  await assert.rejects(loadPublishedAgt002LegalCorpus(database));
}

// 11) A published version with zero sources fails closed.
{
  const database = fakeDatabase({ versions: [versionRow({ content_sha256: 'c'.repeat(64) })], sources: [] });
  await assert.rejects(loadPublishedAgt002LegalCorpus(database), /fuentes/i);
}

// 12) A database-layer error (versions or sources query) is surfaced, never swallowed.
{
  const database = fakeDatabase({ versionsError: { message: 'db down' } });
  await assert.rejects(loadPublishedAgt002LegalCorpus(database), /db down/i);
}
{
  const rows = [validSourceRow()];
  const hash = expectedHashFor('legal-corpus-v1', rows);
  const database = fakeDatabase({ versions: [versionRow({ content_sha256: hash })], sourcesError: { message: 'sources db down' } });
  await assert.rejects(loadPublishedAgt002LegalCorpus(database), /sources db down/i);
}

// 13) The store never reads the filesystem or performs network I/O: it only talks to
// the injected service-role DB client.
{
  const source = readFileSync(new URL('../agt002-legal-corpus-store.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /readFileSync|readFile\(|fetch\(|http\.request|https\.request/);
}

// 14) loadPublishedAgt002LegalCorpus requires an actual DB client.
{
  await assert.rejects(loadPublishedAgt002LegalCorpus(null), /cliente/i);
  await assert.rejects(loadPublishedAgt002LegalCorpus({}), /cliente/i);
}

console.log('AGT-002 legal corpus store contract passed');

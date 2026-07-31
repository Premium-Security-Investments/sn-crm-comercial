import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { evaluateAgt002LegalSourceStatus } from '../agt002-legal-corpus.js';
import {
  computeAgt002LegalManifestContentHash,
  validateAgt002LegalManifest,
} from '../scripts/validate_agt002_legal_corpus.mjs';

const manifest = JSON.parse(readFileSync(new URL('../data/agt002/legal-corpus-v1.json', import.meta.url), 'utf8'));
const checks = JSON.parse(readFileSync(new URL('../docs/verification/2026-07-31-agt002-e5-source-checks.json', import.meta.url), 'utf8'));

validateAgt002LegalManifest(manifest);
assert.equal(checks.corpus_version, manifest.corpus_version);
assert.equal(checks.manifest_content_sha256, computeAgt002LegalManifestContentHash(manifest));
assert.match(checks.legal_review_disclaimer, /NO sustituye ni implica verificación jurídica/i);
assert.match(checks.verification_method_note, /no.*byte-exact/i);

const artifactsBySource = new Map();
for (const artifact of checks.artifacts) {
  assert.equal(artifact.http_status, 200);
  assert.match(artifact.effective_url, /^https:\/\//);
  assert.match(artifact.content_type, /^(text\/html|application\/pdf)/);
  assert.match(artifact.artifact_sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.checked_at, /^2026-07-31T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(artifact.evidence_classification, /^official_source_artifact_fetched_/);
  for (const sourceId of artifact.source_ids) {
    assert.ok(!artifactsBySource.has(sourceId), `source_id duplicado en source checks: ${sourceId}`);
    artifactsBySource.set(sourceId, artifact);
  }
}

assert.deepEqual(
  [...artifactsBySource.keys()].sort(),
  manifest.sources.map(source => source.source_id).sort(),
  'source checks debe cubrir exactamente todas las fuentes del manifiesto',
);

let eligibleCount = 0;
for (const source of manifest.sources) {
  const artifact = artifactsBySource.get(source.source_id);
  assert.equal(artifact.effective_url, source.official_url);
  const sections = new Set([
    ...artifact.article_or_sections,
    ...(artifact.per_article ?? []).filter(item => item.source_id === source.source_id).map(item => item.article_or_section),
  ]);
  assert.ok(sections.has(source.article_or_section), `${source.source_id} no registra su artículo exacto`);

  const evaluation = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-31', stale_after_days: 365 });
  if (evaluation.eligible_for_verified_law) eligibleCount += 1;
  const perArticle = artifact.per_article?.find(item => item.source_id === source.source_id);
  const reviewOnly = perArticle?.review_only ?? artifact.review_only;
  assert.equal(reviewOnly, !evaluation.eligible_for_verified_law, `${source.source_id} tiene review_only incoherente`);
}

assert.ok(eligibleCount >= 1, 'el corpus publicable requiere al menos una fuente plenamente elegible');
console.log(`AGT-002 E5 source checks contract passed — ${manifest.sources.length} fuentes, ${eligibleCount} elegible(s).`);

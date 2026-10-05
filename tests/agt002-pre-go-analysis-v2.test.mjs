import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveAgt002PreGoSchemaV2, PRE_GO_SCHEMA_V2, validatePreGoAnalysisV2, AGT002_PRE_GO_ANALYSIS_V2,
} from '../agt002-pre-go-analysis-v2.js';
import { validatePreGoAnalysisV1 } from '../agt002-pre-go-analysis-v1.js';
import { buildBaselineScopeA } from './fixtures/agt002-pre-go-analysis-v1.mjs';

const V1_SCHEMA = JSON.parse(readFileSync(new URL('../schemas/agt002/pre_go_analysis.v1.schema.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);

function toV2(doc) {
  const out = clone(doc);
  delete out.render_manifest;
  out.meta.schema_version = AGT002_PRE_GO_ANALYSIS_V2;
  return out;
}
const codes = result => result.errors.map(error => error.code);

test('the committed v2 schema is exactly the derivation of v1 (no drift)', () => {
  assert.deepEqual(PRE_GO_SCHEMA_V2, deriveAgt002PreGoSchemaV2(V1_SCHEMA));
});

test('deriving v2 never mutates v1', () => {
  const before = JSON.stringify(V1_SCHEMA);
  deriveAgt002PreGoSchemaV2(V1_SCHEMA);
  assert.equal(JSON.stringify(V1_SCHEMA), before);
});

test('a valid baseline analysis without render manifest passes v2', () => {
  const result = validatePreGoAnalysisV2(toV2(buildBaselineScopeA()));
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('v2 keeps every domain rule: dangling references and hash mismatches are still rejected', () => {
  const doc = toV2(buildBaselineScopeA());
  doc.claims[0].source_refs[0].document_id = '00000000-0000-4000-8000-00000000dead';
  assert.ok(codes(validatePreGoAnalysisV2(doc)).includes('source_ref.member_not_found'));

  const hashDoc = toV2(buildBaselineScopeA());
  hashDoc.claims[0].source_refs[0].source_hash = 'f'.repeat(64);
  assert.ok(codes(validatePreGoAnalysisV2(hashDoc)).includes('source_ref.hash_mismatch'));
});

test('v2 rejects the v1 schema_version and a leftover render_manifest', () => {
  const v1Stamp = toV2(buildBaselineScopeA());
  v1Stamp.meta.schema_version = 'pre_go_analysis.v1';
  assert.ok(codes(validatePreGoAnalysisV2(v1Stamp)).includes('schema.const_mismatch'));

  const withRender = toV2(buildBaselineScopeA());
  withRender.render_manifest = buildBaselineScopeA().render_manifest;
  assert.ok(codes(validatePreGoAnalysisV2(withRender)).includes('schema.additional_property'));
});

test('v2 accepts a first analysis without an evidence snapshot and with unclassified vitality', () => {
  const doc = toV2(buildBaselineScopeA());
  doc.meta.snapshot_id = null;
  doc.evidence_package.snapshot_id = null;
  doc.evidence_package.member_refs.forEach(member => { member.vitality = 'UNCLASSIFIED'; });
  const result = validatePreGoAnalysisV2(doc);
  assert.deepEqual(result.errors, []);
});

test('v2 still requires meta and evidence snapshot to agree', () => {
  const doc = toV2(buildBaselineScopeA());
  doc.meta.snapshot_id = null;
  assert.ok(codes(validatePreGoAnalysisV2(doc)).includes('meta.snapshot_id_mismatch'));
});

test('v1 stays immutable: it keeps rejecting what only v2 allows, and still accepts its own baseline', () => {
  assert.equal(validatePreGoAnalysisV1(buildBaselineScopeA()).ok, true);

  const nullSnapshot = clone(buildBaselineScopeA());
  nullSnapshot.meta.snapshot_id = null;
  nullSnapshot.evidence_package.snapshot_id = null;
  assert.equal(validatePreGoAnalysisV1(nullSnapshot).ok, false);

  const unclassified = clone(buildBaselineScopeA());
  unclassified.evidence_package.member_refs[0].vitality = 'UNCLASSIFIED';
  assert.equal(validatePreGoAnalysisV1(unclassified).ok, false);

  const noRender = clone(buildBaselineScopeA());
  delete noRender.render_manifest;
  assert.equal(validatePreGoAnalysisV1(noRender).ok, false);
});

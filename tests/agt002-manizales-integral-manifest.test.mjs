import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgt002ManizalesIntegralManifest,
  validateAgt002ManizalesIntegralManifest,
  AGT002_INTEGRAL_MANIFEST_ARTIFACT_TYPE,
  AGT002_INTEGRAL_MANIFEST_CONTRACT_VERSION,
  AGT002_INTEGRAL_MANIFEST_STATUS,
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
  AGT002_INTEGRAL_MANIFEST_CATEGORIES,
  AGT002_INTEGRAL_MANIFEST_DISPOSITIONS,
  AGT002_INTEGRAL_GOVERNED_RUNTIME_IDS,
  AGT002_INTEGRAL_OVERRIDES_066,
} from '../agt002-manizales-integral-manifest.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(resolve(PROJECT_ROOT, rel), 'utf8'));

const registry = readJson('docs/governance/registro/manizales-sa-24-2026.registry.json');
const analysis = readJson('docs/governance/analisis/manizales-sa-24-2026.pre-go-analysis.json');
const proposals = readJson('docs/governance/propuestas/manizales-sa-24-2026.section-proposals.json');

const FIXED_AT = '2026-08-15T00:00:00.000Z';
const build = () => buildAgt002ManizalesIntegralManifest({ registry, analysis, proposals, generatedAt: FIXED_AT });

test('envelope carries the fixed governed contract identity', () => {
  const m = build();
  assert.equal(m.artifact_type, AGT002_INTEGRAL_MANIFEST_ARTIFACT_TYPE);
  assert.equal(m.artifact_type, 'agt002_manizales_integral_manifest');
  assert.equal(m.contract_version, AGT002_INTEGRAL_MANIFEST_CONTRACT_VERSION);
  assert.equal(m.contract_version, 'agt002-manizales-integral-manifest@1');
  assert.equal(m.status, AGT002_INTEGRAL_MANIFEST_STATUS);
  assert.equal(m.status, 'validated_candidate');
  assert.equal(m.version, 1);
  assert.equal(m.human_approval_required, true);
  assert.equal(m.human_approved, false);
  assert.equal(m.opportunity_id, AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID);
  assert.equal(m.proceso, AGT002_INTEGRAL_MANIFEST_PROCESO);
  assert.equal(m.generated_at, FIXED_AT);
});

test('closed top-level shape (no stray keys)', () => {
  const m = build();
  assert.deepEqual(Object.keys(m).sort(), [
    'artifact_type', 'contract_version', 'coverage', 'entries', 'generated_at',
    'human_approval_required', 'human_approved', 'human_gates', 'opportunity_id',
    'proceso', 'probative_limits', 'proposal_ledger', 'section_ledger', 'source_documents',
    'source_set', 'source_text_by_document_id', 'status', 'version',
  ].sort());
});

test('source_set proves the four governed inputs', () => {
  const m = build();
  assert.equal(m.source_set.registry.total_secciones, 68);
  assert.equal(m.source_set.registry.provenance, 17);
  assert.equal(m.source_set.section_proposals.sections, 10);
  assert.equal(m.source_set.section_proposals.requirements, 20);
  assert.equal(m.source_set.pre_go_analysis.secciones_relevantes_pre_go, 15);
  assert.equal(m.source_set.governed_overrides_066.bindings, 3);
  assert.deepEqual(m.source_set.governed_overrides_066.requirement_ids, Object.keys(AGT002_INTEGRAL_OVERRIDES_066));
});

test('exactly 17 source documents preserving provenance metadata', () => {
  const m = build();
  assert.equal(m.source_documents.length, 17);
  const ids = new Set(registry.provenance.map(p => p.document_id));
  const vigente = m.source_documents.filter(d => d.is_vigente);
  assert.ok(vigente.length >= 1);
  const precedences = m.source_documents.map(d => d.precedence).sort((a, b) => a - b);
  assert.deepEqual(precedences, m.source_documents.map((_, i) => i + 1));
  for (const d of m.source_documents) {
    assert.ok(ids.has(d.document_id));
    assert.equal(typeof d.hash, 'string');
    assert.ok(d.hash.length > 0);
    assert.equal(typeof d.version, 'string');
    assert.equal(typeof d.is_vigente, 'boolean');
  }
  // the definitive pliego is the highest-precedence vigente document
  const pliego = m.source_documents.find(d => d.document_id === 'db9752a1-e9ee-49af-b321-883d0c23cf0a');
  assert.equal(pliego.is_vigente, true);
  assert.equal(pliego.precedence, 1);
});

test('section_ledger is closed at exactly 15, each item once, valid disposition', () => {
  const m = build();
  assert.equal(m.section_ledger.length, 15);
  const refs = m.section_ledger.map(s => s.item_ref);
  assert.equal(new Set(refs).size, 15);
  const expected = ['1.3', '1.9', '2.1', '2.2', '2.3', '2.4', '2.4.1', '2.5', '2.6', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6'];
  assert.deepEqual([...refs].sort(), [...expected].sort());
  const entryIds = new Set(m.entries.map(e => e.requirement_id));
  for (const s of m.section_ledger) {
    assert.ok(AGT002_INTEGRAL_MANIFEST_DISPOSITIONS.includes(s.disposition));
    // analyzed/unresolved ledger items cannot have empty produced IDs
    if (s.disposition !== 'excluded_with_reason') {
      assert.ok(s.produced_requirement_ids.length > 0, `${s.item_ref} must produce ids`);
    } else {
      assert.ok(typeof s.reason === 'string' && s.reason.length > 0, 'exclusion needs a documentary reason');
    }
    // produced ids resolve into entries
    for (const id of s.produced_requirement_ids) assert.ok(entryIds.has(id), `${id} resolves into entries`);
  }
});

test('proposal_ledger is closed at exactly 20, each once, produced ids resolve', () => {
  const m = build();
  assert.equal(m.proposal_ledger.length, 20);
  const ids = m.proposal_ledger.map(p => p.requirement_id);
  assert.equal(new Set(ids).size, 20);
  const entryIds = new Set(m.entries.map(e => e.requirement_id));
  for (const p of m.proposal_ledger) {
    assert.ok(AGT002_INTEGRAL_MANIFEST_DISPOSITIONS.includes(p.disposition));
    assert.ok(p.produced_requirement_ids.length > 0);
    for (const id of p.produced_requirement_ids) assert.ok(entryIds.has(id));
  }
});

test('coverage proves the required counts and disposition tallies', () => {
  const m = build();
  assert.equal(m.coverage.registry_sections, 68);
  assert.equal(m.coverage.proposals, 20);
  assert.equal(m.coverage.proposal_sections, 10);
  assert.equal(m.coverage.governed_runtime, 4);
  assert.equal(m.coverage.governed_bindings_066, 3);
  assert.equal(m.coverage.section_ledger.total, 15);
  assert.equal(m.coverage.section_ledger.by_disposition.analyzed_candidate, 15);
  assert.equal(m.coverage.section_ledger.by_disposition.excluded_with_reason, 0);
  assert.equal(m.coverage.section_ledger.by_disposition.unresolved_visible, 0);
  assert.equal(m.coverage.proposal_ledger.total, 20);
  assert.equal(m.coverage.proposal_ledger.by_disposition.analyzed_candidate, 20);
  // tallies are internally consistent with the ledgers
  const tally = (ledger) => ledger.reduce((acc, x) => (acc[x.disposition] = (acc[x.disposition] || 0) + 1, acc), {});
  assert.equal(tally(m.section_ledger).analyzed_candidate, 15);
  assert.equal(tally(m.proposal_ledger).analyzed_candidate, 20);
});

test('entries: unique ids, closed shape, closed category and evidence vocab, no auto-approval', () => {
  const m = build();
  const ids = m.entries.map(e => e.requirement_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of m.entries) {
    assert.deepEqual(Object.keys(e).sort(), [
      'analyzable', 'category', 'citations', 'evidence_class_id', 'human_review_required',
      'item_ref', 'materiality', 'origin', 'requirement_id', 'source_refs', 'status', 'subsanability',
    ].sort());
    assert.ok(e.item_ref === null || typeof e.item_ref === 'string');
    assert.ok(AGT002_INTEGRAL_MANIFEST_CATEGORIES.includes(e.category) || e.category === null);
    assert.ok(e.evidence_class_id === null || AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(e.evidence_class_id));
    assert.notEqual(e.status, 'human_approved');
    // every entry has >=1 resolved source ref of an allowed type
    const allowed = new Set(['section_ledger', 'proposal_ledger', 'governed_runtime', 'registry_supplement']);
    const resolved = e.source_refs.filter(r => r.resolved && allowed.has(r.type));
    assert.ok(resolved.length >= 1, `${e.requirement_id} needs a resolved source ref`);
  }
});

test('the 4 governed runtime entries carry the 066 bindings and the deterministic técnico=>technical map', () => {
  const m = build();
  const byId = new Map(m.entries.map(e => [e.requirement_id, e]));
  assert.deepEqual([...AGT002_INTEGRAL_GOVERNED_RUNTIME_IDS].sort(), [
    'financial-working-capital', 'legal-collective-life-policy', 'legal-rce-policy', 'technical-video-surveillance-scope',
  ].sort());
  assert.equal(byId.get('financial-working-capital').category, 'habilitating');
  assert.equal(byId.get('financial-working-capital').evidence_class_id, 'rup');
  assert.equal(byId.get('legal-rce-policy').category, 'habilitating');
  assert.equal(byId.get('legal-rce-policy').evidence_class_id, 'rce_policy');
  assert.equal(byId.get('legal-collective-life-policy').category, 'habilitating');
  assert.equal(byId.get('legal-collective-life-policy').evidence_class_id, 'collective_life_policy');
  // no 066 binding: técnico=>technical, evidence stays candidate/null, never invents technical_certifications
  const tech = byId.get('technical-video-surveillance-scope');
  assert.equal(tech.category, 'technical');
  assert.equal(tech.evidence_class_id, null);
});

test('proposal entries: category from candidate map, evidence class is candidate 1:1 or null', () => {
  const m = build();
  const byId = new Map(m.entries.map(e => [e.requirement_id, e]));
  const expectCat = {
    '2.3': 'habilitating', '2.4': 'habilitating', '2.4.1': 'habilitating', '2.5': 'habilitating',
    '3.1': 'technical', '3.2': 'technical', '3.3': 'technical', '3.4': 'technical', '3.5': 'technical',
    '3.6': 'financial_execution',
  };
  for (const section of proposals.sections) {
    for (const r of section.requirements) {
      const e = byId.get(r.requirement_id);
      assert.ok(e, `${r.requirement_id} must be an entry`);
      assert.equal(e.origin, 'section_proposal');
      assert.equal(e.category, expectCat[section.item_ref]);
      assert.equal(e.evidence_class_id, r.candidate_evidence_class_id ?? null);
    }
  }
});

test('analyzable requires category + a vigente resolved full-span pliego citation', () => {
  const m = build();
  const pliegoId = 'db9752a1-e9ee-49af-b321-883d0c23cf0a';
  const text = m.source_text_by_document_id[pliegoId];
  assert.ok(text, 'source_text carries the vigente pliego fragments');
  for (const e of m.entries) {
    if (e.analyzable) {
      assert.notEqual(e.category, null);
      const good = e.citations.some((c) => {
        if (!c.is_vigente || !c.resolved) return false;
        const frag = text.fragments.find(f => f.char_start <= c.char_start && f.char_end >= c.char_end);
        return frag && frag.text.slice(c.char_start - frag.char_start, c.char_end - frag.char_start) === c.quote;
      });
      assert.ok(good, `${e.requirement_id} analyzable needs a resolved vigente full-span citation`);
    }
  }
  // all 20 proposal entries are analyzable; governed runtime + lifecycle are not (no full-span quote)
  const analyzable = m.entries.filter(e => e.analyzable);
  assert.equal(analyzable.length, 20);
  assert.ok(analyzable.every(e => e.origin === 'section_proposal'));
});

test('every proposal with pliego origin includes a vigente-pliego citation', () => {
  const m = build();
  const pliegoId = 'db9752a1-e9ee-49af-b321-883d0c23cf0a';
  for (const e of m.entries.filter(x => x.origin === 'section_proposal')) {
    assert.ok(e.citations.some(c => c.document_id === pliegoId && c.is_vigente));
  }
});

test('always emits a cierre/prórroga lifecycle gate from registry supplement, at least unresolved_visible', () => {
  const m = build();
  const gate = m.entries.find(e => e.origin === 'lifecycle_gate');
  assert.ok(gate, 'lifecycle gate entry is always present');
  assert.equal(gate.status, 'unresolved_visible');
  assert.equal(gate.analyzable, false);
  assert.equal(gate.human_review_required, true);
  const supp = gate.source_refs.find(r => r.type === 'registry_supplement');
  assert.ok(supp && supp.resolved, 'gate sourced from a real registry supplement section');
  assert.equal(supp.ref, '1.8');
});

test('material/scorable/economic requirements are never silently excluded', () => {
  const m = build();
  for (const e of m.entries) {
    if (['material', 'scorable', 'economic'].includes(e.materiality)) {
      assert.ok(['analyzed_candidate', 'unresolved_visible'].includes(e.status));
      assert.ok(e.analyzable || e.human_review_required, `${e.requirement_id} must stay analyzable or human-reviewed`);
    }
  }
});

test('validator round-trips the built artifact and rejects tampering', () => {
  const m = build();
  assert.equal(validateAgt002ManizalesIntegralManifest(m), m);
  const tampered = JSON.parse(JSON.stringify(m));
  tampered.human_approved = true;
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
  const tampered2 = JSON.parse(JSON.stringify(m));
  tampered2.entries[0].status = 'human_approved';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered2));
  const tampered3 = JSON.parse(JSON.stringify(m));
  tampered3.section_ledger.pop();
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered3));
});

test('build is deterministic (same inputs => byte-identical JSON)', () => {
  const a = JSON.stringify(build());
  const b = JSON.stringify(build());
  assert.equal(a, b);
});

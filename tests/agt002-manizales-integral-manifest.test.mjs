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
  // honest split: 5 governed source sections produce unresolved entries, 10 produce analyzable proposals
  assert.equal(m.coverage.section_ledger.by_disposition.analyzed_candidate, 10);
  assert.equal(m.coverage.section_ledger.by_disposition.excluded_with_reason, 0);
  assert.equal(m.coverage.section_ledger.by_disposition.unresolved_visible, 5);
  assert.equal(m.coverage.proposal_ledger.total, 20);
  assert.equal(m.coverage.proposal_ledger.by_disposition.analyzed_candidate, 20);
  // tallies are internally consistent with the ledgers
  const tally = (ledger) => ledger.reduce((acc, x) => (acc[x.disposition] = (acc[x.disposition] || 0) + 1, acc), {});
  assert.equal(tally(m.section_ledger).analyzed_candidate, 10);
  assert.equal(tally(m.section_ledger).unresolved_visible, 5);
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

test('validator recomputes citation resolution against source_text_by_document_id (rejects forged quote/char bounds)', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  const entry = tampered.entries.find(e => e.analyzable && e.citations.some(c => c.is_vigente && c.resolved));
  assert.ok(entry, 'fixture must have an analyzable entry with a resolved vigente citation');
  const citation = entry.citations.find(c => c.is_vigente && c.resolved);
  const span = citation.char_end - citation.char_start;
  // forge the quote text while keeping resolved:true and the entry analyzable:true: the span/quote
  // no longer match the real fragment in source_text_by_document_id, so validate must recompute
  // resolution from the source text rather than trust the stored `resolved` flag.
  citation.quote = '#'.repeat(span);
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

test('validator rejects unknown governed_runtime and nonexistent registry_supplement source_refs, while section_ledger/proposal_ledger refs still resolve', () => {
  const m = build();
  assert.equal(validateAgt002ManizalesIntegralManifest(m), m);

  const tamperedGoverned = JSON.parse(JSON.stringify(m));
  const govEntry = tamperedGoverned.entries.find(e => e.source_refs.some(r => r.type === 'governed_runtime'));
  assert.ok(govEntry, 'fixture must have a governed_runtime entry');
  govEntry.source_refs.find(r => r.type === 'governed_runtime').ref = 'unknown-governed-requirement-id';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tamperedGoverned));

  const tamperedSupplement = JSON.parse(JSON.stringify(m));
  const gateEntry = tamperedSupplement.entries.find(e => e.origin === 'lifecycle_gate');
  gateEntry.source_refs.find(r => r.type === 'registry_supplement').ref = '99.9';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tamperedSupplement));

  // section_ledger/proposal_ledger refs on the untouched artifact must keep resolving
  const withSectionRefs = m.entries.filter(e => e.source_refs.some(r => r.type === 'section_ledger'));
  const withProposalRefs = m.entries.filter(e => e.source_refs.some(r => r.type === 'proposal_ledger'));
  assert.ok(withSectionRefs.length > 0);
  assert.ok(withProposalRefs.length > 0);
});

test('build is deterministic (same inputs => byte-identical JSON)', () => {
  const a = JSON.stringify(build());
  const b = JSON.stringify(build());
  assert.equal(a, b);
});

// --- Phase 1 hardening ----------------------------------------------------------------------

test('source_set.registry persists the closed list of all 68 registry item refs', () => {
  const m = build();
  const refs = m.source_set.registry.registry_item_refs;
  assert.ok(Array.isArray(refs), 'registry_item_refs must be an array');
  assert.equal(refs.length, 68);
  assert.equal(new Set(refs).size, 68);
  const expected = registry.items.map(i => i.ref);
  assert.deepEqual([...refs].sort(), [...expected].sort());
});

test('validator rejects a registry_item_refs list that is not exactly 68 unique refs', () => {
  const m = build();
  const short = JSON.parse(JSON.stringify(m));
  short.source_set.registry.registry_item_refs.pop();
  assert.throws(() => validateAgt002ManizalesIntegralManifest(short));
  const dup = JSON.parse(JSON.stringify(m));
  dup.source_set.registry.registry_item_refs[0] = dup.source_set.registry.registry_item_refs[1];
  assert.throws(() => validateAgt002ManizalesIntegralManifest(dup));
});

test('validator rejects a section_ledger source_ref whose ref is not a real section_ledger item_ref', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  const e = tampered.entries.find(x => x.source_refs.some(r => r.type === 'section_ledger'));
  assert.ok(e, 'fixture must have a section_ledger source_ref');
  e.source_refs.find(r => r.type === 'section_ledger').ref = '9.9.9';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

test('validator rejects a proposal_ledger source_ref whose ref is not a real proposal_ledger requirement_id', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  const e = tampered.entries.find(x => x.source_refs.some(r => r.type === 'proposal_ledger'));
  assert.ok(e, 'fixture must have a proposal_ledger source_ref');
  e.source_refs.find(r => r.type === 'proposal_ledger').ref = 'not-a-real-proposal-requirement';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

test('validator rejects a registry_supplement source_ref that resolves to no registry section', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  const e = tampered.entries.find(x => x.source_refs.some(r => r.type === 'registry_supplement'));
  assert.ok(e, 'fixture must have a registry_supplement source_ref');
  e.source_refs.find(r => r.type === 'registry_supplement').ref = '99.9';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

test('governed entries only cite section_ledger for refs in the closed 15; others become registry_supplement', () => {
  const m = build();
  const ledgerRefs = new Set(m.section_ledger.map(s => s.item_ref));
  const governed = m.entries.filter(e => e.origin === 'governed_runtime');
  assert.equal(governed.length, 4);
  for (const e of governed) {
    // governed_runtime self-ref always present
    assert.ok(e.source_refs.some(r => r.type === 'governed_runtime' && r.ref === e.requirement_id));
    for (const r of e.source_refs) {
      if (r.type === 'section_ledger') assert.ok(ledgerRefs.has(r.ref), `section_ledger ref ${r.ref} must be in the closed 15`);
      if (r.type === 'registry_supplement') assert.ok(!ledgerRefs.has(r.ref), `registry_supplement ref ${r.ref} must be outside the closed 15`);
    }
  }
  // the two registry refs outside the closed 15 (1.2.1, 6.4) must appear as registry_supplement, never section_ledger
  const allRefs = governed.flatMap(e => e.source_refs);
  for (const outside of ['1.2.1', '6.4']) {
    assert.ok(allRefs.some(r => r.type === 'registry_supplement' && r.ref === outside), `${outside} must be registry_supplement`);
    assert.ok(!allRefs.some(r => r.type === 'section_ledger' && r.ref === outside), `${outside} must never be section_ledger`);
  }
});

test('governed runtime entries with unresolved citations are unresolved_visible, human-reviewed, never analyzed_candidate', () => {
  const m = build();
  for (const e of m.entries.filter(x => x.origin === 'governed_runtime')) {
    assert.equal(e.analyzable, false);
    assert.equal(e.status, 'unresolved_visible');
    assert.equal(e.human_review_required, true);
  }
});

test('validator rejects an analyzable:false entry mislabeled as analyzed_candidate', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  const e = tampered.entries.find(x => x.analyzable === false && x.status === 'unresolved_visible');
  assert.ok(e, 'fixture must have an unresolved entry');
  e.status = 'analyzed_candidate';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

test('validator rejects an analyzable:true entry not marked analyzed_candidate', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  const e = tampered.entries.find(x => x.analyzable === true);
  assert.ok(e, 'fixture must have an analyzable entry');
  e.status = 'unresolved_visible';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

test('section_ledger disposition is derived from produced entries: 5 unresolved (governed), 10 analyzed', () => {
  const m = build();
  const byId = new Map(m.entries.map(e => [e.requirement_id, e]));
  const unresolved = m.section_ledger.filter(s => s.disposition === 'unresolved_visible').map(s => s.item_ref);
  const analyzed = m.section_ledger.filter(s => s.disposition === 'analyzed_candidate').map(s => s.item_ref);
  assert.deepEqual([...unresolved].sort(), ['1.3', '1.9', '2.1', '2.2', '2.6']);
  assert.equal(analyzed.length, 10);
  // derivation is truthful: every unresolved ledger item produces an unresolved entry; analyzed produce only analyzable
  for (const s of m.section_ledger) {
    const produced = s.produced_requirement_ids.map(id => byId.get(id));
    if (s.disposition === 'analyzed_candidate') assert.ok(produced.every(e => e && e.analyzable));
    else assert.ok(produced.some(e => e && !e.analyzable));
  }
});

test('validator rejects a section_ledger disposition that disagrees with its produced entries', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  const s = tampered.section_ledger.find(x => x.disposition === 'unresolved_visible');
  assert.ok(s, 'fixture must have an unresolved ledger item');
  s.disposition = 'analyzed_candidate';
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

test('coverage tallies reflect the honest 10/5 section_ledger split and 5 unresolved entries', () => {
  const m = build();
  assert.equal(m.coverage.section_ledger.by_disposition.analyzed_candidate, 10);
  assert.equal(m.coverage.section_ledger.by_disposition.unresolved_visible, 5);
  assert.equal(m.coverage.section_ledger.by_disposition.excluded_with_reason, 0);
  // 4 governed runtime + 1 lifecycle gate produce unresolved entries; 20 proposals analyzable
  assert.equal(m.coverage.entries.analyzable, 20);
  assert.equal(m.coverage.entries.unresolved_visible, 5);
});

test('source document hash is a deterministic provenance-sha256 digest, not a content hash', () => {
  const m = build();
  for (const d of m.source_documents) {
    assert.match(d.hash, /^provenance-sha256:[0-9a-f]{64}$/, 'hash must be a prefixed sha-256 over provenance metadata');
  }
  // deterministic across builds
  const again = build();
  assert.deepEqual(m.source_documents.map(d => d.hash), again.source_documents.map(d => d.hash));
});

test('every citation hash equals its resolved source document hash', () => {
  const m = build();
  const byId = new Map(m.source_documents.map(d => [d.document_id, d]));
  for (const e of m.entries) {
    for (const c of e.citations) {
      assert.equal(c.hash, byId.get(c.document_id).hash);
    }
  }
});

test('validator recomputes the provenance hash and rejects a forged source document hash', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  tampered.source_documents[0].hash = 'provenance-sha256:' + '0'.repeat(64);
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

test('validator rejects a citation hash that does not equal the resolved source document hash', () => {
  const m = build();
  const tampered = JSON.parse(JSON.stringify(m));
  const e = tampered.entries.find(x => x.citations.length > 0);
  assert.ok(e, 'fixture must have a citation');
  e.citations[0].hash = 'provenance-sha256:' + 'f'.repeat(64);
  assert.throws(() => validateAgt002ManizalesIntegralManifest(tampered));
});

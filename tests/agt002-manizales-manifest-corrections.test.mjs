import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgt002ManizalesIntegralManifest,
  validateAgt002ManizalesIntegralManifest,
} from '../agt002-manizales-integral-manifest.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { REGISTRO_FASE_POR_CAPITULO } from '../agt002-contractual-registry-taxonomy.js';
import {
  applyManizalesManifestCorrections,
  buildManizalesManifestCorrectionsArtifact,
  AGT002_MANIFEST_CORRECTION_RULES,
} from '../agt002-manizales-manifest-corrections.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(resolve(PROJECT_ROOT, rel), 'utf8'));

const registry = readJson('docs/governance/registro/manizales-sa-24-2026.registry.json');
const analysis = readJson('docs/governance/analisis/manizales-sa-24-2026.pre-go-analysis.json');
const proposals = readJson('docs/governance/propuestas/manizales-sa-24-2026.section-proposals.json');

const FIXED_AT = '2026-08-15T00:00:00.000Z';
const cleanManifest = () => buildAgt002ManizalesIntegralManifest({ registry, analysis, proposals, generatedAt: FIXED_AT });
const clone = (value) => JSON.parse(JSON.stringify(value));
const entryOf = (m, id) => m.entries.find((e) => e.requirement_id === id);

// --- contract surface ------------------------------------------------------------------------

test('exposes the nine closed correction rules in a frozen deterministic order', () => {
  assert.ok(Object.isFrozen(AGT002_MANIFEST_CORRECTION_RULES));
  assert.deepEqual([...AGT002_MANIFEST_CORRECTION_RULES], [
    'citation-quote-equality',
    'vigencia-precedence',
    'atomization',
    'duplicate-collapse',
    'phase-reconciliation',
    'materiality-derivation',
    'subsanability-normalization',
    'candidate-evidence-validity',
    'suspicious-association',
  ]);
});

test('returns a { manifest, corrections } pair', () => {
  const result = applyManizalesManifestCorrections(cleanManifest());
  assert.ok(result && typeof result === 'object');
  assert.ok(result.manifest && typeof result.manifest === 'object');
  assert.ok(Array.isArray(result.corrections));
});

test('rejects a non-object manifest fail-closed', () => {
  assert.throws(() => applyManizalesManifestCorrections(null));
  assert.throws(() => applyManizalesManifestCorrections([]));
});

// --- purity / idempotency / no-op on the conformant artifact ---------------------------------

test('does not mutate the input manifest', () => {
  const input = cleanManifest();
  const snapshot = JSON.stringify(input);
  applyManizalesManifestCorrections(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('the Phase-1 conformant artifact needs zero corrections and is returned unchanged', () => {
  const input = cleanManifest();
  const { manifest, corrections } = applyManizalesManifestCorrections(input);
  assert.deepEqual(corrections, []);
  assert.equal(JSON.stringify(manifest), JSON.stringify(input));
  // corrected artifact still passes the untouched Phase-1 validator.
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

test('is idempotent: a second pass yields empty corrections and a byte-identical manifest', () => {
  const first = applyManizalesManifestCorrections(cleanManifest());
  const second = applyManizalesManifestCorrections(first.manifest);
  assert.deepEqual(second.corrections, []);
  assert.equal(JSON.stringify(second.manifest), JSON.stringify(first.manifest));
});

test('every correction record carries the closed shape', () => {
  // exercise a defect so at least one record exists.
  const m = clone(cleanManifest());
  entryOf(m, 'proposal:2.3:indices-capacidad-organizacional').citations[0].quote = 'texto que no coincide';
  const { corrections } = applyManizalesManifestCorrections(m);
  assert.ok(corrections.length >= 1);
  for (const c of corrections) {
    assert.deepEqual(Object.keys(c).sort(), ['after', 'basis_citation', 'before', 'requirement_id', 'rule'].sort());
    assert.ok(AGT002_MANIFEST_CORRECTION_RULES.includes(c.rule));
  }
});

// --- invariants: downgrade / abstention only, never promote ----------------------------------

function assertNeverPromotes(corrected) {
  assert.equal(corrected.human_approved, false);
  assert.equal(corrected.human_approval_required, true);
  assert.equal(corrected.status, 'validated_candidate');
  for (const e of corrected.entries) {
    assert.notEqual(e.status, 'human_approved');
    if (e.evidence_class_id !== null) assert.ok(AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(e.evidence_class_id));
  }
}

test('preserves the Phase-1 structural invariants after a correcting pass', () => {
  const m = clone(cleanManifest());
  entryOf(m, 'proposal:2.3:indices-capacidad-organizacional').citations[0].quote = 'no coincide';
  const { manifest } = applyManizalesManifestCorrections(m);
  assertNeverPromotes(manifest);
  assert.equal(manifest.source_documents.length, 17);
  assert.equal(manifest.source_set.registry.registry_item_refs.length, 68);
  assert.equal(manifest.section_ledger.length, 15);
  assert.equal(manifest.proposal_ledger.length, 20);
  assert.equal(manifest.entries.filter((e) => e.origin === 'governed_runtime').length, 4);
  assert.ok(manifest.entries.some((e) => e.origin === 'lifecycle_gate'));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

// --- Rule 1: citation quote equality ---------------------------------------------------------

test('rule 1 downgrades an entry whose quote no longer equals its source slice', () => {
  const m = clone(cleanManifest());
  const target = entryOf(m, 'proposal:2.4:experiencia-rup-unspsc-sumatoria');
  assert.equal(target.analyzable, true);
  target.citations[0].quote = 'esta cita fue alterada y no coincide con el fragmento';
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  const fixed = entryOf(manifest, 'proposal:2.4:experiencia-rup-unspsc-sumatoria');
  assert.equal(fixed.analyzable, false);
  assert.equal(fixed.status, 'unresolved_visible');
  assert.equal(fixed.human_review_required, true);
  assert.equal(fixed.citations[0].resolved, false);
  assert.ok(corrections.some((c) => c.rule === 'citation-quote-equality' && c.requirement_id === target.requirement_id));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

// --- Rule 2: vigencia / precedence -----------------------------------------------------------

test('rule 2 removes a superseded citation from grounding, keeping the vigente one', () => {
  const m = clone(cleanManifest());
  const superseded = m.source_documents.find((d) => d.is_vigente === false && d.version === 'superseded');
  const target = entryOf(m, 'proposal:2.5:regla-subsanabilidad');
  target.citations.push({
    document_id: superseded.document_id,
    version: superseded.version,
    hash: superseded.hash,
    is_vigente: false,
    precedence: superseded.precedence,
    char_start: 10,
    char_end: 40,
    quote: 'fragmento de un pliego superado',
    resolved: false,
  });
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  const fixed = entryOf(manifest, 'proposal:2.5:regla-subsanabilidad');
  assert.ok(fixed.citations.every((c) => c.is_vigente === true));
  assert.equal(fixed.analyzable, true); // vigente citation remains → still analyzable
  assert.ok(corrections.some((c) => c.rule === 'vigencia-precedence' && c.requirement_id === target.requirement_id));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

// --- Rule 3: atomization ---------------------------------------------------------------------

test('rule 3 splits a proposal carrying two disjoint citations into deterministic atomic entries', () => {
  const m = clone(cleanManifest());
  const target = entryOf(m, 'proposal:2.3:indices-capacidad-organizacional');
  // a real, resolvable second fragment from the vigente pliego (distinct, disjoint range).
  target.citations.push({
    document_id: 'db9752a1-e9ee-49af-b321-883d0c23cf0a',
    version: 'vigente',
    hash: m.source_documents[0].hash,
    is_vigente: true,
    precedence: 1,
    char_start: 94135,
    char_end: 94217,
    quote: 'Para el caso de los Consorcios o Uniones Temporales, mínimo uno de los integrantes',
    resolved: true,
  });
  const before = m.entries.length;
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  assert.equal(manifest.entries.length, before + 1);
  assert.equal(entryOf(manifest, 'proposal:2.3:indices-capacidad-organizacional'), undefined);
  const a1 = entryOf(manifest, 'proposal:2.3:indices-capacidad-organizacional#a1');
  const a2 = entryOf(manifest, 'proposal:2.3:indices-capacidad-organizacional#a2');
  assert.ok(a1 && a2);
  assert.equal(a1.citations.length, 1);
  assert.equal(a2.citations.length, 1);
  assert.ok(corrections.some((c) => c.rule === 'atomization'));
  // ledger produced ids were remapped to the atomic entries.
  const section = manifest.section_ledger.find((s) => s.item_ref === '2.3');
  assert.ok(section.produced_requirement_ids.includes('proposal:2.3:indices-capacidad-organizacional#a1'));
  assert.ok(!section.produced_requirement_ids.includes('proposal:2.3:indices-capacidad-organizacional'));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

test('rule 3 does not split a single-citation proposal that merely contains the word "y"', () => {
  const { corrections } = applyManizalesManifestCorrections(cleanManifest());
  assert.ok(!corrections.some((c) => c.rule === 'atomization'));
});

// --- Rule 4: duplicate collapse --------------------------------------------------------------

test('rule 4 collapses two entries with the same normalized label and item_ref', () => {
  const m = clone(cleanManifest());
  const original = entryOf(m, 'proposal:3.1:calidad-lenguaje-senas');
  const dupId = 'proposal:3.1:calidad-lenguaje-senas-copia';
  const dup = clone(original);
  dup.requirement_id = dupId;
  dup.source_refs = clone(original.source_refs);
  m.entries.push(dup);
  // mirror the duplicate in the proposal ledger with an identical normalized label.
  const ledgerRow = clone(m.proposal_ledger.find((p) => p.requirement_id === 'proposal:3.1:calidad-lenguaje-senas'));
  m.proposal_ledger.push({ ...ledgerRow, requirement_id: dupId, produced_requirement_ids: [dupId] });
  const before = m.entries.length;
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  assert.equal(manifest.entries.length, before - 1);
  assert.ok(corrections.some((c) => c.rule === 'duplicate-collapse'));
  assert.ok(manifest.entries.some((e) => e.requirement_id === 'proposal:3.1:calidad-lenguaje-senas'));
});

// --- Rule 5: phase reconciliation ------------------------------------------------------------

test('rule 5 reconciles a section_ledger fase against REGISTRO_FASE_POR_CAPITULO', () => {
  const m = clone(cleanManifest());
  const section = m.section_ledger.find((s) => s.item_ref === '2.3');
  assert.equal(section.fase, REGISTRO_FASE_POR_CAPITULO[2]);
  section.fase = 'generalidad'; // wrong: numeral 2 => habilitante
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  const fixed = manifest.section_ledger.find((s) => s.item_ref === '2.3');
  assert.equal(fixed.fase, REGISTRO_FASE_POR_CAPITULO[2]);
  assert.ok(corrections.some((c) => c.rule === 'phase-reconciliation'));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

// --- Rule 6: materiality derivation ----------------------------------------------------------

test('rule 6 abstains an unjustified material claim to undetermined, never guessing', () => {
  const m = clone(cleanManifest());
  const target = entryOf(m, 'proposal:2.5:regla-subsanabilidad'); // section_proposal, ordinary
  target.materiality = 'material';
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  const fixed = entryOf(manifest, 'proposal:2.5:regla-subsanabilidad');
  assert.equal(fixed.materiality, 'undetermined');
  assert.ok(corrections.some((c) => c.rule === 'materiality-derivation'));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

test('rule 6 leaves the governed material impediment (financial-working-capital) intact', () => {
  const { manifest, corrections } = applyManizalesManifestCorrections(cleanManifest());
  assert.equal(entryOf(manifest, 'financial-working-capital').materiality, 'material');
  assert.ok(!corrections.some((c) => c.rule === 'materiality-derivation'));
});

// --- Rule 7: subsanability normalization -----------------------------------------------------

test('rule 7 forces a regla_entidad proposal without company evidence to abstain', () => {
  const m = clone(cleanManifest());
  const target = entryOf(m, 'proposal:2.5:regla-subsanabilidad'); // requirement_kind regla_entidad, evidence null
  target.subsanability = 'subsanable_candidate';
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  const fixed = entryOf(manifest, 'proposal:2.5:regla-subsanabilidad');
  assert.equal(fixed.subsanability, 'no_determinada_requiere_humano');
  assert.ok(corrections.some((c) => c.rule === 'subsanability-normalization'));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

// --- Rule 8: candidate evidence validity -----------------------------------------------------

test('rule 8 nulls an evidence_class_id outside the closed catalogue of 17', () => {
  const m = clone(cleanManifest());
  const target = entryOf(m, 'proposal:2.4:experiencia-rup-unspsc-sumatoria');
  target.evidence_class_id = 'invented_class';
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  assert.equal(entryOf(manifest, target.requirement_id).evidence_class_id, null);
  assert.ok(corrections.some((c) => c.rule === 'candidate-evidence-validity'));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

test('rule 8 nulls a weak link: an evidence class named without any resolved vigente citation', () => {
  const m = clone(cleanManifest());
  const target = entryOf(m, 'proposal:2.4:regla-sumatoria-plural-experiencia'); // evidence null today
  target.evidence_class_id = 'rup';
  target.citations[0].quote = 'cita rota'; // no longer resolves -> weak, name-matched link
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  assert.equal(entryOf(manifest, target.requirement_id).evidence_class_id, null);
  assert.ok(corrections.some((c) => c.rule === 'candidate-evidence-validity'));
});

// --- Rule 9: suspicious association ----------------------------------------------------------

test('rule 9 removes an implausible economic-offer to operating-licence association', () => {
  const m = clone(cleanManifest());
  const target = entryOf(m, 'proposal:3.6:oferta-economica-anexo-9'); // economic materiality
  target.evidence_class_id = 'supervigilancia_operating_license';
  const { manifest, corrections } = applyManizalesManifestCorrections(m);
  assert.equal(entryOf(manifest, target.requirement_id).evidence_class_id, null);
  assert.ok(corrections.some((c) => c.rule === 'suspicious-association'));
  assert.doesNotThrow(() => validateAgt002ManizalesIntegralManifest(manifest));
});

// --- corrections artifact builder ------------------------------------------------------------

test('the corrections artifact is deterministic and tallies every rule', () => {
  const source = cleanManifest();
  const { corrections } = applyManizalesManifestCorrections(source);
  const a = buildManizalesManifestCorrectionsArtifact({ manifest: source, corrections, generatedAt: FIXED_AT });
  const b = buildManizalesManifestCorrectionsArtifact({ manifest: source, corrections, generatedAt: FIXED_AT });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.artifact_type, 'agt002_manizales_integral_manifest_corrections');
  assert.equal(a.human_approved, false);
  assert.equal(a.summary.total, corrections.length);
  for (const rule of AGT002_MANIFEST_CORRECTION_RULES) {
    assert.ok(Object.prototype.hasOwnProperty.call(a.summary.by_rule, rule));
  }
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  extractGovernedLegalRequirements,
  extractLegalRcePolicy,
  extractLegalCollectiveLifePolicy,
  buildGovernedRequirementAnalysis,
  extractLegalRequirements,
  AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS,
} from '../tender-requirement-extraction.js';

// ---------------------------------------------------------------------------
// HR-003 (docs/governance/2026-08-11-agt002-rama-judicial-human-review.md): the
// generic legal-guarantee-policy requirement is replaced, for the governed integral
// flow, by two closed requirements — legal-rce-policy (evidence class rce_policy) and
// legal-collective-life-policy (evidence class collective_life_policy) — distinguished
// by real textual context (RCE vs vida colectiva), never by the old generic
// /polizas?/ pattern. Post-award execution guarantees (pliego section 110 style
// clauses) are expressly excluded from both. No LLM, no invented compliance: pure
// deterministic regex/context classification, mirroring the discipline already used
// by extractLegalGuaranteePolicy/extractFinancialWorkingCapital.
// ---------------------------------------------------------------------------

const rceOnlyHabilitating = {
  id: 'doc-rce-only',
  name: 'Pliego.pdf',
  document_type: 'pliego',
  content: 'Capítulo II. Requisitos habilitantes. El proponente debe constituir póliza de responsabilidad civil extracontractual por el 5% del valor del contrato con vigencia de 12 meses contados desde la suscripción del contrato.',
};

const collectiveLifeOnlyHabilitating = {
  id: 'doc-life-only',
  name: 'Pliego.pdf',
  document_type: 'pliego',
  content: 'Capítulo II. Requisitos habilitantes. El proponente debe constituir póliza de seguro de vida colectivo por el 10% del valor del contrato con vigencia de 12 meses contados desde la suscripción del contrato.',
};

const bothPoliciesHabilitating = {
  id: 'doc-both',
  name: 'Pliego.pdf',
  document_type: 'pliego',
  content: 'El oferente debe presentar póliza de responsabilidad civil extracontractual por el 5% del valor del contrato con vigencia de 12 meses, y adicionalmente póliza de seguro de vida colectivo por el 10% del valor del contrato con vigencia de 12 meses.',
};

// Section-110-style clause: mentions RCE inside a post-award execution guarantee
// context (cronograma / garantías de ejecución del contrato, posteriores a la
// adjudicación) — this must never count as habilitating evidence for legal-rce-policy.
const postAwardExecutionGuaranteeOnly = {
  id: 'doc-post-award',
  name: 'Cronograma.pdf',
  document_type: 'pliego',
  content: 'Cronograma del proceso. El contratista adjudicatario deberá constituir la garantía de responsabilidad civil extracontractual como parte de las garantías de ejecución del contrato, posterior a la adjudicación, dentro de los 5 días siguientes.',
};

const mixedValidAndPostAward = {
  id: 'doc-mixed',
  name: 'Pliego.pdf',
  document_type: 'pliego',
  content: 'Capítulo II. Requisitos habilitantes. El proponente debe constituir póliza de responsabilidad civil extracontractual por el 5% del valor del contrato con vigencia de 12 meses. Más adelante, en el cronograma: el contratista adjudicatario deberá constituir la garantía de responsabilidad civil extracontractual como parte de las garantías de ejecución del contrato, posterior a la adjudicación.',
};

const noSignalDocument = {
  id: 'doc-no-signal',
  name: 'Cronograma.pdf',
  document_type: 'otro',
  content: 'El cronograma del proceso contempla audiencias y plazos de traslado, sin referencias adicionales.',
};

const emptyDocument = { id: 'doc-empty', name: 'Escaneo-ilegible.pdf', document_type: 'otro', content: '' };

test('extractGovernedLegalRequirements returns exactly the two closed requirement ids, never the generic one', () => {
  const { requirements } = extractGovernedLegalRequirements([bothPoliciesHabilitating]);
  const ids = requirements.map(requirement => requirement.id).sort();
  assert.deepEqual(ids, ['legal-collective-life-policy', 'legal-rce-policy']);
  assert.ok(!ids.includes('legal-guarantee-policy'));
});

test('extractLegalRcePolicy confirms only on real RCE context, not on the generic legacy pattern', () => {
  const { requirements } = extractLegalRcePolicy([rceOnlyHabilitating]);
  const rce = requirements.find(requirement => requirement.id === 'legal-rce-policy');
  assert.equal(rce.status, 'confirmed');
  assert.equal(rce.severity, 'critical');
  assert.ok(rce.values.some(value => value.kind === 'percentage'));
  assert.ok(rce.values.some(value => value.kind === 'duration'));
  assert.ok(rce.evidence.length >= 1);

  const { requirements: lifeRequirements } = extractLegalCollectiveLifePolicy([rceOnlyHabilitating]);
  const life = lifeRequirements.find(requirement => requirement.id === 'legal-collective-life-policy');
  assert.equal(life.status, 'pending', 'an RCE-only document must not produce collective-life evidence');
  assert.deepEqual(life.evidence, []);
});

test('extractLegalCollectiveLifePolicy confirms only on real vida colectiva context', () => {
  const { requirements } = extractLegalCollectiveLifePolicy([collectiveLifeOnlyHabilitating]);
  const life = requirements.find(requirement => requirement.id === 'legal-collective-life-policy');
  assert.equal(life.status, 'confirmed');
  assert.ok(life.values.some(value => value.kind === 'percentage'));
  assert.ok(life.values.some(value => value.kind === 'duration'));

  const { requirements: rceRequirements } = extractLegalRcePolicy([collectiveLifeOnlyHabilitating]);
  const rce = rceRequirements.find(requirement => requirement.id === 'legal-rce-policy');
  assert.equal(rce.status, 'pending', 'a vida-colectiva-only document must not produce RCE evidence');
  assert.deepEqual(rce.evidence, []);
});

test('a single document naming both policies is classified into both closed requirements independently', () => {
  const { requirements } = extractGovernedLegalRequirements([bothPoliciesHabilitating]);
  const rce = requirements.find(requirement => requirement.id === 'legal-rce-policy');
  const life = requirements.find(requirement => requirement.id === 'legal-collective-life-policy');
  assert.equal(rce.status, 'confirmed');
  assert.equal(life.status, 'confirmed');
  assert.notDeepEqual(rce.evidence, life.evidence);
});

test('post-award execution guarantee context (section 110 style) is excluded from legal-rce-policy evidence', () => {
  const { requirements } = extractLegalRcePolicy([postAwardExecutionGuaranteeOnly]);
  const rce = requirements.find(requirement => requirement.id === 'legal-rce-policy');
  assert.equal(rce.status, 'pending', 'a purely post-award execution-guarantee mention must not count as habilitating RCE evidence');
  assert.deepEqual(rce.evidence, []);
});

test('a document mixing a valid habilitating RCE mention with a post-award mention keeps only the valid one', () => {
  const { requirements } = extractLegalRcePolicy([mixedValidAndPostAward]);
  const rce = requirements.find(requirement => requirement.id === 'legal-rce-policy');
  assert.equal(rce.status, 'confirmed');
  assert.equal(rce.evidence.length, 1, 'the post-award mention must not be counted as a second evidence citation');
  assert.doesNotMatch(rce.evidence[0].excerpt, /ejecuci[oó]n del contrato/i);
});

test('documents with no signal produce pending status with no evidence for both split requirements', () => {
  const { requirements } = extractGovernedLegalRequirements([noSignalDocument]);
  for (const requirement of requirements) {
    assert.equal(requirement.status, 'pending');
    assert.deepEqual(requirement.evidence, []);
    assert.ok(typeof requirement.question === 'string' && requirement.question.length > 0);
  }
});

test('empty documents are tracked as unverifiable, same discipline as the generic extractor', () => {
  const { unverifiable_documents: unverifiable } = extractGovernedLegalRequirements([rceOnlyHabilitating, emptyDocument]);
  assert.deepEqual(unverifiable, [{ document_id: 'doc-empty', name: 'Escaneo-ilegible.pdf' }]);
});

test('extraction is deterministic regardless of document order', () => {
  const forward = extractGovernedLegalRequirements([rceOnlyHabilitating, collectiveLifeOnlyHabilitating, noSignalDocument]);
  const reversed = extractGovernedLegalRequirements([noSignalDocument, collectiveLifeOnlyHabilitating, rceOnlyHabilitating]);
  assert.deepEqual(forward, reversed);
});

test('buildGovernedRequirementAnalysis exposes four closed requirement ids and never the generic legal-guarantee-policy', () => {
  const analysis = buildGovernedRequirementAnalysis([bothPoliciesHabilitating], {});
  const ids = [...analysis.legal, ...analysis.financial, ...analysis.technical].map(requirement => requirement.id).sort();
  assert.deepEqual(ids, [
    'financial-working-capital',
    'legal-collective-life-policy',
    'legal-rce-policy',
    'technical-video-surveillance-scope',
  ]);
  assert.equal(analysis.coverage.total, 4);
});

test('the legacy v2 generic extractor is untouched: extractLegalRequirements still returns legal-guarantee-policy', () => {
  const { requirements } = extractLegalRequirements([bothPoliciesHabilitating]);
  assert.deepEqual(requirements.map(requirement => requirement.id), ['legal-guarantee-policy']);
});

test('governed citation patterns are exported for the draft generator to reuse, one entry per closed requirement id', () => {
  assert.ok(AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS['legal-rce-policy'].length >= 1);
  assert.ok(AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS['legal-collective-life-policy'].length >= 1);
  assert.ok(!Object.hasOwn(AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS, 'legal-guarantee-policy'));
});

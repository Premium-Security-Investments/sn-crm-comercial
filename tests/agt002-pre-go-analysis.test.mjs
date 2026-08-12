import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AGT002_PRE_GO_ANALYSIS_ARTIFACT_TYPE,
  AGT002_PRE_GO_ANALYSIS_STATUS,
  AGT002_PRE_GO_CROSS_STATES,
  AGT002_PRE_GO_FASE_EVIDENCE_POLICY,
  AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES,
  AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES,
  buildAgt002PreGoAnalysis,
  validateAgt002PreGoAnalysis,
} from '../agt002-pre-go-analysis.js';
import { buildAgt002CompanyEvidenceClasses } from '../agt002-company-evidence-classes.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';
import {
  buildAgt002PreGoSectionProposals,
  buildAgt002SectionProposalOverlayIndex,
} from '../agt002-pre-go-section-proposals.js';

const GENERATED_AT = '2026-08-12T00:00:00.000Z';
const HABILITATING = ['financial-working-capital', 'legal-rce-policy', 'legal-collective-life-policy'];
const LINK = {
  'financial-working-capital': 'rup',
  'legal-rce-policy': 'rce_policy',
  'legal-collective-life-policy': 'collective_life_policy',
};

function item(overrides) {
  return {
    item_id: `SA-24-2026#${overrides.ref}`,
    ref: overrides.ref,
    numeral: overrides.ref,
    titulo: overrides.titulo || `Sección ${overrides.ref}`,
    fase: overrides.fase,
    categoria: overrides.categoria || 'proceso',
    estado_probatorio: 'requisito_pliego',
    dimensiones: { presencia: 'observado', vigencia: 'vigente', aplicabilidad: 'no_determinada', cumplimiento: 'no_evaluado' },
    evidencia_empresarial: 'not_assessed',
    subsanabilidad: overrides.subsanabilidad || 'no_determinado',
    umbral: { detectado: false, senales: [], confianza: 'bajo' },
    sub_items: [],
    governed_requirement_ids: overrides.governed_requirement_ids || [],
    cite: { char_start: 0, char_end: 1, excerpt: 'x' },
  };
}

function baseRegistry(items, abstentions) {
  return {
    artifact_type: 'agt002_contractual_registry',
    status: 'draft_for_human_review',
    taxonomy_version: 'agt002-contractual-registry-taxonomy@1',
    opportunity_id: '54190e51-15fb-46af-b0aa-8f13461a3110',
    proceso: 'SA-24-2026',
    entidad: 'Rama Judicial — Manizales',
    vigente_pliego: { name: '9. Pliego de Condiciones Definitivo SA-24-2026.pdf' },
    items,
    abstentions: abstentions || [],
  };
}

// applicability abstention for every item (as the real registry has for all 68 sections)
function applicabilityAbstentions(items) {
  return items.map(i => ({ item_ref: i.ref, axis: 'aplicabilidad', reason: 'x', detail: 'y' }));
}

test('phase policy: only habilitante/puntuable are offer_requirement', () => {
  assert.equal(AGT002_PRE_GO_FASE_EVIDENCE_POLICY.habilitante, 'offer_requirement');
  assert.equal(AGT002_PRE_GO_FASE_EVIDENCE_POLICY.puntuable, 'offer_requirement');
  assert.equal(AGT002_PRE_GO_FASE_EVIDENCE_POLICY.postadjudicacion, 'post_award');
  assert.equal(AGT002_PRE_GO_FASE_EVIDENCE_POLICY.ejecucion_tecnica, 'post_award_execution');
});

test('post-award / execution / evaluation / generalidad phases are explained not_applicable_candidate', () => {
  const items = [
    item({ ref: '5.1', fase: 'ejecucion_tecnica' }),
    item({ ref: '6.1', fase: 'postadjudicacion' }),
    item({ ref: '4.1', fase: 'evaluacion' }),
    item({ ref: '1.1', fase: 'generalidad' }),
  ];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  for (const c of artifact.crossings) {
    assert.equal(c.pre_go_relevant, false, `${c.item_ref} no relevante`);
    assert.equal(c.cross_state, 'not_applicable_candidate');
    assert.match(c.reason, /^fase_/);
    assert.equal(c.dimensions.suficiencia, 'no_evaluada_humano');
  }
});

test('a Cap I generalidad section restating a habilitating governed requirement IS relevant', () => {
  const items = [item({ ref: '1.3', fase: 'generalidad', governed_requirement_ids: ['legal-collective-life-policy'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  assert.equal(artifact.crossings[0].pre_go_relevant, true);
});

test('a post-award section that drags a habilitating requirement stays NOT relevant (RCE offer != contractual)', () => {
  const items = [item({ ref: '6.4', fase: 'postadjudicacion', governed_requirement_ids: ['legal-rce-policy', 'technical-video-surveillance-scope'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  assert.equal(artifact.crossings[0].pre_go_relevant, false);
  assert.equal(artifact.crossings[0].cross_state, 'not_applicable_candidate');
});

test('relevant section with no evidence observed -> unverifiable (not missing)', () => {
  const items = [item({ ref: '2.2', fase: 'habilitante', governed_requirement_ids: ['financial-working-capital'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClasses: [], evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const c = artifact.crossings[0];
  assert.equal(c.cross_state, 'unverifiable');
  assert.equal(c.reason, 'clase_de_evidencia_no_observada_localmente');
});

test('relevant offer section with NO governed requirement -> unverifiable, mapping question + blocker', () => {
  const items = [item({ ref: '2.3', fase: 'habilitante' })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const c = artifact.crossings[0];
  assert.equal(c.cross_state, 'unverifiable');
  assert.equal(c.reason, 'seccion_relevante_sin_requisito_gobernado_mapeado');
  assert.ok(artifact.blockers.some(b => b.id === 'secciones_relevantes_sin_requisito_gobernado' && b.class === 'subsanable'));
});

test('CCTV governed requirement without evidence-class link stays in abstention (unverifiable)', () => {
  const items = [item({ ref: '2.1', fase: 'habilitante', subsanabilidad: 'no_subsanable', governed_requirement_ids: ['technical-video-surveillance-scope'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const c = artifact.crossings[0];
  assert.equal(c.cross_state, 'unverifiable');
  assert.ok(c.governed_evidence.some(g => g.rule_id === 'no_governed_evidence_class_link'));
  assert.ok(artifact.abstentions.module_abstentions.some(a => a.axis === 'videovigilancia_cctv' && a.scope.includes('2.1')));
});

test('observed evidence: present+valid+applicable+reviewed is capped to human_review_required by registry applicability abstention', () => {
  const { classes } = buildAgt002CompanyEvidenceClasses({
    asOf: new Date('2026-08-12T00:00:00.000Z'),
    registryEntries: [{
      entry_id: 'rup', document_class: 'RUP', existence_status: 'verified',
      human_review_status: 'approved', applicability_status: 'applicable',
      integration_active: true, expiry: '2030-01-01', updated_at: '2026-01-01T00:00:00.000Z',
    }],
  });
  const items = [item({ ref: '2.2', fase: 'habilitante', governed_requirement_ids: ['financial-working-capital'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClasses: classes, evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const c = artifact.crossings[0];
  assert.equal(c.cross_state, 'human_review_required');
  assert.equal(c.reason, 'aplicabilidad_de_la_seccion_es_decision_humana');
  assert.equal(c.dimensions.suficiencia, 'no_evaluada_humano');
});

test('observed evidence WITHOUT registry applicability abstention CAN reach satisfied_candidate (module capability)', () => {
  const { classes } = buildAgt002CompanyEvidenceClasses({
    asOf: new Date('2026-08-12T00:00:00.000Z'),
    registryEntries: [{
      entry_id: 'rup', document_class: 'RUP', existence_status: 'verified',
      human_review_status: 'approved', applicability_status: 'applicable',
      integration_active: true, expiry: '2030-01-01', updated_at: '2026-01-01T00:00:00.000Z',
    }],
  });
  const items = [item({ ref: '2.2', fase: 'habilitante', governed_requirement_ids: ['financial-working-capital'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, []), generatedAt: GENERATED_AT, // no abstention
    evidenceClasses: classes, evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  assert.equal(artifact.crossings[0].cross_state, 'satisfied_candidate');
});

test('observed but expired evidence -> stale; absent -> missing', () => {
  const stub = (entry_id, docClass, extra) => ({
    entry_id, document_class: docClass, existence_status: 'verified', human_review_status: 'approved',
    applicability_status: 'applicable', integration_active: true, updated_at: '2026-01-01T00:00:00.000Z', ...extra,
  });
  const { classes } = buildAgt002CompanyEvidenceClasses({
    asOf: new Date('2026-08-12T00:00:00.000Z'),
    registryEntries: [
      stub('rce_policy', 'RCE', { expiry: '2025-01-01' }), // expired -> stale
      // collective_life_policy absent -> not_verified stub -> missing
    ],
  });
  const items = [
    item({ ref: '2.1a', fase: 'habilitante', governed_requirement_ids: ['legal-rce-policy'] }),
    item({ ref: '2.1b', fase: 'habilitante', governed_requirement_ids: ['legal-collective-life-policy'] }),
  ];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClasses: classes, evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const byRef = Object.fromEntries(artifact.crossings.map(c => [c.item_ref, c.cross_state]));
  assert.equal(byRef['2.1a'], 'stale');
  assert.equal(byRef['2.1b'], 'missing');
});

test('legal verification is gated (hidden) without a legal_corpus_version', () => {
  const items = [item({ ref: '2.2', fase: 'habilitante', governed_requirement_ids: ['financial-working-capital'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING, legalCorpusVersion: null,
  });
  assert.equal(artifact.legal_verification.shown, false);
  assert.equal(artifact.legal_verification.gated_reason, 'legal_corpus_version_ausente');
  assert.ok(artifact.blockers.some(b => b.id === 'verificacion_juridica_no_disponible_sin_corpus'));
});

test('legal verification shown when a legal_corpus_version is provided, still not asserting compliance', () => {
  const items = [item({ ref: '2.2', fase: 'habilitante', governed_requirement_ids: ['financial-working-capital'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING, legalCorpusVersion: 'corpus-v1.1',
  });
  assert.equal(artifact.legal_verification.shown, true);
  assert.equal(artifact.legal_verification.legal_corpus_version, 'corpus-v1.1');
});

test('recommendation is only a candidate and human GO/NO-GO is mandatory', () => {
  const items = [item({ ref: '2.2', fase: 'habilitante', governed_requirement_ids: ['financial-working-capital'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  assert.equal(artifact.recommendation.recommendation_candidate, 'indeterminate');
  assert.equal(artifact.recommendation.human_go_no_go_required, true);
  assert.ok(Array.isArray(artifact.recommendation.arguments_for));
  assert.ok(Array.isArray(artifact.recommendation.arguments_against));
});

// --- Política material AGT-002 (piloto Manizales): sólo impedimentos MATERIALES bloquean --
test('material impediment and ordinary preparation category vocabularies are closed and disjoint', () => {
  assert.deepEqual([...AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES].sort(), [
    'capacidad_financiera_insuficiente',
    'experiencia_minima_insuficiente',
    'imposibilidad_tecnica_grave',
    'inhabilidad_incompatibilidad',
    'inviabilidad_economica_critica',
    'licencia_habilitante_esencial_imposible',
    'plazo_objetivamente_imposible',
  ]);
  assert.deepEqual([...AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES].sort(), [
    'armas_medios',
    'asignaciones',
    'certificados',
    'estructura_consorcio_ut',
    'firmas',
    'formatos',
    'garantias_polizas_emitir_modificar',
    'personal',
  ]);
  const overlap = AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES.filter(c => AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES.includes(c));
  assert.deepEqual(overlap, []);
});

test('an ORDINARY missing document (policy to be issued) does NOT block pre-GO: no no_subsanable blocker, no NO_GO_candidate, no human question — becomes a post_go_preparation action', () => {
  const { classes } = buildAgt002CompanyEvidenceClasses({ registryEntries: [] }); // all classes absent stubs
  const items = [item({ ref: '2.1', fase: 'habilitante', subsanabilidad: 'no_subsanable', governed_requirement_ids: ['legal-collective-life-policy'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClasses: classes, evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const c = artifact.crossings[0];
  assert.equal(c.cross_state, 'missing'); // honestly still missing: the module never fabricates sufficiency
  assert.ok(!artifact.blockers.some(b => b.id === 'documento_no_subsanable_ausente'));
  assert.notEqual(artifact.recommendation.recommendation_candidate, 'NO_GO_candidate');
  for (const q of artifact.indispensable_questions) {
    assert.doesNotMatch(q.question, /2\.1\b/, `pregunta "${q.id}" no debe referenciar un faltante ordinario`);
  }
  assert.equal(artifact.post_go_preparation.actions.length, 1);
  const action = artifact.post_go_preparation.actions[0];
  assert.equal(action.item_ref, '2.1');
  assert.equal(action.requirement_id, 'legal-collective-life-policy');
  assert.equal(action.category, 'garantias_polizas_emitir_modificar');
  assert.equal(action.gap_state, 'missing');
  assert.match(action.note, /compromiso/i);
  assert.equal(artifact.post_go_preparation.applies_on_go, true);
});

test('a MATERIAL missing impediment (capacidad financiera insuficiente) still produces a no_subsanable blocker and NO_GO_candidate', () => {
  const { classes } = buildAgt002CompanyEvidenceClasses({ registryEntries: [] }); // all classes absent stubs
  const items = [item({ ref: '2.2', fase: 'habilitante', subsanabilidad: 'no_determinado', governed_requirement_ids: ['financial-working-capital'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClasses: classes, evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const c = artifact.crossings[0];
  assert.equal(c.cross_state, 'missing');
  const blocker = artifact.blockers.find(b => b.id === 'documento_no_subsanable_ausente');
  assert.ok(blocker, 'existe el bloqueador de impedimento material');
  assert.equal(blocker.class, 'no_subsanable');
  assert.deepEqual(blocker.affected_item_refs, ['2.2']);
  assert.equal(artifact.recommendation.recommendation_candidate, 'NO_GO_candidate');
  assert.equal(artifact.post_go_preparation.actions.length, 0);
});

test('ORDINARY stale evidence (expired policy) is excluded from blockers/questions and becomes a post_go_preparation renewal action', () => {
  const { classes } = buildAgt002CompanyEvidenceClasses({
    registryEntries: [{
      entry_id: 'rce_policy', document_class: 'RCE', existence_status: 'verified', human_review_status: 'approved',
      applicability_status: 'applicable', integration_active: true, expiry: '2025-01-01', updated_at: '2026-01-01T00:00:00.000Z',
    }],
    asOf: new Date('2026-08-12T00:00:00.000Z'),
  });
  const items = [item({ ref: '2.1a', fase: 'habilitante', governed_requirement_ids: ['legal-rce-policy'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClasses: classes, evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  assert.equal(artifact.crossings[0].cross_state, 'stale');
  assert.ok(!artifact.blockers.some(b => b.id === 'documento_no_subsanable_ausente'));
  assert.notEqual(artifact.recommendation.recommendation_candidate, 'NO_GO_candidate');
  assert.equal(artifact.post_go_preparation.actions.length, 1);
  assert.equal(artifact.post_go_preparation.actions[0].gap_state, 'stale');
  assert.equal(artifact.post_go_preparation.actions[0].action, 'renovar_o_actualizar');
});

test('GO implies commitment note is present whenever post_go_preparation has actions', () => {
  const { classes } = buildAgt002CompanyEvidenceClasses({ registryEntries: [] });
  const items = [item({ ref: '2.1', fase: 'habilitante', governed_requirement_ids: ['technical-video-surveillance-scope'] })];
  // technical-video-surveillance-scope has no evidence class link in LINK: stays unverifiable, not missing.
  // Use a link that DOES map it, to exercise the ordinary/ missing path deterministically.
  const linkWithCctv = { ...LINK, 'technical-video-surveillance-scope': 'authorized_weapons_list' };
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClasses: classes, evidenceClassLinkByRequirementId: linkWithCctv, habilitatingGovernedRequirementIds: HABILITATING,
  });
  assert.equal(artifact.crossings[0].cross_state, 'missing');
  assert.equal(artifact.post_go_preparation.actions.length, 1);
  assert.equal(artifact.post_go_preparation.actions[0].category, 'armas_medios');
  assert.match(artifact.post_go_preparation.note, /compromiso/i);
  assert.ok(!artifact.blockers.some(b => b.id === 'documento_no_subsanable_ausente'));
  assert.notEqual(artifact.recommendation.recommendation_candidate, 'NO_GO_candidate');
});

test('an unclassified governed requirement id fails closed instead of silently defaulting to ordinary or material', () => {
  const items = [item({ ref: '9.9', fase: 'habilitante', governed_requirement_ids: ['unclassified-future-requirement'] })];
  assert.throws(() => buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: { 'unclassified-future-requirement': 'rup' },
    habilitatingGovernedRequirementIds: HABILITATING,
  }), /política material/i);
});

test('a governed link outside the 17-class catalog fails closed', () => {
  const items = [item({ ref: '2.2', fase: 'habilitante', governed_requirement_ids: ['financial-working-capital'] })];
  assert.throws(() => buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: { 'financial-working-capital': 'not-a-real-class' },
    habilitatingGovernedRequirementIds: HABILITATING,
  }), /catálogo cerrado de 17/);
});

test('cross states are all within the controlled vocabulary and the artifact validates + is PII-clean', () => {
  const items = [
    item({ ref: '2.1', fase: 'habilitante', subsanabilidad: 'no_subsanable', governed_requirement_ids: ['legal-rce-policy', 'technical-video-surveillance-scope'] }),
    item({ ref: '3.1', fase: 'puntuable' }),
    item({ ref: '6.1', fase: 'postadjudicacion' }),
  ];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  for (const c of artifact.crossings) assert.ok(AGT002_PRE_GO_CROSS_STATES.includes(c.cross_state));
  assert.equal(artifact.artifact_type, AGT002_PRE_GO_ANALYSIS_ARTIFACT_TYPE);
  assert.equal(artifact.status, AGT002_PRE_GO_ANALYSIS_STATUS);
  assert.ok(Array.isArray(artifact.post_go_preparation.actions));
  validateAgt002PreGoAnalysis(artifact);
  assertNoOpenPii(artifact);
});

test('validateAgt002PreGoAnalysis rejects an artifact without a well-formed post_go_preparation', () => {
  const items = [item({ ref: '2.2', fase: 'habilitante', governed_requirement_ids: ['financial-working-capital'] })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const broken = { ...artifact, post_go_preparation: { actions: 'not-an-array' } };
  assert.throws(() => validateAgt002PreGoAnalysis(broken), /post_go_preparation/);
});

// --- Overlay OPCIONAL de propuestas curadas -------------------------------------------
test('overlay is off by default: a relevant section with no governed requirement stays in the generic blocker', () => {
  const items = [item({ ref: '2.3', fase: 'habilitante' })];
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
  });
  const c = artifact.crossings[0];
  assert.equal(c.reason, 'seccion_relevante_sin_requisito_gobernado_mapeado');
  assert.equal(c.proposal_overlay, undefined);
  assert.ok(artifact.blockers.some(b => b.id === 'secciones_relevantes_sin_requisito_gobernado'));
  assert.ok(!artifact.blockers.some(b => b.id === 'secciones_con_propuesta_de_requisitos_para_revision_humana'));
  assert.equal(artifact.section_proposal_overlay.applied, false);
});

test('overlay applied via a plain ref->ids index moves the section out of the generic blocker into a proposed blocker', () => {
  const items = [item({ ref: '2.3', fase: 'habilitante' })];
  const overlay = { '2.3': { requirement_ids: ['proposal:2.3:x', 'proposal:2.3:y'], requirement_count: 2, status: 'proposed_for_human_review' } };
  const artifact = buildAgt002PreGoAnalysis({
    registry: baseRegistry(items, applicabilityAbstentions(items)), generatedAt: GENERATED_AT,
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
    sectionProposalOverlay: overlay,
  });
  const c = artifact.crossings[0];
  assert.equal(c.cross_state, 'unverifiable'); // una propuesta no es evidencia ni requisito aprobado
  assert.equal(c.reason, 'seccion_con_propuesta_curada_proposed_para_revision_humana');
  assert.equal(c.proposal_overlay.status, 'proposed_for_human_review');
  assert.equal(c.proposal_overlay.requirement_count, 2);
  assert.equal(c.proposal_overlay.human_approval_required, true);
  assert.ok(!artifact.blockers.some(b => b.id === 'secciones_relevantes_sin_requisito_gobernado'));
  const proposed = artifact.blockers.find(b => b.id === 'secciones_con_propuesta_de_requisitos_para_revision_humana');
  assert.ok(proposed, 'existe el bloqueador de propuesta');
  assert.equal(proposed.status, 'proposed_for_human_review');
  assert.deepEqual(proposed.affected_item_refs, ['2.3']);
  assert.equal(artifact.section_proposal_overlay.applied, true);
  assert.equal(artifact.section_proposal_overlay.is_approved, false);
  assert.equal(artifact.recommendation.human_go_no_go_required, true);
  validateAgt002PreGoAnalysis(artifact);
  assertNoOpenPii(artifact);
});

test('(real) overlay from the curated proposals clears the generic blocker for all 10 target sections, still human-gated', () => {
  const path = resolve(process.cwd(), 'docs/governance/registro/manizales-sa-24-2026.registry.json');
  if (!existsSync(path)) return;
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  const proposals = buildAgt002PreGoSectionProposals({ registry, generatedAt: GENERATED_AT });
  const overlay = buildAgt002SectionProposalOverlayIndex(proposals);
  const TARGET = ['2.3', '2.4', '2.4.1', '2.5', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6'];

  const artifact = buildAgt002PreGoAnalysis({
    registry, generatedAt: GENERATED_AT, evidenceClasses: [],
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING,
    sectionProposalOverlay: overlay,
  });
  const proposed = artifact.blockers.find(b => b.id === 'secciones_con_propuesta_de_requisitos_para_revision_humana');
  assert.ok(proposed, 'bloqueador de propuesta presente');
  assert.deepEqual(proposed.affected_item_refs, [...TARGET].sort());
  // El bloqueador genérico ya no debe listar ninguna de las 10 secciones cubiertas.
  const generic = artifact.blockers.find(b => b.id === 'secciones_relevantes_sin_requisito_gobernado');
  if (generic) {
    for (const ref of TARGET) assert.ok(!generic.affected_item_refs.includes(ref), `${ref} salió del bloqueador genérico`);
  }
  // Ninguna sección afirma cumplimiento: siguen unverifiable y el GO/NO-GO humano es obligatorio.
  for (const ref of TARGET) {
    const c = artifact.crossings.find(x => x.item_ref === ref);
    assert.equal(c.cross_state, 'unverifiable');
    assert.equal(c.proposal_overlay.status, 'proposed_for_human_review');
  }
  assert.equal(artifact.coverage.por_estado.satisfied_candidate, 0);
  assert.equal(artifact.section_proposal_overlay.applied, true);
  assert.equal(artifact.section_proposal_overlay.affected_item_refs.length, 10);
  assert.equal(artifact.recommendation.human_go_no_go_required, true);
  validateAgt002PreGoAnalysis(artifact);
  assertNoOpenPii(artifact);
});

test('generatedAt is required and must be a valid ISO timestamp (deterministic, no clock)', () => {
  const items = [item({ ref: '1.1', fase: 'generalidad' })];
  assert.throws(() => buildAgt002PreGoAnalysis({ registry: baseRegistry(items, []) }), /generatedAt/);
  assert.throws(() => buildAgt002PreGoAnalysis({ registry: baseRegistry(items, []), generatedAt: 'not-a-date' }), /generatedAt/);
});

// --- Cruce sobre el REGISTRO REAL de Manizales (si está presente) ----------------------
test('(real) crosses the committed Manizales registry: 68 sections, honest local states', () => {
  const path = resolve(process.cwd(), 'docs/governance/registro/manizales-sa-24-2026.registry.json');
  if (!existsSync(path)) return; // el registro es un artefacto generado; sin él, se omite
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  const artifact = buildAgt002PreGoAnalysis({
    registry, generatedAt: GENERATED_AT,
    evidenceClasses: [], // sin bóveda de evidencia local
    evidenceClassLinkByRequirementId: LINK, habilitatingGovernedRequirementIds: HABILITATING, legalCorpusVersion: null,
  });
  assert.equal(artifact.coverage.total_secciones, 68);
  // Sin evidencia local, ninguna sección puede alcanzar satisfied_candidate ni afirmar cumplimiento.
  assert.equal(artifact.coverage.por_estado.satisfied_candidate, 0);
  // La suma por estado cubre las 68 secciones.
  const sum = Object.values(artifact.coverage.por_estado).reduce((a, b) => a + b, 0);
  assert.equal(sum, 68);
  // Relevantes: 7 habilitantes + 6 puntuables + 2 (1.3/1.9 vida colectivo en Cap. I) = 15.
  assert.equal(artifact.coverage.secciones_relevantes_pre_go, 15);
  assert.equal(artifact.legal_verification.shown, false);
  assert.equal(artifact.recommendation.human_go_no_go_required, true);
  // Sin evidencia local no hay estados "missing"/"stale": el post_go_preparation existe pero vacío.
  assert.deepEqual(artifact.post_go_preparation.actions, []);
  validateAgt002PreGoAnalysis(artifact);
  assertNoOpenPii(artifact);
});

test('(real) with a synthetic evidence vault, the real Manizales item 2.1 (RCE/vida colectiva/CCTV, all ordinary) never blocks pre-GO on its own', () => {
  const path = resolve(process.cwd(), 'docs/governance/registro/manizales-sa-24-2026.registry.json');
  if (!existsSync(path)) return;
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  const { classes } = buildAgt002CompanyEvidenceClasses({ registryEntries: [] }); // all 17 classes absent
  const linkWithCctv = { ...LINK, 'technical-video-surveillance-scope': 'authorized_weapons_list' };
  const artifact = buildAgt002PreGoAnalysis({
    registry, generatedAt: GENERATED_AT, evidenceClasses: classes,
    evidenceClassLinkByRequirementId: linkWithCctv, habilitatingGovernedRequirementIds: HABILITATING, legalCorpusVersion: null,
  });
  const c21 = artifact.crossings.find(x => x.item_ref === '2.1');
  assert.equal(c21.cross_state, 'missing');
  assert.ok(!artifact.blockers.some(b => b.id === 'documento_no_subsanable_ausente' && b.affected_item_refs.includes('2.1')));
  const refsInPrep = artifact.post_go_preparation.actions.map(a => a.item_ref);
  assert.ok(refsInPrep.includes('2.1'));
  // 2.2 CAPACIDAD FINANCIERA is material and IS missing here: it still blocks and drives NO_GO.
  const c22 = artifact.crossings.find(x => x.item_ref === '2.2');
  assert.equal(c22.cross_state, 'missing');
  assert.ok(artifact.blockers.some(b => b.id === 'documento_no_subsanable_ausente' && b.affected_item_refs.includes('2.2')));
  assert.equal(artifact.recommendation.recommendation_candidate, 'NO_GO_candidate');
  validateAgt002PreGoAnalysis(artifact);
  assertNoOpenPii(artifact);
});

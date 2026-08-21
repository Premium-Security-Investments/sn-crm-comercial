import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  deriveAgt002ManizalesExerciseDecisionReview,
  validateAgt002ManizalesExerciseDecisionReviewFixture,
  AGT002_EXERCISE_REVIEW_ARTIFACT_TYPE,
  AGT002_EXERCISE_REVIEW_CONTRACT_VERSION,
} from '../agt002-manizales-exercise-decision-review.js';
import { AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES } from '../agt002-pre-go-analysis.js';
import {
  deriveAgt002ManizalesUnresolvedManifestEntries,
} from '../agt002-manizales-manifest-wiring.js';
import { selectAgt002ManizalesManifestSource } from '../agt002-manizales-manifest-source.js';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from '../agt002-manizales-integral-manifest.js';
import { runAgt002ManizalesV3LocalRun } from '../scripts/agt002-manizales-v3-local-run.mjs';
import { projectAgt002IntegralV3ToV2 } from '../agt002-v3-compatibility.js';

// AGT-002 Manizales · EJERCICIO (pre-cierre) · capa NO CANÓNICA de revisión de decisión.
//
// Prueba que la nueva capa (agt002-manizales-exercise-decision-review.js) es una proyección
// SEPARADA, genérica y opt-in sobre el integral_analysis canónico REAL (obtenido de una corrida
// real del motor V3 sobre el manifiesto gobernado checked-in, vía runAgt002ManizalesV3LocalRun —
// sin red/DB), que:
//   1. nunca muta ni reemplaza integral_analysis ni v2_projection (ambos permanecen intactos);
//   2. valida fail-closed el fixture de revisión versionado contra el canónico real, las
//      entradas unresolved_visible reales del manifiesto, y las citas reales del registro
//      contractual (docs/governance/registro/manizales-sa-24-2026.registry.json);
//   3. para el fixture revisado de Manizales produce exactamente: recommendation de flujo
//      "advance_conditionally", decisión humana pendiente/no lista, 0 blockers y 2
//      decision_questions (territorialidad/agencia
//      Manizales vigente §2.1#i11; licencia de comunicaciones MinTIC §2.1#i12), y el resto de
//      entradas clasificadas supported/preparation/not_applicable — nunca como pregunta.
// No hay red, DB, commit, push ni deploy en esta prueba.

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, 'fixtures/agt002-manizales-exercise-decision-review.v1.json');
const REGISTRY_PATH = resolve(HERE, '../docs/governance/registro/manizales-sa-24-2026.registry.json');

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

// Construye el índice REAL de citas del registro contractual (sub_item_id -> {item_ref,
// char_start}) para que el validador de la capa de ejercicio pueda cruzar cada
// registry_citation contra la fuente real, en lugar de confiar en el fixture.
function buildRealRegistryCitationIndex() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const index = new Map();
  for (const item of registry.items) {
    for (const subItem of item.sub_items || []) {
      index.set(subItem.sub_item_id, { item_ref: item.ref, char_start: subItem.cite.char_start });
    }
  }
  return index;
}

async function buildRealCanonicalIntegralAnalysis() {
  const result = await runAgt002ManizalesV3LocalRun();
  return result.envelope.integral_analysis;
}

function realManifestUnresolvedRequirementIds() {
  const source = selectAgt002ManizalesManifestSource({
    integralContractV3: true,
    opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
    process: AGT002_INTEGRAL_MANIFEST_PROCESO,
  });
  return new Set(deriveAgt002ManizalesUnresolvedManifestEntries(source).map(entry => entry.requirement_id));
}

const registryIndex = buildRealRegistryCitationIndex();
const manifestUnresolvedRequirementIds = realManifestUnresolvedRequirementIds();
const integralAnalysis = await buildRealCanonicalIntegralAnalysis();
const canonicalUnitIds = new Set(integralAnalysis.analysis_units.map(unit => unit.requirement_id));
const canonicalIntegralAnalysisSnapshot = JSON.parse(JSON.stringify(integralAnalysis));

const realOptions = { canonicalUnitIds, manifestUnresolvedRequirementIds, registryIndex };

// ---------------------------------------------------------------------------------------------
// 1. Sanity: the two decision-question source facts are real, checked-in governed sources —
//    not invented. (Confirms the registry citation index actually resolves them.)
// ---------------------------------------------------------------------------------------------
{
  assert.deepEqual(registryIndex.get('SA-24-2026#2.1#i11'), { item_ref: '2.1', char_start: 72323 });
  assert.deepEqual(registryIndex.get('SA-24-2026#2.1#i12'), { item_ref: '2.1', char_start: 73328 });
}

// ---------------------------------------------------------------------------------------------
// 2. Fail-closed fixture validation: a fabricated registry citation is rejected.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.id === 'exercise::territorialidad-agencia-manizales');
  target.evidence_refs[0].char_start = 1; // does not match the real registry citation
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /no coincide con la cita real del registro/,
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Fail-closed: decision_question without a closed material-impediment category is rejected.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.id === 'exercise::territorialidad-agencia-manizales');
  target.material_impediment_category = 'no_existe_en_el_catalogo';
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /no pertenece al catálogo cerrado/,
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Fail-closed: registry_supplement entry duplicating a real canonical unit id is rejected.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.id === 'exercise::territorialidad-agencia-manizales');
  target.requirement_id = [...canonicalUnitIds][0];
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /ya existe en integral_analysis canónico/,
  );
}

// ---------------------------------------------------------------------------------------------
// 5. Fail-closed: canonical_unit entry referencing an id absent from the real canonical run.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries[0];
  target.requirement_id = 'proposal:does-not-exist';
  target.evidence_refs = [{ type: 'manifest_requirement', requirement_id: 'proposal:does-not-exist' }];
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /no está en integral_analysis canónico/,
  );
}

// ---------------------------------------------------------------------------------------------
// 6. Fail-closed: `supported` may not cite only the requirement itself. A reviewed company-
//    evidence finding is mandatory; otherwise existence of the tender rule is mistaken for
//    evidence that SN satisfies it (the root probative error this exercise must prevent).
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'supported');
  target.evidence_refs = [{ type: 'manifest_requirement', requirement_id: target.requirement_id }];
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /supported.*hallazgo probatorio revisado/,
  );
}

// ---------------------------------------------------------------------------------------------
// 7. Fail-closed: production inputs that prove registry/manifest referential integrity are
//    mandatory. A future caller may not silently downgrade validation by omitting them.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const integralAnalysis = (await runAgt002ManizalesV3LocalRun()).envelope.integral_analysis;
  assert.throws(
    () => deriveAgt002ManizalesExerciseDecisionReview(integralAnalysis, fixture, {}),
    /manifestUnresolvedRequirementIds.*obligatorio/,
  );
}

// ---------------------------------------------------------------------------------------------
// 8. Fail-closed: every real canonical unit must be reviewed. A future canonical unit may not
//    disappear silently just because the fixture has not yet been updated.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const removedIndex = tampered.entries.findIndex(e => e.origin === 'canonical_unit');
  tampered.entries.splice(removedIndex, 1);
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /omisión de cobertura canónica/,
  );
}

// ---------------------------------------------------------------------------------------------
// 9. GREEN path: the real fixture over the real canonical run produces the exact target result.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const review = deriveAgt002ManizalesExerciseDecisionReview(integralAnalysis, fixture, realOptions);

  assert.equal(review.artifact_type, AGT002_EXERCISE_REVIEW_ARTIFACT_TYPE);
  assert.equal(review.contract_version, AGT002_EXERCISE_REVIEW_CONTRACT_VERSION);
  assert.equal(review.recommendation, 'advance_conditionally');
  assert.equal(review.decision_status, 'pending_human_decision');
  assert.equal(review.decision_ready, false);
  assert.equal(review.human_approval_required, true);
  assert.equal(review.routing_action, 'flag_for_responsible_person');
  assert.equal(review.external_communications_allowed, false);
  assert.equal(review.evidence_requests_allowed, true);
  assert.equal(review.blockers.length, 0);
  assert.equal(review.decision_questions.length, 2);
  assert.deepEqual(
    review.decision_questions.map(q => q.requirement_id).sort(),
    ['legal-communications-mintic-license', 'legal-territorial-agency-manizales'].sort(),
  );
  for (const question of review.decision_questions) {
    assert.ok(AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES.includes(question.material_impediment_category));
    assert.equal(question.evidence_refs[0].type, 'registry_citation');
  }

  // Rules, scoring criteria and obtainable/preparable documents never become questions.
  assert.equal(review.counts.decision_questions, 2);
  assert.equal(review.counts.blockers, 0);
  assert.equal(review.counts.supported + review.counts.preparation + review.counts.not_applicable + review.counts.decision_questions + review.counts.blockers, fixture.entries.length);

  // exercise_mode: the lifecycle gate is bypassed for the recommendation but stays fully visible.
  assert.deepEqual(review.exercise_mode, { active: true, bypassed_requirement_ids: ['lifecycle:cierre-prorroga'] });
  const gateFinding = review.not_applicable.find(f => f.requirement_id === 'lifecycle:cierre-prorroga');
  assert.ok(gateFinding, 'the lifecycle gate stays visible in not_applicable, never deleted');
  assert.equal(gateFinding.exercise_bypassed, true);
}

// Matriz obligatoria de `presentation` por reviewed_status (contrato exacto vinculante, §task-1-brief):
//   decision_question: title, missing, action_required obligatorios; summary opcional.
//   blocker:           title, summary, action_required obligatorios; missing opcional.
//   supported:         title, summary obligatorios; missing/action_required no exigidos.
//   preparation:       title, action_required obligatorios; summary/missing opcionales.
//   not_applicable:    presentation prohibido (no se renderiza en primera lectura).
// Únicas claves permitidas: title, summary, missing, action_required. Nunca `headline`.
function buildSyntheticBlockerEntry(presentation) {
  return {
    id: 'exercise::synthetic-blocker-presentation-test',
    requirement_id: 'lifecycle:cierre-prorroga',
    label: 'Entrada sintética de prueba (blocker) — sólo para la matriz de presentation',
    origin: 'manifest_unresolved_entry',
    reviewed_status: 'blocker',
    curability: 'curable',
    rationale: 'Entrada sintética usada únicamente para probar la matriz de presentation de blocker.',
    evidence_refs: [{ type: 'manifest_requirement', requirement_id: 'lifecycle:cierre-prorroga' }],
    ...(presentation !== undefined ? { presentation } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// 10. Fail-closed: `presentation` (objeto ausente) es obligatorio para todo reviewed_status
//     salvo `not_applicable`. Un objeto ausente nunca debe caer de vuelta a `rationale`.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'supported');
  delete target.presentation;
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /presentation es obligatorio/,
  );
}

// ---------------------------------------------------------------------------------------------
// 11. Fail-closed: `decision_question` exige `title`, `missing` y `action_required` (summary es
//     opcional). Falta cualquiera de los tres obligatorios ⇒ rechazo.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'decision_question');
  target.presentation = { title: 'Título de prueba', action_required: 'Acción de prueba requerida.' }; // falta "missing"
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /presentation\.missing es obligatorio/,
  );
}
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'decision_question');
  target.presentation = { title: 'Título de prueba', missing: 'Qué falta por confirmar.' }; // falta "action_required"
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /presentation\.action_required es obligatorio/,
  );
}

// ---------------------------------------------------------------------------------------------
// 12. Fail-closed: `preparation` exige `title` y `action_required` (summary/missing opcionales).
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'preparation');
  target.presentation = { title: 'Título de prueba' }; // falta "action_required"
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /presentation\.action_required es obligatorio/,
  );
}

// ---------------------------------------------------------------------------------------------
// 13. Fail-closed: `supported` exige `title` y `summary`; no exige `missing` ni `action_required`.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'supported');
  target.presentation = { title: 'Título de prueba' }; // falta "summary"
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /presentation\.summary es obligatorio/,
  );
}

// ---------------------------------------------------------------------------------------------
// 14. Fail-closed: `blocker` exige `title`, `summary` y `action_required` (missing opcional).
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  tampered.entries.push(buildSyntheticBlockerEntry({ title: 'Título de prueba', action_required: 'Acción de prueba requerida.' })); // falta "summary"
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /presentation\.summary es obligatorio/,
  );
}
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  tampered.entries.push(buildSyntheticBlockerEntry({ title: 'Título de prueba', summary: 'Resumen de prueba.' })); // falta "action_required"
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /presentation\.action_required es obligatorio/,
  );
}
{
  // GREEN-shaped: blocker con los tres campos obligatorios y sin "missing" (opcional) es válido.
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  tampered.entries.push(buildSyntheticBlockerEntry({ title: 'Título de prueba', summary: 'Resumen de prueba.', action_required: 'Acción de prueba requerida.' }));
  const review = validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions);
  assert.ok(review, 'blocker con title+summary+action_required (sin missing) debe validar');
}

// ---------------------------------------------------------------------------------------------
// 15. Fail-closed: campos vacíos rechazados — tanto un campo obligatorio vacío como un campo
//     opcional presente-pero-vacío.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'preparation');
  target.presentation = { title: 'Título de prueba', action_required: '' };
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /texto humano no vacío/,
  );
}
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'decision_question');
  target.presentation = { title: 'Título de prueba', missing: 'Qué falta.', action_required: 'Acción.', summary: '   ' }; // opcional presente pero vacío
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /texto humano no vacío/,
  );
}

// ---------------------------------------------------------------------------------------------
// 16. Fail-closed: claves no permitidas son rechazadas (conjunto cerrado). `headline` en
//     particular NUNCA se acepta — el contrato exacto sólo permite title/summary/missing/
//     action_required.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'supported');
  target.presentation = { title: 'Título de prueba', summary: 'Resumen de prueba.', extra_field: 'no permitido' };
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /campos no permitidos/,
  );
}
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'supported');
  target.presentation = { headline: 'Título de prueba', summary: 'Resumen de prueba.' };
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /campos no permitidos/,
  );
}

// ---------------------------------------------------------------------------------------------
// 17. Fail-closed: la copia humana nunca puede limitarse a repetir nomenclatura técnica
//     (identificadores snake_case) en lugar de lenguaje humano real.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'decision_question');
  target.presentation = { title: 'decision_question', missing: 'Qué falta.', action_required: 'Acción.' };
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /nomenclatura técnica/,
  );
}

// ---------------------------------------------------------------------------------------------
// 18. Fail-closed: `presentation` está prohibido en entradas `not_applicable` — ese cubo es
//     ruido/señal despriorizada y nunca debe crecer copia humana gobernada propia; tampoco se
//     renderiza en primera lectura.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const tampered = JSON.parse(JSON.stringify(fixture));
  const target = tampered.entries.find(e => e.reviewed_status === 'not_applicable');
  target.presentation = { title: 'Título de prueba', summary: 'Resumen de prueba.' };
  assert.throws(
    () => validateAgt002ManizalesExerciseDecisionReviewFixture(tampered, realOptions),
    /presentation sólo aplica/,
  );
}

// ---------------------------------------------------------------------------------------------
// 19. GREEN path: el fixture gobernado real cumple la matriz exacta por reviewed_status, con
//     únicamente las claves permitidas, congelado (Object.freeze), y sin presentation en
//     not_applicable.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const review = deriveAgt002ManizalesExerciseDecisionReview(integralAnalysis, fixture, realOptions);
  const ALLOWED_PRESENTATION_KEYS = ['title', 'summary', 'missing', 'action_required'];
  const REQUIRED_BY_STATUS = {
    decision_question: ['title', 'missing', 'action_required'],
    blocker: ['title', 'summary', 'action_required'],
    supported: ['title', 'summary'],
    preparation: ['title', 'action_required'],
  };

  for (const [status, bucketKey] of [
    ['supported', 'supported'],
    ['preparation', 'preparation'],
    ['decision_question', 'decision_questions'],
    ['blocker', 'blockers'],
  ]) {
    for (const finding of review[bucketKey]) {
      assert.ok(finding.presentation, `finding ${finding.id} (${status}) must carry governed human presentation`);
      const keys = Object.keys(finding.presentation);
      assert.ok(keys.every(key => ALLOWED_PRESENTATION_KEYS.includes(key)), `${finding.id}.presentation must only use allowed keys, got: ${keys.join(', ')}`);
      for (const requiredField of REQUIRED_BY_STATUS[status]) {
        assert.ok(Object.hasOwn(finding.presentation, requiredField), `${finding.id}.presentation.${requiredField} is required for ${status}`);
        assert.equal(typeof finding.presentation[requiredField], 'string');
        assert.ok(finding.presentation[requiredField].trim().length > 0, `${finding.id}.presentation.${requiredField} must be non-empty`);
      }
      assert.ok(Object.isFrozen(finding.presentation), `${finding.id}.presentation must be frozen (governed, immutable)`);
    }
  }
  for (const finding of review.not_applicable) {
    assert.equal(Object.hasOwn(finding, 'presentation'), false, `${finding.id} (not_applicable) must never carry presentation copy`);
  }
}

// ---------------------------------------------------------------------------------------------
// 7. Canonical integral_analysis and v2_projection are byte-identical / untouched by this layer.
// ---------------------------------------------------------------------------------------------
{
  const fixture = loadFixture();
  const v2ProjectionBefore = projectAgt002IntegralV3ToV2(integralAnalysis);
  deriveAgt002ManizalesExerciseDecisionReview(integralAnalysis, fixture, realOptions);
  const v2ProjectionAfter = projectAgt002IntegralV3ToV2(integralAnalysis);

  assert.deepEqual(integralAnalysis, canonicalIntegralAnalysisSnapshot, 'integral_analysis must never be mutated by the exercise layer');
  assert.deepEqual(v2ProjectionAfter, v2ProjectionBefore, 'v2_projection is unaffected by the exercise layer');
  // The existing v2 behavior (one question per abstained unit) is untouched — this is the
  // canonical noise the new layer exists alongside, not replaces.
  assert.equal(v2ProjectionBefore.questions.length, integralAnalysis.analysis_units.length);
}

console.log('agt002-manizales-exercise-decision-review: OK');

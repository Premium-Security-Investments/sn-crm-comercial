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

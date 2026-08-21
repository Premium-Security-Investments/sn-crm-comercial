// AGT-002 Manizales · capa NO CANÓNICA de revisión de decisión para EJERCICIO (pre-cierre).
//
// Qué es: un derivador puro, genérico y separado del proyector v2 canónico
// (agt002-v3-compatibility.js). NO modifica ni sustituye `integral_analysis` (canónico,
// inmutable) ni `v2_projection` (v2 existente, ver diseño §9-10): ambos se preservan
// intactos para cualquier consumidor existente. Esta capa consume un artefacto de FIXTURE
// versionado y validado — una revisión humana curada, con IDs estables y referencias reales
// a evidencia (sub_item_id/citas del registro contractual, o al propio requirement_id
// canónico) — y de ahí deriva una proyección de decisión revisada de 4/5 cubetas cerradas:
// `supported`, `preparation`, `not_applicable`, `decision_question` y (reservada, hoy vacía
// en el piloto) `blocker`.
//
// Por qué existe: la proyección v2 canónica trata TODA unidad abstained/
// human_validation_required como "question" visible (diseño §9.2, ver
// agt002-v3-compatibility.js:49-55) — correcto para v2, pero en una corrida gobernada donde
// las 20 unidades abstienen produce 20 preguntas, no una decisión empresarial. Esta capa NO
// cambia esa regla v2; añade una proyección alternativa, explícita y opt-in, cuya única
// pregunta de decisión es la que puede CONFIRMAR o DESCARTAR un impedimento material
// (catálogo cerrado AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES, reutilizado —nunca
// reimplementado— de agt002-pre-go-analysis.js).
//
// Regla dura de diseño — "genérica, no hardcodeada": este módulo NUNCA contiene lógica
// empresarial específica de Manizales (ningún `if requirement_id === '...'`). Toda
// clasificación específica (qué id es `supported`/`preparation`/`not_applicable`/
// `decision_question`, con qué referencia de evidencia) vive en el FIXTURE de datos
// (tests/fixtures/agt002-manizales-exercise-decision-review.v1.json), que este módulo sólo
// valida (fail-closed, integridad referencial contra el canónico real) y agrega.
//
// exercise_mode: un `entry` del fixture puede llevar `exercise_bypassed: true` para marcar
// que, en modo ejercicio (evaluación pre-cierre), esa entrada (p.ej. la compuerta de ciclo de
// vida cierre/prórroga §1.8) no cuenta contra la recomendación — pero permanece SIEMPRE
// visible en la salida (nunca se borra ni se omite): trazabilidad completa, nunca silenciosa.
//
// Sin I/O: no lee red/DB/reloj/disco. Pure function library.

import { AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES } from './agt002-pre-go-analysis.js';

export const AGT002_EXERCISE_REVIEW_ARTIFACT_TYPE = 'agt002_manizales_exercise_decision_review';
export const AGT002_EXERCISE_REVIEW_CONTRACT_VERSION = 'agt002-manizales-exercise-decision-review@1';

// Cerrado: cada entrada del fixture cae en exactamente una de estas 5 cubetas. `blocker` está
// reservada (hoy vacía en el piloto) para cuando una `decision_question` YA fue confirmada
// como impedimento material por un humano — nunca se infiere sola.
export const AGT002_EXERCISE_REVIEW_STATUSES = Object.freeze([
  'supported', 'preparation', 'not_applicable', 'decision_question', 'blocker',
]);

// Cerrado: de dónde viene la referencialidad de una entrada del fixture. Nunca se acepta un
// cuarto valor (fail-closed) — ver `validateEntryOrigin`.
const ENTRY_ORIGINS = Object.freeze(['canonical_unit', 'manifest_unresolved_entry', 'registry_supplement']);
const REVIEW_FINDING_DISPOSITIONS = Object.freeze(['supports', 'requires_verification']);

// Governed human-facing copy (`presentation`): mandatory for every reviewed_status except
// `not_applicable` (pure noise/deprioritized signal, never rendered on first read, never grows
// its own human copy). Closed field set — only {title, summary, missing, action_required}, each
// non-empty human language when present. Never a technical nomenclature echo (snake_case
// identifiers/status codes) of `rationale`, `reviewed_status`, etc. The REQUIRED subset is
// per-status (contrato exacto vinculante, task-1-brief); any allowed field not required for a
// given status is optional, but is still fully validated (non-empty, non-technical) when present.
const PRESENTATION_ALLOWED_FIELDS = Object.freeze(['title', 'summary', 'missing', 'action_required']);
const PRESENTATION_REQUIRED_FIELDS_BY_STATUS = Object.freeze({
  decision_question: Object.freeze(['title', 'missing', 'action_required']),
  blocker: Object.freeze(['title', 'summary', 'action_required']),
  supported: Object.freeze(['title', 'summary']),
  preparation: Object.freeze(['title', 'action_required']),
});
const TECHNICAL_NOMENCLATURE_PATTERN = /[a-z0-9]+_[a-z0-9_]+/;

const MATERIAL_IMPEDIMENT_CATEGORY_SET = new Set(AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireNonEmptyString(value, label) {
  if (!nonEmptyString(value)) throw new Error(`AGT-002 ejercicio-revisión: ${label} debe ser texto no vacío.`);
  return value.trim();
}

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label} inválido (${String(value)}); esperado uno de [${allowed.join(', ')}].`);
  }
  return value;
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) throw new Error(`AGT-002 ejercicio-revisión: ${label} debe ser un entero.`);
  return value;
}

// Una referencia de evidencia es SIEMPRE una cita real: al registro contractual (sub_item_id +
// item_ref + char_start, cruzada contra `registryIndex` cuando se provee) o al propio
// requirement_id canónico/del manifiesto (para entradas que YA son una unidad real). Nunca
// texto libre ni excerpt crudo (mismo principio que agt002-manizales-manifest-wiring.js: nunca
// copiar cita/quote cruda fuera de este módulo).
function validateEvidenceRef(ref, label, { registryIndex, reviewFindingIndex } = {}) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label} debe ser un objeto.`);
  }
  requireEnum(ref.type, ['registry_citation', 'manifest_requirement', 'review_finding'], `${label}.type`);
  if (ref.type === 'registry_citation') {
    const itemRef = requireNonEmptyString(ref.item_ref, `${label}.item_ref`);
    const subItemId = requireNonEmptyString(ref.sub_item_id, `${label}.sub_item_id`);
    requireInteger(ref.char_start, `${label}.char_start`);
    if (registryIndex) {
      const real = registryIndex.get(subItemId);
      if (!real) {
        throw new Error(`AGT-002 ejercicio-revisión: ${label}.sub_item_id "${subItemId}" no existe en el registro real (fail-closed, no se fabrica evidencia).`);
      }
      if (real.item_ref !== itemRef || real.char_start !== ref.char_start) {
        throw new Error(`AGT-002 ejercicio-revisión: ${label} no coincide con la cita real del registro para "${subItemId}".`);
      }
    }
  } else if (ref.type === 'manifest_requirement') {
    requireNonEmptyString(ref.requirement_id, `${label}.requirement_id`);
  } else {
    const findingId = requireNonEmptyString(ref.finding_id, `${label}.finding_id`);
    if (!reviewFindingIndex?.has(findingId)) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label}.finding_id "${findingId}" no existe en review_findings (fail-closed).`);
    }
  }
}

function validateReviewFindings(fixture) {
  if (!Array.isArray(fixture.review_findings) || fixture.review_findings.length === 0) {
    throw new Error('AGT-002 ejercicio-revisión: review_findings debe ser un arreglo no vacío.');
  }
  const index = new Map();
  fixture.review_findings.forEach((finding, findingIndex) => {
    const label = `review_findings[${findingIndex}]`;
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label} debe ser un objeto.`);
    }
    const id = requireNonEmptyString(finding.id, `${label}.id`);
    if (index.has(id)) throw new Error(`AGT-002 ejercicio-revisión: review finding duplicado: ${id}.`);
    requireEnum(finding.disposition, REVIEW_FINDING_DISPOSITIONS, `${label}.disposition`);
    requireNonEmptyString(finding.source_id, `${label}.source_id`);
    requireNonEmptyString(finding.locator, `${label}.locator`);
    requireNonEmptyString(finding.summary, `${label}.summary`);
    index.set(id, finding);
  });
  return index;
}

function validateEntryOrigin(entry, label, { canonicalUnitIds, manifestUnresolvedRequirementIds }) {
  requireEnum(entry.origin, ENTRY_ORIGINS, `${label}.origin`);
  if (entry.origin === 'canonical_unit') {
    if (canonicalUnitIds && !canonicalUnitIds.has(entry.requirement_id)) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label} declara origin "canonical_unit" pero "${entry.requirement_id}" no está en integral_analysis canónico.`);
    }
  } else if (entry.origin === 'manifest_unresolved_entry') {
    if (manifestUnresolvedRequirementIds && !manifestUnresolvedRequirementIds.has(entry.requirement_id)) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label} declara origin "manifest_unresolved_entry" pero "${entry.requirement_id}" no está en las entradas unresolved_visible del manifiesto.`);
    }
  } else {
    // registry_supplement: un requisito NUEVO no gobernado hoy por el manifiesto canónico ni
    // por sus entradas unresolved_visible — debe ser realmente nuevo (nunca duplicar un id que
    // ya vive en el canónico) y debe traer al menos una cita real al registro.
    if (canonicalUnitIds && canonicalUnitIds.has(entry.requirement_id)) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label} declara origin "registry_supplement" pero "${entry.requirement_id}" ya existe en integral_analysis canónico.`);
    }
    if (manifestUnresolvedRequirementIds && manifestUnresolvedRequirementIds.has(entry.requirement_id)) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label} declara origin "registry_supplement" pero "${entry.requirement_id}" ya existe como unresolved_visible del manifiesto.`);
    }
    if (!entry.evidence_refs.some(ref => ref.type === 'registry_citation')) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label} origin "registry_supplement" exige al menos una evidence_ref de tipo registry_citation.`);
    }
  }
}

function validatePresentationCopy(value, label) {
  if (!nonEmptyString(value)) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label} debe ser texto humano no vacío.`);
  }
  if (TECHNICAL_NOMENCLATURE_PATTERN.test(value)) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label} no puede copiar nomenclatura técnica (identificadores snake_case); debe ser lenguaje humano.`);
  }
}

function validatePresentation(entry, label) {
  const requiredFields = PRESENTATION_REQUIRED_FIELDS_BY_STATUS[entry.reviewed_status];
  if (!requiredFields) {
    if (entry.presentation !== undefined) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label}.presentation sólo aplica a reviewed_status distinto de "not_applicable".`);
    }
    return;
  }
  if (!entry.presentation || typeof entry.presentation !== 'object' || Array.isArray(entry.presentation)) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label}.presentation es obligatorio (copia humana gobernada) para reviewed_status "${entry.reviewed_status}".`);
  }
  const presentationKeys = Object.keys(entry.presentation);
  const disallowed = presentationKeys.filter(key => !PRESENTATION_ALLOWED_FIELDS.includes(key));
  if (disallowed.length > 0) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label}.presentation contiene campos no permitidos: ${disallowed.join(', ')}.`);
  }
  for (const field of requiredFields) {
    if (!Object.hasOwn(entry.presentation, field)) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label}.presentation.${field} es obligatorio para reviewed_status "${entry.reviewed_status}".`);
    }
  }
  for (const field of presentationKeys) {
    validatePresentationCopy(entry.presentation[field], `${label}.presentation.${field}`);
  }
}

function validateEntry(entry, index, options) {
  const label = `entries[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label} debe ser un objeto.`);
  }
  requireNonEmptyString(entry.id, `${label}.id`);
  requireNonEmptyString(entry.requirement_id, `${label}.requirement_id`);
  requireNonEmptyString(entry.label, `${label}.label`);
  requireEnum(entry.reviewed_status, AGT002_EXERCISE_REVIEW_STATUSES, `${label}.reviewed_status`);
  requireNonEmptyString(entry.rationale, `${label}.rationale`);
  if (!Array.isArray(entry.evidence_refs) || entry.evidence_refs.length === 0) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label}.evidence_refs debe ser un arreglo no vacío (nunca una pregunta/decisión sin referencia).`);
  }
  entry.evidence_refs.forEach((ref, refIndex) => validateEvidenceRef(ref, `${label}.evidence_refs[${refIndex}]`, options));
  validateEntryOrigin(entry, label, options);

  const reviewFindings = entry.evidence_refs
    .filter(ref => ref.type === 'review_finding')
    .map(ref => options.reviewFindingIndex.get(ref.finding_id));
  if (entry.reviewed_status === 'supported'
      && !reviewFindings.some(finding => finding.disposition === 'supports')) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label} supported exige un hallazgo probatorio revisado con disposition "supports"; el requisito por sí solo no prueba cumplimiento.`);
  }

  if (entry.reviewed_status === 'decision_question') {
    const category = requireNonEmptyString(entry.material_impediment_category, `${label}.material_impediment_category`);
    if (!MATERIAL_IMPEDIMENT_CATEGORY_SET.has(category)) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label}.material_impediment_category "${category}" no pertenece al catálogo cerrado AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES (fail-closed: una decision_question sólo existe si resolverla puede confirmar/descartar un impedimento material).`);
    }
    if (!entry.evidence_refs.some(ref => ref.type === 'registry_citation')) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label} decision_question exige una cita contractual real.`);
    }
    if (!reviewFindings.some(finding => finding.disposition === 'requires_verification')) {
      throw new Error(`AGT-002 ejercicio-revisión: ${label} decision_question exige un hallazgo revisado que documente la verificación pendiente.`);
    }
  } else if (entry.material_impediment_category !== undefined) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label}.material_impediment_category sólo aplica a reviewed_status "decision_question".`);
  }

  if (entry.exercise_bypassed !== undefined && typeof entry.exercise_bypassed !== 'boolean') {
    throw new Error(`AGT-002 ejercicio-revisión: ${label}.exercise_bypassed debe ser booleano cuando está presente.`);
  }
  if (entry.reviewed_status === 'blocker') {
    requireEnum(entry.curability, ['curable', 'not_curable'], `${label}.curability`);
  } else if (entry.curability !== undefined) {
    throw new Error(`AGT-002 ejercicio-revisión: ${label}.curability sólo aplica a reviewed_status "blocker".`);
  }

  validatePresentation(entry, label);
}

/**
 * Valida estructural y referencialmente el fixture de revisión de ejercicio (fail-closed).
 * Nunca confía en el fixture verbatim: cada entrada se re-verifica contra el `integral_analysis`
 * canónico real (`canonicalUnitIds`), las entradas unresolved_visible reales del manifiesto
 * (`manifestUnresolvedRequirementIds`) y el índice real obligatorio de citas del registro
 * contractual (`registryIndex`). También exige cobertura explícita de cada unidad canónica:
 * nunca fabrica, asume ni omite una referencia de evidencia.
 *
 * @param {object} fixture
 * @param {object} options
 * @param {Set<string>} options.canonicalUnitIds IDs reales de `integral_analysis.analysis_units[].requirement_id`.
 * @param {Set<string>} options.manifestUnresolvedRequirementIds IDs reales unresolved_visible del manifiesto.
 * @param {Map<string,{item_ref:string, char_start:number}>} options.registryIndex Índice real de sub_item_id -> cita.
 * @returns {object} el mismo fixture (no clonado, no mutado) si es válido.
 */
export function validateAgt002ManizalesExerciseDecisionReviewFixture(fixture, options = {}) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    throw new Error('AGT-002 ejercicio-revisión: el fixture debe ser un objeto.');
  }
  if (!(options.canonicalUnitIds instanceof Set)) {
    throw new Error('AGT-002 ejercicio-revisión: canonicalUnitIds es obligatorio para integridad referencial fail-closed.');
  }
  if (!(options.manifestUnresolvedRequirementIds instanceof Set)) {
    throw new Error('AGT-002 ejercicio-revisión: manifestUnresolvedRequirementIds es obligatorio para integridad referencial fail-closed.');
  }
  if (!(options.registryIndex instanceof Map)) {
    throw new Error('AGT-002 ejercicio-revisión: registryIndex es obligatorio para integridad referencial fail-closed.');
  }
  if (fixture.artifact_type !== AGT002_EXERCISE_REVIEW_ARTIFACT_TYPE) {
    throw new Error('AGT-002 ejercicio-revisión: artifact_type inesperado.');
  }
  if (fixture.contract_version !== AGT002_EXERCISE_REVIEW_CONTRACT_VERSION) {
    throw new Error('AGT-002 ejercicio-revisión: contract_version inesperado.');
  }
  requireInteger(fixture.version, 'version');
  if (fixture.status !== 'draft_for_human_review' || fixture.human_approval_required !== true) {
    throw new Error('AGT-002 ejercicio-revisión: el fixture debe permanecer draft_for_human_review y exigir aprobación humana.');
  }
  if (fixture.exercise_mode !== true) {
    throw new Error('AGT-002 ejercicio-revisión: exercise_mode debe ser true (este fixture es exclusivamente para evaluación de EJERCICIO pre-cierre).');
  }
  requireNonEmptyString(fixture.opportunity_id, 'opportunity_id');
  if (!Array.isArray(fixture.entries) || fixture.entries.length === 0) {
    throw new Error('AGT-002 ejercicio-revisión: entries debe ser un arreglo no vacío.');
  }

  const reviewFindingIndex = validateReviewFindings(fixture);
  const seen = new Set();
  fixture.entries.forEach((entry, index) => {
    validateEntry(entry, index, { ...options, reviewFindingIndex });
    if (seen.has(entry.id)) {
      throw new Error(`AGT-002 ejercicio-revisión: id duplicado: ${entry.id}.`);
    }
    seen.add(entry.id);
  });

  const representedCanonicalIds = new Set(
    fixture.entries
      .filter(entry => entry.origin === 'canonical_unit')
      .map(entry => entry.requirement_id),
  );
  const missingCanonicalIds = [...options.canonicalUnitIds]
    .filter(requirementId => !representedCanonicalIds.has(requirementId));
  if (missingCanonicalIds.length > 0) {
    throw new Error(`AGT-002 ejercicio-revisión: omisión de cobertura canónica: ${missingCanonicalIds.join(', ')}. Toda unidad canónica exige revisión explícita.`);
  }
  return fixture;
}

function toFinding(entry) {
  return Object.freeze({
    id: entry.id,
    requirement_id: entry.requirement_id,
    label: entry.label,
    reviewed_status: entry.reviewed_status,
    rationale: entry.rationale,
    evidence_refs: entry.evidence_refs.map(ref => Object.freeze({ ...ref })),
    ...(entry.reviewed_status === 'decision_question' ? { material_impediment_category: entry.material_impediment_category } : {}),
    ...(entry.reviewed_status === 'blocker' ? { curability: entry.curability } : {}),
    ...(entry.exercise_bypassed === true ? { exercise_bypassed: true } : {}),
    ...(entry.presentation ? { presentation: Object.freeze({ ...entry.presentation }) } : {}),
  });
}

// Agregación genérica (no específica de Manizales): un bloqueador ya confirmado como no
// subsanable fuerza `do_not_advance`; cualquier otro bloqueador fuerza `pause`; sin
// bloqueadores pero con preguntas de decisión o acciones de preparación ⇒
// `advance_conditionally` (avance del FLUJO PROBATORIO, nunca GO empresarial); sólo sin
// bloqueadores, preguntas ni preparación puede ser `advance`. La decisión empresarial siempre
// permanece pendiente del humano en esta capa. Esta capa sólo resalta el caso a la persona
// responsable: puede solicitar aclaraciones o soportes dentro de SIIO (la encargada responde y
// adjunta evidencia ahí mismo), pero nunca envía comunicaciones externas ni decide GO/NO-GO.
function deriveExerciseRecommendation(byStatus) {
  if (byStatus.blocker.some(finding => finding.curability === 'not_curable')) return 'do_not_advance';
  if (byStatus.blocker.length > 0) return 'pause';
  if (byStatus.decision_question.length > 0 || byStatus.preparation.length > 0) return 'advance_conditionally';
  return 'advance';
}

/**
 * Deriva la proyección de decisión revisada de EJERCICIO a partir del `integral_analysis`
 * canónico (leído sólo para integridad referencial — nunca mutado, nunca copiado en la salida)
 * y de un fixture de revisión ya versionado. Pura, determinista, sin I/O. El canónico y
 * `v2_projection` existentes permanecen completamente intactos: esta función nunca los toca ni
 * los sustituye — es una CAPA NUEVA, separada y opt-in.
 *
 * @param {object} integralAnalysis El `integral_analysis` canónico validado (v3), sólo lectura.
 * @param {object} fixture El fixture de revisión de ejercicio versionado.
 * @param {object} [options] Mismas opciones que `validateAgt002ManizalesExerciseDecisionReviewFixture`.
 */
export function deriveAgt002ManizalesExerciseDecisionReview(integralAnalysis, fixture, options = {}) {
  if (!integralAnalysis || !Array.isArray(integralAnalysis.analysis_units)) {
    throw new Error('AGT-002 ejercicio-revisión: integralAnalysis.analysis_units debe ser un arreglo.');
  }
  const canonicalUnitIds = options.canonicalUnitIds
    ?? new Set(integralAnalysis.analysis_units.map(unit => unit.requirement_id));

  validateAgt002ManizalesExerciseDecisionReviewFixture(fixture, { ...options, canonicalUnitIds });

  const byStatus = { supported: [], preparation: [], not_applicable: [], decision_question: [], blocker: [] };
  const bypassedRequirementIds = [];
  for (const entry of fixture.entries) {
    const finding = toFinding(entry);
    byStatus[finding.reviewed_status].push(finding);
    if (finding.exercise_bypassed === true) bypassedRequirementIds.push(finding.requirement_id);
  }

  const recommendation = deriveExerciseRecommendation(byStatus);
  const decisionReady = byStatus.decision_question.length === 0;

  return Object.freeze({
    artifact_type: AGT002_EXERCISE_REVIEW_ARTIFACT_TYPE,
    contract_version: AGT002_EXERCISE_REVIEW_CONTRACT_VERSION,
    source_fixture_version: fixture.version,
    opportunity_id: fixture.opportunity_id,
    human_approval_required: true,
    decision_status: 'pending_human_decision',
    decision_ready: decisionReady,
    routing_action: 'flag_for_responsible_person',
    external_communications_allowed: false,
    evidence_requests_allowed: true,
    review_findings: Object.freeze(fixture.review_findings.map(finding => Object.freeze({ ...finding }))),
    exercise_mode: Object.freeze({ active: true, bypassed_requirement_ids: Object.freeze(bypassedRequirementIds) }),
    recommendation,
    blockers: Object.freeze(byStatus.blocker),
    decision_questions: Object.freeze(byStatus.decision_question),
    supported: Object.freeze(byStatus.supported),
    preparation: Object.freeze(byStatus.preparation),
    not_applicable: Object.freeze(byStatus.not_applicable),
    counts: Object.freeze({
      supported: byStatus.supported.length,
      preparation: byStatus.preparation.length,
      not_applicable: byStatus.not_applicable.length,
      decision_questions: byStatus.decision_question.length,
      blockers: byStatus.blocker.length,
    }),
  });
}

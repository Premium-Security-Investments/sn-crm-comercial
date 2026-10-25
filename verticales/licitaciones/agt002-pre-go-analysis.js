// Bloque LOCAL de análisis pre-GO gobernado de Rama Judicial Manizales SA-24-2026.
//
// Cruza cada sección RELEVANTE del registro contractual (artefacto
// manizales-sa-24-2026.registry.json, recibido como parámetro; este módulo nunca lo lee de
// disco) con la evidencia empresarial gobernada (las 17 clases de
// agt002-company-evidence-classes.js, proyectadas
// por agt002-evidence-state-manifest.js), distinguiendo estrictamente presencia, vigencia,
// aplicabilidad y SUFICIENCIA; presentado vs aceptado/adjudicado; requisito de oferta vs
// obligación post-adjudicación. NO decide cumplimiento, habilitación, puntaje ni GO/NO-GO:
// esas siguen siendo compuertas humanas. Pereira SA-MC-02-2026 se incorpora sólo como
// patrón (agt002-pereira-lessons.js), nunca como prueba de cumplimiento de Manizales.
//
// Reglas duras de este módulo:
//   - Determinista y sin I/O: recibe registro + clases de evidencia ya construidas + enlace
//     gobernado + generatedAt; nunca lee red/DB/reloj.
//   - Ningún eje se infiere de otro: la proyección de ejes se delega íntegra a
//     buildAgt002EvidenceStateManifest (presencia nunca promueve vigencia/aplicabilidad/
//     suficiencia/cumplimiento).
//   - `suficiencia` jamás se afirma automáticamente: es siempre decisión humana.
//   - `satisfied_candidate` es lo más fuerte que puede alcanzar una sección, y aun así queda
//     capado a human_review_required cuando la aplicabilidad de la sección es abstención
//     humana en el registro (lo es para las 68 secciones). El estado nunca es «cumple».
//   - Sin legal_corpus_version publicada NO se muestra verificación jurídica.
//   - La recomendación es sólo recommendation_candidate; el GO/NO-GO humano es obligatorio.
//
// Política MATERIAL pre-GO (piloto Rama Judicial Manizales): sólo los impedimentos que
// puedan impedir participación/habilitación o volver inviable la oferta (catálogo cerrado de
// AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES) generan bloqueador no_subsanable y cuentan
// para NO_GO_candidate. Los faltantes ORDINARIOS conseguibles/subsanables (catálogo cerrado de
// AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES: personal, armas/medios, estructura
// consorcio/UT, garantías/pólizas a emitir/modificar, formatos, firmas, certificados,
// asignaciones) NUNCA producen bloqueador no_subsanable ni pregunta humana pre-GO ni, por sí
// solos, NO_GO_candidate: se convierten en `post_go_preparation` (tareas de preparación tras el
// GO). El GO humano implica el COMPROMISO de disponer esos recursos; no afirma que ya existan.
// Todo requisito gobernado debe tener una clasificación material/ordinaria explícita
// (fail-closed): uno nuevo sin clasificar hace fallar la construcción del artefacto.

import {
  REGISTRO_FASES,
  assertNoOpenPii,
} from './agt002-contractual-registry-taxonomy.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';
import { buildAgt002EvidenceStateManifest } from './agt002-evidence-state-manifest.js';
import { AGT002_PEREIRA_LESSONS, buildAgt002PereiraTouchpointIndex } from './agt002-pereira-lessons.js';
import {
  AGT002_SECTION_PROPOSALS_STATUS,
  buildAgt002SectionProposalOverlayIndex,
} from './agt002-pre-go-section-proposals.js';

export const AGT002_PRE_GO_ANALYSIS_ARTIFACT_TYPE = 'agt002_pre_go_analysis';
export const AGT002_PRE_GO_ANALYSIS_STATUS = 'draft_for_human_review';
export const AGT002_PRE_GO_ANALYSIS_VERSION = 1;
export const AGT002_PRE_GO_ANALYSIS_CONTRACT_VERSION = 'agt002-pre-go-analysis@1';

// Estados controlados del cruce sección↔evidencia. NINGUNO afirma cumplimiento jurídico:
// «candidate» y «required» marcan que la decisión definitiva es humana.
export const AGT002_PRE_GO_CROSS_STATES = Object.freeze([
  'satisfied_candidate', 'missing', 'stale', 'not_applicable_candidate', 'unverifiable', 'human_review_required',
]);

// Política por fase: ¿la fase impone una obligación probatoria al PROPONENTE con la OFERTA
// (pre-GO) o no? Esto responde explícitamente qué fases no requieren evidencia pre-GO.
export const AGT002_PRE_GO_FASE_EVIDENCE_POLICY = Object.freeze({
  habilitante: 'offer_requirement',
  puntuable: 'offer_requirement',
  evaluacion: 'entity_evaluation_rule',
  generalidad: 'context_no_offer_obligation',
  ejecucion_tecnica: 'post_award_execution',
  postadjudicacion: 'post_award',
});

const FASE_NOT_APPLICABLE_REASON = Object.freeze({
  evaluacion: 'fase_evaluacion_es_regla_de_evaluacion_de_la_entidad',
  generalidad: 'fase_generalidad_sin_obligacion_probatoria_del_proponente',
  ejecucion_tecnica: 'fase_ejecucion_tecnica_evidencia_es_postadjudicacion',
  postadjudicacion: 'fase_postadjudicacion_no_requiere_evidencia_pre_go',
});

export const AGT002_PRE_GO_RECOMMENDATION_CANDIDATES = Object.freeze(['GO_candidate', 'NO_GO_candidate', 'indeterminate']);
export const AGT002_PRE_GO_BLOCKER_CLASSES = Object.freeze(['subsanable', 'no_subsanable', 'undetermined']);
export const AGT002_PRE_GO_RISK_DOMAINS = Object.freeze(['juridico', 'financiero', 'tecnico', 'operativo']);

// Catálogo cerrado de impedimentos MATERIALES: sólo éstos pueden impedir participación/
// habilitación o volver inviable la oferta, y son los únicos que generan bloqueador
// no_subsanable / cuentan para NO_GO_candidate pre-GO.
export const AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES = Object.freeze([
  'inhabilidad_incompatibilidad',
  'licencia_habilitante_esencial_imposible',
  'experiencia_minima_insuficiente',
  'capacidad_financiera_insuficiente',
  'plazo_objetivamente_imposible',
  'imposibilidad_tecnica_grave',
  'inviabilidad_economica_critica',
]);

// Catálogo cerrado de faltantes ORDINARIOS conseguibles/subsanables: nunca bloquean el
// pre-GO ni generan pregunta humana pre-GO; se convierten en `post_go_preparation`.
export const AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES = Object.freeze([
  'personal',
  'armas_medios',
  'estructura_consorcio_ut',
  'garantias_polizas_emitir_modificar',
  'formatos',
  'firmas',
  'certificados',
  'asignaciones',
]);

// Clasificación material/ordinaria por requisito gobernado. Catálogo cerrado y explícito
// (no heurístico, no derivado de texto libre): cada uno de los 4 requisitos gobernados hoy
// existentes se clasifica una sola vez, aquí. Un requisito gobernado nuevo sin entrada aquí
// falla cerrado en requirementMaterialPolicy en lugar de heredar una clasificación por defecto.
const GOVERNED_REQUIREMENT_MATERIAL_POLICY = Object.freeze({
  'financial-working-capital': Object.freeze({ materiality: 'material', category: 'capacidad_financiera_insuficiente' }),
  'legal-rce-policy': Object.freeze({ materiality: 'ordinary', category: 'garantias_polizas_emitir_modificar' }),
  'legal-collective-life-policy': Object.freeze({ materiality: 'ordinary', category: 'garantias_polizas_emitir_modificar' }),
  'technical-video-surveillance-scope': Object.freeze({ materiality: 'ordinary', category: 'armas_medios' }),
});

function requirementMaterialPolicy(requirementId) {
  const policy = GOVERNED_REQUIREMENT_MATERIAL_POLICY[requirementId];
  if (!policy) {
    throw new Error(
      `AGT-002 pre-GO: el requisito gobernado "${requirementId}" no tiene política material clasificada; `
      + 'se rechaza en lugar de asumirlo material u ordinario (fail-closed). Clasifícalo en '
      + 'GOVERNED_REQUIREMENT_MATERIAL_POLICY antes de usarlo.',
    );
  }
  return policy;
}

/** Única fuente de verdad de materialidad por requisito gobernado (fail-closed: lanza si no está clasificado). */
export function resolveAgt002RequirementMaterialPolicy(requirementId) {
  return requirementMaterialPolicy(requirementId);
}

// Precedencia «más conservadora primero» para agregar el estado de una sección con varios
// requisitos gobernados: un documento requerido AUSENTE domina sobre uno vencido, y así.
const CROSS_STATE_PRECEDENCE = Object.freeze([
  'missing', 'stale', 'human_review_required', 'unverifiable', 'not_applicable_candidate', 'satisfied_candidate',
]);

const PRE_GO_PROBATIVE_LIMITS = Object.freeze([
  'El análisis pre-GO cruza requisitos del pliego vigente con evidencia empresarial gobernada; no decide cumplimiento, habilitación, puntaje ni GO/NO-GO.',
  'satisfied_candidate significa evidencia candidata (presente/vigente/aplicable/revisada); la SUFICIENCIA jurídica y la habilitación son decisión humana.',
  'La aplicabilidad de cada sección (modalidad del proponente, régimen diferencial) es abstención humana; ninguna sección se afirma aplicable automáticamente.',
  'Presentado no equivale a aceptado ni a adjudicado; el análisis nunca infiere resultados de evaluación.',
  'Ausencia de SEÑAL de una clase de evidencia (unverifiable) no equivale a ausencia del documento (missing): son estados distintos y no intercambiables.',
  'Sin una versión publicada de corpus legal no se muestra verificación jurídica.',
  'La cobertura es estructural (68 secciones registradas); no constituye exhaustividad humana ni revisión jurídica.',
  'Rama Judicial Pereira se incorpora como patrón de taxonomía/escalera probatoria; no prueba cumplimiento de Manizales ni traslada aplicabilidad.',
]);

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AGT-002 pre-GO: ${label} debe ser texto no vacío.`);
  return value.trim();
}

function assertIsoTimestamp(value, label) {
  const text = requireNonEmptyString(value, label);
  if (Number.isNaN(new Date(text).getTime())) throw new Error(`AGT-002 pre-GO: ${label} debe ser una marca de tiempo ISO válida.`);
  return text;
}

function normalizeLink(evidenceClassLinkByRequirementId) {
  const link = evidenceClassLinkByRequirementId instanceof Map
    ? evidenceClassLinkByRequirementId
    : new Map(Object.entries(evidenceClassLinkByRequirementId || {}));
  for (const [requirementId, classId] of link) {
    if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(classId)) {
      throw new Error(
        `AGT-002 pre-GO: el requisito gobernado "${requirementId}" enlaza a "${classId}", fuera del catálogo cerrado de 17 clases; `
        + 'se rechaza en lugar de fabricarlo (fail-closed).',
      );
    }
  }
  return link;
}

function pickMostConservative(states) {
  for (const candidate of CROSS_STATE_PRECEDENCE) {
    if (states.includes(candidate)) return candidate;
  }
  return 'unverifiable';
}

// Traduce el evidence_state de UN requisito gobernado (ya proyectado, ejes independientes) a
// un estado de cruce pre-GO. Nunca colapsa un eje en otro.
function crossStateFromEvidence({ rule_id, evidence_state }) {
  if (rule_id === 'no_governed_evidence_class_link') {
    return { state: 'unverifiable', reason: 'sin_enlace_de_clase_de_evidencia_gobernado' };
  }
  if (rule_id === 'linked_evidence_class_not_observed') {
    return { state: 'unverifiable', reason: 'clase_de_evidencia_no_observada_localmente' };
  }
  const { presence, review, validity, applicability } = evidence_state;
  if (presence === 'absent') return { state: 'missing', reason: 'clase_de_evidencia_ausente' };
  if (presence === 'unknown') return { state: 'human_review_required', reason: 'presencia_desconocida' };
  if (validity === 'expired') return { state: 'stale', reason: 'vigencia_vencida' };
  if (applicability === 'not_applicable') return { state: 'not_applicable_candidate', reason: 'clase_marcada_no_aplicable' };
  if (validity === 'valid' && applicability === 'applicable' && review === 'reviewed') {
    return { state: 'satisfied_candidate', reason: 'evidencia_candidata_presente_vigente_aplicable_revisada' };
  }
  return { state: 'human_review_required', reason: 'ejes_pendientes_de_confirmacion_humana' };
}

function isPreGoRelevant(item, habilitatingGovernedRequirementIds) {
  const policy = AGT002_PRE_GO_FASE_EVIDENCE_POLICY[item.fase];
  if (policy === 'offer_requirement') return true;
  // Un requisito habilitante puede estar restated en el Capítulo I (generalidad): p.ej. la
  // póliza de vida colectivo. NO se aplica a fases de ejecución/postadjudicación aunque
  // arrastren un requisito gobernado, porque allí es la garantía de EJECUCIÓN (lección
  // Pereira: RCE habilitante ≠ RCE contractual): esa distinción es humana.
  if (item.fase === 'generalidad') {
    return (item.governed_requirement_ids || []).some(id => habilitatingGovernedRequirementIds.has(id));
  }
  return false;
}

// Normaliza el overlay opcional de propuestas curadas a un Map ref -> { requirement_ids,
// requirement_count, status }. Acepta el artefacto de propuestas, su índice (Map/objeto) o null.
// Es un overlay LOCAL de PROPUESTA (no aprobado): nunca convierte una sección en requisito
// gobernado; sólo permite que deje el bloqueador genérico "sin requisito gobernado".
function normalizeProposalOverlay(sectionProposalOverlay) {
  if (!sectionProposalOverlay) return new Map();
  if (sectionProposalOverlay instanceof Map) return sectionProposalOverlay;
  if (Array.isArray(sectionProposalOverlay.sections)) return buildAgt002SectionProposalOverlayIndex(sectionProposalOverlay);
  return new Map(Object.entries(sectionProposalOverlay));
}

function buildItemCrossing(item, {
  link, classById, applicabilityAbstainedRefs, pereiraIndex, habilitatingGovernedRequirementIds, proposalOverlayByRef,
}) {
  const policy = AGT002_PRE_GO_FASE_EVIDENCE_POLICY[item.fase] || 'context_no_offer_obligation';
  const govReqIds = Array.isArray(item.governed_requirement_ids) ? item.governed_requirement_ids : [];
  const relevant = isPreGoRelevant(item, habilitatingGovernedRequirementIds);
  const pereiraTouchpoints = pereiraIndex.get(item.ref) || [];

  const base = {
    item_ref: item.ref,
    titulo: item.titulo,
    fase: item.fase,
    categoria: item.categoria,
    subsanabilidad: item.subsanabilidad,
    offer_vs_post_award: policy,
    pre_go_relevant: relevant,
    governed_requirement_ids: govReqIds.slice(),
    // Presentado/aceptado nunca se infieren: el registro no observa el sobre del proponente.
    presented_vs_accepted: { presented: 'not_determined', accepted: 'not_determined', adjudicated: 'not_determined' },
    pereira_pattern: pereiraTouchpoints.map(t => ({ bucket: t.bucket, requirement: t.requirement, provenance: t.provenance })),
    // Faltantes (missing/stale) de requisitos gobernados, separados por política material:
    // sólo material_gaps puede alimentar un bloqueador no_subsanable / NO_GO_candidate.
    material_gaps: [],
    ordinary_gaps: [],
  };

  if (!relevant) {
    return {
      ...base,
      cross_state: 'not_applicable_candidate',
      reason: FASE_NOT_APPLICABLE_REASON[item.fase] || 'fase_sin_obligacion_probatoria_pre_go',
      dimensions: { presencia: 'no_evaluada', vigencia: 'no_evaluada', aplicabilidad: 'no_evaluada', suficiencia: 'no_evaluada_humano' },
      governed_evidence: [],
    };
  }

  if (govReqIds.length === 0) {
    // Relevante pero sin requisito gobernado que le dé un camino de evidencia: no se puede
    // verificar sin un mapeo curado por humano (subsanable), NO es un documento ausente.
    const overlay = proposalOverlayByRef?.get(item.ref);
    if (overlay) {
      // Existe una PROPUESTA CURADA para esta sección: deja el bloqueador genérico y pasa a un
      // estado de propuesta pendiente de revisión humana. Sigue siendo unverifiable (una propuesta
      // no es evidencia ni requisito aprobado); nunca afirma cumplimiento ni suficiencia.
      return {
        ...base,
        cross_state: 'unverifiable',
        reason: 'seccion_con_propuesta_curada_proposed_para_revision_humana',
        dimensions: { presencia: 'unknown', vigencia: 'unknown', aplicabilidad: 'unknown', suficiencia: 'no_evaluada_humano' },
        governed_evidence: [],
        proposal_overlay: {
          status: overlay.status || AGT002_SECTION_PROPOSALS_STATUS,
          requirement_ids: Array.isArray(overlay.requirement_ids) ? [...overlay.requirement_ids] : [],
          requirement_count: overlay.requirement_count ?? (overlay.requirement_ids?.length || 0),
          human_approval_required: true,
          note: 'Propuesta curada de requisitos atomizados para revisión humana; NO es requisito gobernado ni afirma cumplimiento/suficiencia.',
        },
      };
    }
    return {
      ...base,
      cross_state: 'unverifiable',
      reason: 'seccion_relevante_sin_requisito_gobernado_mapeado',
      dimensions: { presencia: 'unknown', vigencia: 'unknown', aplicabilidad: 'unknown', suficiencia: 'no_evaluada_humano' },
      governed_evidence: [],
    };
  }

  const manifest = buildAgt002EvidenceStateManifest(
    govReqIds.map(requirement_id => ({ requirement_id })),
    {
      evidenceClasses: [...classById.values()],
      evidenceClassLinkByRequirementId: link,
    },
  );

  const governedEvidence = manifest.map((entry) => {
    const derived = crossStateFromEvidence(entry);
    return {
      requirement_id: entry.requirement_id,
      evidence_class_id: entry.provenance?.evidence_class_id || null,
      rule_id: entry.rule_id,
      evidence_state: entry.evidence_state,
      cross_state: derived.state,
      reason: derived.reason,
      material_policy: requirementMaterialPolicy(entry.requirement_id),
    };
  });

  // Política material: sólo missing/stale de un requisito MATERIAL bloquea el pre-GO; los
  // faltantes ORDINARIOS (garantías/pólizas, medios técnicos, personal, etc.) se separan aquí
  // para nunca alimentar bloqueadores/preguntas humanas pre-GO, y en su lugar alimentar
  // `post_go_preparation` (tarea de preparación comprometida tras el GO humano).
  const gapStates = new Set(['missing', 'stale']);
  const materialGaps = governedEvidence.filter(g => gapStates.has(g.cross_state) && g.material_policy.materiality === 'material');
  const ordinaryGaps = governedEvidence.filter(g => gapStates.has(g.cross_state) && g.material_policy.materiality === 'ordinary');

  let aggregate = pickMostConservative(governedEvidence.map(g => g.cross_state));
  let reason = governedEvidence.find(g => g.cross_state === aggregate)?.reason || 'agregado';

  // Compuerta de aplicabilidad del registro: la aplicabilidad de la sección es abstención
  // humana; una evidencia candidata «satisfecha» NO puede afirmarse aplicable sola.
  const applicabilityHuman = applicabilityAbstainedRefs.has(item.ref);
  if (aggregate === 'satisfied_candidate' && applicabilityHuman) {
    aggregate = 'human_review_required';
    reason = 'aplicabilidad_de_la_seccion_es_decision_humana';
  }

  const dims = deriveDimensions(governedEvidence, applicabilityHuman);

  return {
    ...base,
    cross_state: aggregate,
    reason,
    applicability_is_human_decision: applicabilityHuman,
    dimensions: dims,
    governed_evidence: governedEvidence,
    material_gaps: materialGaps.map(g => ({ requirement_id: g.requirement_id, evidence_class_id: g.evidence_class_id, cross_state: g.cross_state, category: g.material_policy.category })),
    ordinary_gaps: ordinaryGaps.map(g => ({ requirement_id: g.requirement_id, evidence_class_id: g.evidence_class_id, cross_state: g.cross_state, category: g.material_policy.category })),
  };
}

// Dimensiones de la SECCIÓN a partir de sus requisitos gobernados; suficiencia siempre
// humana; aplicabilidad capada a «humano» cuando el registro abstiene ese eje.
function deriveDimensions(governedEvidence, applicabilityHuman) {
  const observed = governedEvidence.filter(g => g.rule_id === 'company_evidence_class_axis_projection');
  const collapse = (axis, order, fallback) => {
    if (observed.length === 0) return 'unknown';
    const values = observed.map(g => g.evidence_state[axis]);
    for (const v of order) if (values.includes(v)) return v;
    return fallback;
  };
  return {
    presencia: collapse('presence', ['absent', 'unknown', 'present'], 'unknown'),
    vigencia: collapse('validity', ['expired', 'unknown', 'valid'], 'unknown'),
    aplicabilidad: applicabilityHuman ? 'decision_humana' : collapse('applicability', ['not_applicable', 'unknown', 'applicable'], 'unknown'),
    suficiencia: 'no_evaluada_humano',
  };
}

function summarizeMatrix(crossings) {
  const byState = Object.fromEntries(AGT002_PRE_GO_CROSS_STATES.map(s => [s, 0]));
  const byFase = Object.fromEntries(REGISTRO_FASES.map(f => [f, 0]));
  let relevant = 0;
  for (const c of crossings) {
    byState[c.cross_state] += 1;
    byFase[c.fase] = (byFase[c.fase] || 0) + 1;
    if (c.pre_go_relevant) relevant += 1;
  }
  return {
    total_secciones: crossings.length,
    secciones_relevantes_pre_go: relevant,
    secciones_no_aplicables_pre_go: crossings.length - relevant,
    por_estado: byState,
    por_fase: byFase,
  };
}

function buildBlockers(crossings, legalShown) {
  const blockers = [];
  const refsWith = (predicate) => crossings.filter(predicate).map(c => c.item_ref).sort();

  const notObserved = refsWith(c => c.pre_go_relevant && c.governed_evidence.some(g => g.rule_id === 'linked_evidence_class_not_observed'));
  if (notObserved.length) {
    blockers.push({
      id: 'evidencia_empresarial_no_observable_localmente',
      class: 'subsanable',
      summary: 'La bóveda de evidencia empresarial (17 clases) no es observable en el entorno local; las secciones relevantes con enlace gobernado quedan unverifiable.',
      affected_item_refs: notObserved,
      remediation: 'Sincronizar/gobernar el registro de evidencia empresarial (psi_agt002_company_evidence_registry) y adjuntar por identificador; verificación humana.',
      human_owner: 'tender_lead',
    });
  }

  // Secciones sin requisito gobernado Y sin propuesta curada: bloqueador genérico (sin cambios).
  const noMapping = refsWith(c => c.pre_go_relevant && c.cross_state === 'unverifiable' && c.governed_requirement_ids.length === 0 && !c.proposal_overlay);
  if (noMapping.length) {
    blockers.push({
      id: 'secciones_relevantes_sin_requisito_gobernado',
      class: 'subsanable',
      summary: 'Secciones de oferta (habilitantes/puntuables) sin requisito gobernado ni enlace de clase de evidencia: no hay camino de verificación sin mapeo curado.',
      affected_item_refs: noMapping,
      remediation: 'Curar requirement_manifest + evidence_class_link para estas secciones (borrador de gobernanza), con rationale y source_reference; aprobación humana.',
      human_owner: 'legal',
    });
  }

  // Secciones sin requisito gobernado PERO con propuesta curada (overlay): dejan el bloqueador
  // genérico y quedan en un bloqueador de PROPUESTA pendiente de aprobación humana (no aprobado).
  const proposed = refsWith(c => c.pre_go_relevant && c.governed_requirement_ids.length === 0 && c.proposal_overlay);
  if (proposed.length) {
    blockers.push({
      id: 'secciones_con_propuesta_de_requisitos_para_revision_humana',
      class: 'subsanable',
      status: 'proposed_for_human_review',
      summary: 'Secciones de oferta con PROPUESTA CURADA de requisitos atomizados (overlay local, no aprobado): requieren revisión y aprobación humana antes de convertirse en requisitos gobernados; no afirman cumplimiento ni suficiencia.',
      affected_item_refs: proposed,
      remediation: 'Revisar y aprobar (o ajustar) las propuestas de requisitos por sección (artefacto agt002_pre_go_section_proposals); sólo tras GO humano se convierten en requirement_manifest gobernado.',
      human_owner: 'legal',
    });
  }

  const noLink = refsWith(c => c.pre_go_relevant && c.governed_evidence.some(g => g.rule_id === 'no_governed_evidence_class_link'));
  if (noLink.length) {
    blockers.push({
      id: 'requisito_gobernado_sin_enlace_de_clase',
      class: 'subsanable',
      summary: 'Requisitos gobernados sin clase de evidencia enlazada (p.ej. alcance de videovigilancia/CCTV): permanecen en abstención hasta curar el enlace y revisar el documento.',
      affected_item_refs: noLink,
      remediation: 'Proponer evidence_class_link gobernado y revisión documental humana; mantener CCTV en abstención mientras no haya evidencia concluyente nueva.',
      human_owner: 'technical',
    });
  }

  // Política material: sólo un impedimento MATERIAL ausente (inhabilidad/incompatibilidad,
  // licencia/habilitante esencial imposible, experiencia mínima insuficiente, capacidad
  // financiera insuficiente, plazo objetivamente imposible, imposibilidad técnica grave,
  // inviabilidad económica crítica) bloquea el pre-GO. Los faltantes ORDINARIOS (garantías/
  // pólizas, medios, personal, formatos, firmas, certificados, asignaciones) NUNCA generan
  // este bloqueador: ver `post_go_preparation`.
  const materialMissing = refsWith(c => c.pre_go_relevant && c.material_gaps.some(g => g.cross_state === 'missing'));
  if (materialMissing.length) {
    blockers.push({
      id: 'documento_no_subsanable_ausente',
      class: 'no_subsanable',
      summary: 'Impedimento MATERIAL ausente (política pre-GO): puede impedir participación/habilitación o volver inviable la oferta; no es un faltante ordinario preparable.',
      affected_item_refs: materialMissing,
      remediation: 'Escalar a revisión humana inmediata: confirmar si es imposibilidad objetiva, contradicción material o excepción extraordinaria antes de continuar.',
      human_owner: 'legal',
    });
  }

  if (!legalShown) {
    blockers.push({
      id: 'verificacion_juridica_no_disponible_sin_corpus',
      class: 'subsanable',
      summary: 'No hay versión publicada de corpus legal; la verificación jurídica no se muestra.',
      affected_item_refs: [],
      remediation: 'Publicar y verificar una versión de corpus legal (psi_agt002_legal_corpus_versions) por decisión humana.',
      human_owner: 'legal',
    });
  }

  return blockers;
}

function buildIndispensableQuestions(crossings) {
  // Mapeo, bóveda, formatos, modalidad asociativa y documentos preparables son trabajo del
  // agente/post-GO, no una entrevista humana. Sólo una imposibilidad MATERIAL ya observada
  // puede escalar una pregunta concreta. `unverifiable` sigue siendo pendiente mecánico.
  return crossings
    .filter(c => c.pre_go_relevant && c.material_gaps.length > 0)
    .map(c => ({
      id: `impedimento_material_${c.item_ref.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      question: `Se observó un posible impedimento material en la sección ${c.item_ref}. ¿Existe una excepción objetiva documentada que evite que impida participar o habilitar la oferta?`,
      blocks_axis: 'viabilidad_material',
      affected_item_refs: [c.item_ref],
    }));
}

function buildAbstentions(crossings, registryAbstentions) {
  const cctvRefs = crossings
    .filter(c => c.governed_evidence?.some(g => g.rule_id === 'no_governed_evidence_class_link'))
    .map(c => c.item_ref).sort();
  return {
    structural_coverage_only: true,
    not_human_exhaustive: 'La cobertura es estructural (68 secciones); no afirma exhaustividad humana ni revisión jurídica completa.',
    registro_abstentions_count: Array.isArray(registryAbstentions) ? registryAbstentions.length : 0,
    module_abstentions: [
      { axis: 'aplicabilidad', scope: 'todas_las_secciones', reason: 'La aplicabilidad por modalidad del proponente es decisión humana en las 68 secciones.' },
      { axis: 'suficiencia', scope: 'todas_las_secciones_relevantes', reason: 'La suficiencia de licencias/pólizas/experiencia/umbrales es decisión humana; nunca se afirma aquí.' },
      { axis: 'videovigilancia_cctv', scope: cctvRefs, reason: 'El alcance de videovigilancia/CCTV permanece en abstención (sin clase de evidencia enlazada ni evidencia concluyente nueva).' },
    ],
  };
}

function buildRisks(matrix, legalShown) {
  const risks = {
    juridico: [
      { risk: 'Contradicciones internas del pliego (cláusula penal, RCE habilitante vs contractual, días de grabación, UNSPSC, numeración) deben reconciliarse por humano.', basis: 'pereira:universales', confidence: 'alto' },
      { risk: legalShown ? 'Verificación jurídica disponible pero la suficiencia y la interpretación siguen siendo humanas.' : 'Sin corpus legal publicado no hay verificación jurídica; la habilitación jurídica no puede evaluarse localmente.', basis: legalShown ? 'corpus_publicado' : 'corpus_ausente', confidence: 'alto' },
    ],
    financiero: [
      { risk: 'Base de cálculo de la garantía de seriedad (10% del POE vigente, no del total de CDP) y suficiencia de indicadores financieros son cotejo humano.', basis: 'pereira:variables_por_proceso', confidence: 'alto' },
    ],
    tecnico: [
      { risk: 'La cobertura de medios tecnológicos/CCTV y la territorialidad de licencias no están probadas; permanecen en abstención.', basis: 'pereira:variables_por_proceso', confidence: 'medio' },
    ],
    operativo: [
      { risk: `La evidencia empresarial no es observable localmente (${matrix.por_estado.unverifiable} secciones unverifiable); se requiere sincronización gobernada y minimización de PII de personal.`, basis: 'local_gap', confidence: 'alto' },
    ],
  };
  return risks;
}

// Resumen del overlay de propuestas aplicado (trazabilidad). Cuando no se pasa overlay, queda
// `applied: false` y el análisis se comporta idéntico al de antes (sin propuestas).
function buildSectionProposalOverlaySummary(crossings) {
  const affected = crossings.filter(c => c.proposal_overlay);
  const affectedRefs = affected.map(c => c.item_ref).sort();
  return {
    applied: affectedRefs.length > 0,
    status: affectedRefs.length ? AGT002_SECTION_PROPOSALS_STATUS : null,
    human_approval_required: true,
    is_approved: false,
    affected_item_refs: affectedRefs,
    requirement_count: affected.reduce((acc, c) => acc + (c.proposal_overlay.requirement_count || 0), 0),
    note: 'Overlay LOCAL de propuestas curadas para las secciones sin requisito gobernado; no aprueba requisitos, no afirma cumplimiento ni suficiencia, y el GO/NO-GO humano sigue siendo obligatorio.',
  };
}

// Faltantes ORDINARIOS conseguibles/subsanables (personal, armas/medios, estructura
// consorcio/UT, garantías/pólizas a emitir/modificar, formatos, firmas, certificados,
// asignaciones): nunca bloquean el pre-GO ni generan pregunta humana pre-GO. Se listan aquí
// como tareas de preparación POST-GO: el GO humano implica el COMPROMISO de disponerlas, no
// su prueba ni su suficiencia.
function buildPostGoPreparation(crossings) {
  const actions = [];
  for (const c of crossings) {
    if (!c.pre_go_relevant) continue;
    for (const gap of c.ordinary_gaps) {
      actions.push({
        item_ref: c.item_ref,
        requirement_id: gap.requirement_id,
        evidence_class_id: gap.evidence_class_id,
        category: gap.category,
        gap_state: gap.cross_state,
        action: gap.cross_state === 'stale' ? 'renovar_o_actualizar' : 'emitir_o_disponer',
        human_owner: 'tender_lead',
        note: 'Faltante ordinario conseguible/subsanable (no bloquea el pre-GO ni genera pregunta humana pre-GO). El GO humano implica el COMPROMISO de disponer este recurso antes de firma/ejecución; no afirma que ya exista ni su suficiencia.',
      });
    }
  }
  actions.sort((a, b) => a.item_ref.localeCompare(b.item_ref) || a.requirement_id.localeCompare(b.requirement_id));
  return {
    applies_on_go: true,
    note: 'GO implica el COMPROMISO de disponer estos recursos antes de firma/ejecución; su ausencia hoy no impide el pre-GO ni genera pregunta humana pre-GO ni, por sí sola, NO_GO_candidate.',
    count: actions.length,
    actions,
  };
}

function buildRecommendationCandidate(matrix, blockers, legalShown, crossings) {
  const relevant = matrix.secciones_relevantes_pre_go;
  const { satisfied_candidate: satisfied, human_review_required: humanReview, unverifiable } = matrix.por_estado;
  const noSubsanable = blockers.filter(b => b.class === 'no_subsanable');
  // Política material: sólo missing/stale de un requisito MATERIAL cuenta contra GO; los
  // faltantes ordinarios (ver `post_go_preparation`) no cuentan, ni siquiera agregados.
  const materialMissingRefs = crossings.filter(c => c.pre_go_relevant && c.material_gaps.some(g => g.cross_state === 'missing')).map(c => c.item_ref);
  const materialStaleRefs = crossings.filter(c => c.pre_go_relevant && c.material_gaps.some(g => g.cross_state === 'stale')).map(c => c.item_ref);

  const argumentsAgainst = [];
  const argumentsFor = [];

  if (noSubsanable.length) argumentsAgainst.push(`Existen ${noSubsanable.length} posible(s) impedimento(s) material(es) que requieren confirmar imposibilidad o excepción objetiva.`);
  if (materialMissingRefs.length) argumentsAgainst.push(`${materialMissingRefs.length} sección(es) con impedimento material ausente: ${materialMissingRefs.join(', ')}.`);
  if (materialStaleRefs.length) argumentsAgainst.push(`${materialStaleRefs.length} sección(es) con evidencia material vencida: ${materialStaleRefs.join(', ')}.`);
  if (unverifiable) argumentsAgainst.push(`${unverifiable} sección(es) relevante(s) unverifiable: requieren verificación mecánica, no respuesta humana por defecto.`);
  if (!legalShown) argumentsAgainst.push('No hay verificación jurídica (corpus legal ausente).');

  if (satisfied) argumentsFor.push(`${satisfied} sección(es) con evidencia candidata satisfecha (presente/vigente/aplicable/revisada), sujeta a suficiencia humana.`);
  if (relevant && satisfied === relevant) argumentsFor.push('Todas las secciones relevantes tienen evidencia candidata satisfecha (candidata, no cumplimiento).');
  argumentsFor.push('El registro cataloga estructuralmente las 68 secciones del pliego vigente, lo que da trazabilidad para la decisión humana.');

  let candidate = 'indeterminate';
  let confidence = 'unavailable';
  if (noSubsanable.length || materialMissingRefs.length > 0) {
    candidate = 'NO_GO_candidate';
    confidence = 'low';
  } else if (relevant > 0 && satisfied === relevant && legalShown) {
    candidate = 'GO_candidate';
    confidence = 'medium';
  } else {
    candidate = 'indeterminate';
    confidence = (unverifiable + humanReview) > 0 ? 'low' : 'unavailable';
  }

  return {
    recommendation_candidate: candidate,
    confidence,
    human_go_no_go_required: true,
    arguments_for: argumentsFor,
    arguments_against: argumentsAgainst,
    note: 'recommendation_candidate NO es una recomendación jurídica ni una decisión: el GO/NO-GO es una compuerta humana obligatoria.',
  };
}

/**
 * Construye el artefacto de análisis pre-GO gobernado.
 *
 * @param {object}   params.registry                            Registro contractual (artefacto parseado).
 * @param {Array}    [params.evidenceClasses]                   Clases de evidencia observadas (buildAgt002CompanyEvidenceClasses(...).classes). Vacío = ninguna observada localmente.
 * @param {object}   [params.evidenceClassLinkByRequirementId]  Enlace gobernado requirement_id -> evidence_class_id (una de las 17).
 * @param {string[]} [params.habilitatingGovernedRequirementIds] Requisitos gobernados clasificados «habilitating» (para arrastrar secciones de Cap. I).
 * @param {string|null} [params.legalCorpusVersion]            Versión publicada de corpus legal; null => no se muestra verificación jurídica.
 * @param {string}   params.generatedAt                         Marca ISO (determinista; el módulo nunca lee el reloj).
 * @param {object}   [params.pereiraLessons]                    Mapa de lecciones Pereira (patrón, no prueba).
 */
export function buildAgt002PreGoAnalysis({
  registry,
  evidenceClasses = [],
  evidenceClassLinkByRequirementId = {},
  habilitatingGovernedRequirementIds = [],
  legalCorpusVersion = null,
  generatedAt,
  pereiraLessons = AGT002_PEREIRA_LESSONS,
  sectionProposalOverlay = null,
} = {}) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('AGT-002 pre-GO: registry debe ser el artefacto de registro contractual.');
  }
  if (!Array.isArray(registry.items)) throw new Error('AGT-002 pre-GO: registry.items debe ser un arreglo.');
  if (!Array.isArray(evidenceClasses)) throw new Error('AGT-002 pre-GO: evidenceClasses debe ser un arreglo.');
  const generatedAtIso = assertIsoTimestamp(generatedAt, 'generatedAt');
  const legalVersion = legalCorpusVersion == null ? null : requireNonEmptyString(legalCorpusVersion, 'legalCorpusVersion');
  const legalShown = legalVersion != null;

  const link = normalizeLink(evidenceClassLinkByRequirementId);
  const classById = new Map(evidenceClasses.map((cls) => {
    const id = requireNonEmptyString(cls?.entry_id, 'evidenceClasses[].entry_id');
    return [id, cls];
  }));
  const habilitatingSet = new Set((habilitatingGovernedRequirementIds || []).map(id => requireNonEmptyString(id, 'habilitatingGovernedRequirementIds[]')));

  const applicabilityAbstainedRefs = new Set(
    (Array.isArray(registry.abstentions) ? registry.abstentions : [])
      .filter(a => a?.axis === 'aplicabilidad' && typeof a.item_ref === 'string')
      .map(a => a.item_ref),
  );
  const pereiraIndex = buildAgt002PereiraTouchpointIndex(pereiraLessons);
  const proposalOverlayByRef = normalizeProposalOverlay(sectionProposalOverlay);

  const crossings = registry.items.map(item => buildItemCrossing(item, {
    link, classById, applicabilityAbstainedRefs, pereiraIndex, habilitatingGovernedRequirementIds: habilitatingSet, proposalOverlayByRef,
  }));

  const matrix = summarizeMatrix(crossings);
  const blockers = buildBlockers(crossings, legalShown);
  const questions = buildIndispensableQuestions(crossings);
  const abstentions = buildAbstentions(crossings, registry.abstentions);
  const risks = buildRisks(matrix, legalShown);
  const recommendation = buildRecommendationCandidate(matrix, blockers, legalShown, crossings);
  const postGoPreparation = buildPostGoPreparation(crossings);

  const legalVerification = legalShown
    ? {
      shown: true,
      legal_corpus_version: legalVersion,
      note: 'Versión de corpus registrada; la verificación jurídica sustantiva y la suficiencia siguen siendo decisión humana.',
    }
    : {
      shown: false,
      gated_reason: 'legal_corpus_version_ausente',
      note: 'No se muestra verificación jurídica sin una versión de corpus legal publicada.',
    };

  const artifact = {
    artifact_type: AGT002_PRE_GO_ANALYSIS_ARTIFACT_TYPE,
    contract_version: AGT002_PRE_GO_ANALYSIS_CONTRACT_VERSION,
    status: AGT002_PRE_GO_ANALYSIS_STATUS,
    human_approval_required: true,
    version: AGT002_PRE_GO_ANALYSIS_VERSION,
    generated_at: generatedAtIso,
    opportunity_id: typeof registry.opportunity_id === 'string' ? registry.opportunity_id : null,
    proceso: typeof registry.proceso === 'string' ? registry.proceso : null,
    entidad: typeof registry.entidad === 'string' ? registry.entidad : null,
    registry_reference: {
      artifact_type: registry.artifact_type || null,
      taxonomy_version: registry.taxonomy_version || null,
      vigente_pliego: registry.vigente_pliego?.name || registry.vigente_pliego || null,
      total_secciones: registry.items.length,
    },
    pattern_reference: pereiraLessons.case,
    fase_evidence_policy: AGT002_PRE_GO_FASE_EVIDENCE_POLICY,
    legal_verification: legalVerification,
    section_proposal_overlay: buildSectionProposalOverlaySummary(crossings),
    coverage: matrix,
    crossings,
    blockers,
    indispensable_questions: questions,
    abstentions,
    risks,
    recommendation,
    post_go_preparation: postGoPreparation,
    pereira_pattern: {
      case: pereiraLessons.case,
      applies_to_manizales: 'patron_no_prueba',
      buckets: {
        universales: pereiraLessons.universales,
        variables_por_proceso: pereiraLessons.variables_por_proceso,
        postadjudicacion: pereiraLessons.postadjudicacion,
      },
    },
    probative_limits: PRE_GO_PROBATIVE_LIMITS,
  };

  assertNoOpenPii(artifact);
  return artifact;
}

// Revalidación estructural fail-closed de un artefacto persistido/serializado.
export function validateAgt002PreGoAnalysis(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('AGT-002 pre-GO: el artefacto debe ser un objeto.');
  }
  if (artifact.artifact_type !== AGT002_PRE_GO_ANALYSIS_ARTIFACT_TYPE) throw new Error('AGT-002 pre-GO: artifact_type inesperado.');
  if (artifact.status !== AGT002_PRE_GO_ANALYSIS_STATUS) throw new Error('AGT-002 pre-GO: status inesperado.');
  if (artifact.human_approval_required !== true) throw new Error('AGT-002 pre-GO: human_approval_required debe ser true.');
  if (!Array.isArray(artifact.crossings)) throw new Error('AGT-002 pre-GO: crossings debe ser un arreglo.');
  for (const c of artifact.crossings) {
    if (!AGT002_PRE_GO_CROSS_STATES.includes(c.cross_state)) {
      throw new Error(`AGT-002 pre-GO: cross_state inválido en ${c.item_ref}: ${String(c.cross_state)}.`);
    }
  }
  if (!artifact.recommendation || !AGT002_PRE_GO_RECOMMENDATION_CANDIDATES.includes(artifact.recommendation.recommendation_candidate)) {
    throw new Error('AGT-002 pre-GO: recommendation_candidate inválido.');
  }
  if (artifact.recommendation.human_go_no_go_required !== true) throw new Error('AGT-002 pre-GO: el GO/NO-GO humano es obligatorio.');
  if (!artifact.legal_verification || typeof artifact.legal_verification.shown !== 'boolean') {
    throw new Error('AGT-002 pre-GO: legal_verification.shown debe ser booleano.');
  }
  const preparation = artifact.post_go_preparation;
  if (!preparation || preparation.applies_on_go !== true || !Array.isArray(preparation.actions)
    || preparation.count !== preparation.actions.length || typeof preparation.note !== 'string') {
    throw new Error('AGT-002 pre-GO: post_go_preparation inválido.');
  }
  for (const action of preparation.actions) {
    if (!AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES.includes(action.category)) {
      throw new Error(`AGT-002 pre-GO: categoría post_go_preparation inválida: ${String(action.category)}.`);
    }
  }
  assertNoOpenPii(artifact);
  return artifact;
}

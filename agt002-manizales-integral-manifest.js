// Manifiesto INTEGRAL versionado de Rama Judicial Manizales SA-24-2026: consolida, en un solo
// artefacto gobernado y determinista, las cuatro fuentes ya versionadas del flujo pre-GO:
//   - el registro contractual (68 secciones, 17 documentos/provenance),
//   - el análisis pre-GO (15 secciones relevantes pre-GO),
//   - las propuestas curadas de sección (20 propuestas en 10 secciones),
//   - el conjunto de bindings gobernados espejo de la migración 066 (3 bindings) más los 4
//     requisitos gobernados en tiempo de ejecución.
//
// Qué es y qué NO es:
//   - Es un CANDIDATO VALIDADO (`validated_candidate`), regenerable y byte-idéntico dado el mismo
//     insumo y la misma marca ISO. Cierra dos libros (section_ledger de 15 y proposal_ledger de 20),
//     cada fuente aparece exactamente una vez con una disposición explícita, y cada requisito
//     producido resuelve a una entrada con forma cerrada.
//   - NO habilita, NO puntúa, NO afirma cumplimiento ni suficiencia, NO auto-aprueba:
//     `human_approval_required: true`, `human_approved: false`, y ninguna entrada lleva status
//     `human_approved`. La categoría es metadato de gobernanza, nunca una decisión de cumplimiento.
//   - La clase de evidencia empresarial es sólo una de las 17 clases cerradas o null; jamás se
//     fabrica (p.ej. nunca se inventa `technical_certifications` para el alcance de video).
//   - Pereira SA-MC-02-2026 vive en las fuentes sólo como lección/provenance de método, nunca como
//     prueba de cumplimiento de Manizales.
//
// Disciplina: reglas cerradas, deterministas, sin I/O, sin reloj, sin red. El builder recibe los
// tres artefactos ya parseados y una marca ISO; el espejo de 066 es una constante congelada.

import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';
import { assertNoOpenPii } from './agt002-contractual-registry-taxonomy.js';

export const AGT002_INTEGRAL_MANIFEST_ARTIFACT_TYPE = 'agt002_manizales_integral_manifest';
export const AGT002_INTEGRAL_MANIFEST_CONTRACT_VERSION = 'agt002-manizales-integral-manifest@1';
export const AGT002_INTEGRAL_MANIFEST_STATUS = 'validated_candidate';
export const AGT002_INTEGRAL_MANIFEST_VERSION = 1;
export const AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID = '54190e51-15fb-46af-b0aa-8f13461a3110';
export const AGT002_INTEGRAL_MANIFEST_PROCESO = 'SA-24-2026';

const VIGENTE_PLIEGO_DOCUMENT_ID = 'db9752a1-e9ee-49af-b321-883d0c23cf0a';
const MIGRATION_066 = '066_agt002_manizales_integral_governance.sql';

// Vocabulario CERRADO de categorías de gobernanza. `null` es abstención explícita (ambigüedad
// irreducible), nunca un descarte silencioso.
export const AGT002_INTEGRAL_MANIFEST_CATEGORIES = Object.freeze([
  'discard', 'habilitating', 'technical', 'financial_execution',
]);

// Disposición de cada asiento de libro. `excluded_with_reason` exige razón documental.
export const AGT002_INTEGRAL_MANIFEST_DISPOSITIONS = Object.freeze([
  'analyzed_candidate', 'excluded_with_reason', 'unresolved_visible',
]);

export const AGT002_INTEGRAL_MANIFEST_ENTRY_ORIGINS = Object.freeze([
  'governed_runtime', 'section_proposal', 'lifecycle_gate',
]);

// Espejo CONGELADO de los 3 bindings gobernados de la migración 066 (category_override +
// evidence_class_link por requisito). Es la única autoridad de categoría/clase para estos 3
// requisitos; se refleja aquí, no se re-deriva.
export const AGT002_INTEGRAL_OVERRIDES_066 = Object.freeze({
  'financial-working-capital': Object.freeze({ category: 'habilitating', evidence_class_id: 'rup' }),
  'legal-rce-policy': Object.freeze({ category: 'habilitating', evidence_class_id: 'rce_policy' }),
  'legal-collective-life-policy': Object.freeze({ category: 'habilitating', evidence_class_id: 'collective_life_policy' }),
});

// Los 4 requisitos gobernados en tiempo de ejecución que el extractor cerrado reconoce. Los 3
// primeros toman su categoría/clase del espejo de 066; el 4º no tiene binding 066: mapea
// técnico=>technical de forma determinista y su clase permanece candidata/null (nunca se inventa).
const GOVERNED_RUNTIME = Object.freeze([
  Object.freeze({ requirement_id: 'financial-working-capital', kind: 'financiero', materiality: 'material' }),
  Object.freeze({ requirement_id: 'legal-rce-policy', kind: 'juridico', materiality: 'ordinary' }),
  Object.freeze({ requirement_id: 'legal-collective-life-policy', kind: 'juridico', materiality: 'ordinary' }),
  Object.freeze({ requirement_id: 'technical-video-surveillance-scope', kind: 'tecnico', materiality: 'ordinary' }),
]);

export const AGT002_INTEGRAL_GOVERNED_RUNTIME_IDS = Object.freeze(GOVERNED_RUNTIME.map(g => g.requirement_id));

// Mapa determinista sección(categoría del pliego)=>categoría de gobernanza para las 10 secciones
// con propuesta curada. Se aplica por item_ref; una sección fuera de este mapa es ambigüedad
// irreducible (fail-closed). No hay descarte silencioso: toda sección mapeada es analizable.
const PROPOSAL_SECTION_CATEGORY = Object.freeze({
  '2.3': 'habilitating',    // capacidad organizacional
  '2.4': 'habilitating',    // experiencia
  '2.4.1': 'habilitating',  // criterios diferenciales de experiencia (habilitante)
  '2.5': 'habilitating',    // reglas de subsanabilidad
  '3.1': 'technical',       // factor calidad (puntuable)
  '3.2': 'technical',       // apoyo a la industria nacional (puntuable/diferencial)
  '3.3': 'technical',       // proponentes en condición de discapacidad (puntuable/diferencial)
  '3.4': 'technical',       // criterio diferencial mujeres (puntuable)
  '3.5': 'technical',       // criterio diferencial MIPYME (puntuable)
  '3.6': 'financial_execution', // factor económico / oferta económica
});

const PROBATIVE_LIMITS = Object.freeze([
  'Este manifiesto es un CANDIDATO VALIDADO para revisión humana: no habilita, no puntúa y no afirma cumplimiento ni suficiencia.',
  'La categoría es metadato de gobernanza (descarte/habilitante/técnico/ejecución financiera o null), nunca una decisión de cumplimiento.',
  'La clase de evidencia empresarial es una de las 17 clases cerradas o null; jamás se fabrica (p.ej. nunca se inventa una clase para el alcance de video).',
  'Los 3 bindings gobernados provienen del espejo de la migración 066; el 4º requisito gobernado mapea técnico=>technical y mantiene su clase candidata/null.',
  'La aplicabilidad, la suficiencia, la subsanabilidad y el GO/NO-GO son compuertas humanas; `human_approved` es siempre false y ninguna entrada se auto-aprueba.',
  'Rama Judicial Pereira SA-MC-02-2026 vive en las fuentes sólo como lección/provenance de método; no prueba cumplimiento de Manizales ni traslada aplicabilidad.',
]);

// --- utilidades deterministas ---------------------------------------------------------------

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AGT-002 manifiesto integral: ${label} debe ser texto no vacío.`);
  return value;
}

function assertIsoTimestamp(value, label) {
  requireNonEmptyString(value, label);
  if (Number.isNaN(new Date(value).getTime())) throw new Error(`AGT-002 manifiesto integral: ${label} debe ser una marca ISO válida.`);
  return value;
}

// Digest determinista (FNV-1a 32 bits) de metadatos estables del documento. No hay red ni cripto
// externa: es un resumen reproducible de identidad/provenance, no un hash del contenido íntegro.
function fnv1aHex(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const VIGENCIA_RANK = Object.freeze({ vigente: 0, soporte: 1, historico: 2, superseded: 3 });

// --- fuentes documentales (17) --------------------------------------------------------------

function buildSourceDocuments(registry) {
  const provenance = Array.isArray(registry.provenance) ? registry.provenance : [];
  if (provenance.length !== 17) {
    throw new Error(`AGT-002 manifiesto integral: se esperaban 17 documentos de provenance, hay ${provenance.length}.`);
  }
  const ordered = provenance
    .map(p => ({
      document_id: p.document_id,
      name: p.name,
      document_type: p.document_type,
      provenance_kind: p.provenance_kind,
      version: typeof p.vigencia === 'string' ? p.vigencia : 'desconocida',
      is_vigente: p.vigencia === 'vigente',
      is_vigente_pliego: p.is_vigente_pliego === true,
    }))
    .sort((a, b) => (
      (b.is_vigente_pliego ? 1 : 0) - (a.is_vigente_pliego ? 1 : 0)
      || (VIGENCIA_RANK[a.version] ?? 9) - (VIGENCIA_RANK[b.version] ?? 9)
      || a.document_id.localeCompare(b.document_id)
    ));
  return ordered.map((d, i) => ({
    document_id: d.document_id,
    name: d.name,
    document_type: d.document_type,
    provenance_kind: d.provenance_kind,
    version: d.version,
    is_vigente: d.is_vigente,
    is_vigente_pliego: d.is_vigente_pliego,
    precedence: i + 1,
    hash: fnv1aHex(`${d.document_id}:${d.name}:${d.version}`),
  }));
}

// --- texto fuente por documento (fragmentos reales, sin relleno inventado) -------------------

// Sólo almacenamos los fragmentos de texto que realmente poseemos: las citas corporales de las
// propuestas (quote === [char_start,char_end) del cuerpo del pliego vigente). No se rellenan los
// huecos entre citas: no fabricamos texto que no tenemos.
function buildSourceText(proposals) {
  const fragments = [];
  for (const section of proposals.sections || []) {
    for (const r of section.requirements || []) {
      const c = r.source_citation;
      if (!c || c.document_id !== VIGENTE_PLIEGO_DOCUMENT_ID) continue;
      if (typeof c.quote !== 'string' || c.quote.length !== c.char_end - c.char_start) continue;
      fragments.push({ char_start: c.char_start, char_end: c.char_end, text: c.quote, kind: 'proposal_quote' });
    }
  }
  fragments.sort((a, b) => a.char_start - b.char_start || a.char_end - b.char_end);
  return { [VIGENTE_PLIEGO_DOCUMENT_ID]: { document_id: VIGENTE_PLIEGO_DOCUMENT_ID, length: null, fragments } };
}

// Una cita queda resuelta sólo si existe un fragmento real que la cubra y cuyo texto coincida
// EXACTAMENTE con su quote en [char_start,char_end). Superada / sin fragmento => no resuelta.
function citationResolved(sourceText, citation) {
  const doc = sourceText[citation.document_id];
  if (!doc) return false;
  const frag = doc.fragments.find(f => f.char_start <= citation.char_start && f.char_end >= citation.char_end);
  if (!frag) return false;
  return frag.text.slice(citation.char_start - frag.char_start, citation.char_end - frag.char_start) === citation.quote;
}

function makeCitation(sourceDocsById, sourceText, { document_id, char_start, char_end, quote }) {
  const doc = sourceDocsById.get(document_id);
  if (!doc) throw new Error(`AGT-002 manifiesto integral: cita referencia un documento fuera de las 17 fuentes: ${document_id}.`);
  const citation = {
    document_id,
    version: doc.version,
    hash: doc.hash,
    is_vigente: doc.is_vigente,
    precedence: doc.precedence,
    char_start,
    char_end,
    quote,
    resolved: false,
  };
  citation.resolved = citationResolved(sourceText, citation);
  return citation;
}

// --- entradas ------------------------------------------------------------------------------

function analyzableFrom(category, citations) {
  if (category === null) return false;
  return citations.some(c => c.is_vigente && c.resolved);
}

function freezeEntry(entry) {
  // Forma CERRADA de la entrada (claves exactas). El validador re-verifica esta forma.
  return {
    requirement_id: entry.requirement_id,
    origin: entry.origin,
    item_ref: entry.item_ref ?? null,
    category: entry.category ?? null,
    evidence_class_id: entry.evidence_class_id ?? null,
    materiality: entry.materiality,
    subsanability: entry.subsanability,
    status: entry.status,
    analyzable: entry.analyzable,
    human_review_required: entry.human_review_required,
    source_refs: entry.source_refs,
    citations: entry.citations,
  };
}

function buildGovernedRuntimeEntries(registry, sourceDocsById, sourceText) {
  const itemsByRef = new Map(registry.items.map(i => [i.ref, i]));
  // Secciones (en section_ledger) que listan cada requisito gobernado: dan el source_ref
  // section_ledger y el item_ref primario (la primera sección habilitante que lo lista).
  const producedBy = new Map(GOVERNED_RUNTIME.map(g => [g.requirement_id, []]));
  for (const item of registry.items) {
    for (const id of item.governed_requirement_ids || []) {
      if (producedBy.has(id)) producedBy.get(id).push(item.ref);
    }
  }

  return GOVERNED_RUNTIME.map((g) => {
    const binding = AGT002_INTEGRAL_OVERRIDES_066[g.requirement_id] || null;
    const category = binding ? binding.category : (g.kind === 'tecnico' ? 'technical' : null);
    const evidence_class_id = binding ? binding.evidence_class_id : null;
    const producingRefs = producedBy.get(g.requirement_id) || [];
    // item_ref primario: preferimos una sección habilitante; si no, la primera que lo lista.
    const primaryRef = producingRefs.find(ref => itemsByRef.get(ref)?.fase === 'habilitante') || producingRefs[0] || null;

    const source_refs = [{ type: 'governed_runtime', ref: g.requirement_id, resolved: true }];
    for (const ref of producingRefs) source_refs.push({ type: 'section_ledger', ref, resolved: true });

    // Cita disponible: el span de la sección primaria del registro. Es un EXCERPT (quote != span
    // completo), así que no resuelve a fragmento => la entrada no es analizable por cita.
    const citations = [];
    const primaryItem = primaryRef ? itemsByRef.get(primaryRef) : null;
    if (primaryItem && primaryItem.cite) {
      citations.push(makeCitation(sourceDocsById, sourceText, {
        document_id: VIGENTE_PLIEGO_DOCUMENT_ID,
        char_start: primaryItem.cite.char_start,
        char_end: primaryItem.cite.char_end,
        quote: primaryItem.cite.excerpt,
      }));
    }

    return freezeEntry({
      requirement_id: g.requirement_id,
      origin: 'governed_runtime',
      item_ref: primaryRef,
      category,
      evidence_class_id,
      materiality: g.materiality,
      subsanability: primaryItem?.subsanabilidad ?? 'no_determinado',
      status: 'analyzed_candidate',
      analyzable: analyzableFrom(category, citations),
      human_review_required: true,
      source_refs,
      citations,
    });
  });
}

function proposalMateriality(section) {
  if (section.item_ref === '3.6') return 'economic';
  if (section.fase === 'puntuable') return 'scorable';
  return 'ordinary';
}

function buildProposalEntries(proposals, sourceDocsById, sourceText) {
  const entries = [];
  for (const section of proposals.sections || []) {
    const category = PROPOSAL_SECTION_CATEGORY[section.item_ref];
    if (!category) {
      throw new Error(`AGT-002 manifiesto integral: sección de propuesta sin categoría determinista: ${section.item_ref} (ambigüedad irreducible).`);
    }
    for (const r of section.requirements || []) {
      const c = r.source_citation;
      const citations = [makeCitation(sourceDocsById, sourceText, {
        document_id: c.document_id,
        char_start: c.char_start,
        char_end: c.char_end,
        quote: c.quote,
      })];
      // Origen pliego => debe incluir cita del pliego vigente.
      if (c.document_id === VIGENTE_PLIEGO_DOCUMENT_ID && !citations.some(x => x.is_vigente)) {
        throw new Error(`AGT-002 manifiesto integral: ${r.requirement_id} con origen pliego sin cita vigente.`);
      }
      const evidence_class_id = r.candidate_evidence_class_id ?? null;
      entries.push(freezeEntry({
        requirement_id: r.requirement_id,
        origin: 'section_proposal',
        item_ref: section.item_ref,
        category,
        evidence_class_id,
        materiality: proposalMateriality(section),
        subsanability: r.subsanability?.candidate ?? 'no_determinada_requiere_humano',
        status: 'analyzed_candidate',
        analyzable: analyzableFrom(category, citations),
        human_review_required: true,
        source_refs: [
          { type: 'proposal_ledger', ref: r.requirement_id, resolved: true },
          { type: 'section_ledger', ref: section.item_ref, resolved: true },
        ],
        citations,
      }));
    }
  }
  return entries;
}

// Compuerta de ciclo de vida cierre/prórroga: SIEMPRE presente, con origen en el suplemento del
// registro §1.8 (cronograma: cierre y eventuales prórrogas). Ambigüedad de aplicabilidad =>
// categoría null, unresolved_visible, revisión humana, no analizable.
function buildLifecycleGateEntry(registry, sourceDocsById, sourceText) {
  const supplement = registry.items.find(i => i.ref === '1.8');
  if (!supplement) throw new Error('AGT-002 manifiesto integral: falta la sección de cronograma §1.8 para la compuerta de cierre/prórroga.');
  const citations = supplement.cite ? [makeCitation(sourceDocsById, sourceText, {
    document_id: VIGENTE_PLIEGO_DOCUMENT_ID,
    char_start: supplement.cite.char_start,
    char_end: supplement.cite.char_end,
    quote: supplement.cite.excerpt,
  })] : [];
  return freezeEntry({
    requirement_id: 'lifecycle:cierre-prorroga',
    origin: 'lifecycle_gate',
    item_ref: '1.8',
    category: null,
    evidence_class_id: null,
    materiality: 'ordinary',
    subsanability: 'no_determinada_requiere_humano',
    status: 'unresolved_visible',
    analyzable: false,
    human_review_required: true,
    source_refs: [{ type: 'registry_supplement', ref: '1.8', resolved: true }],
    citations,
  });
}

// --- libros (ledgers) ----------------------------------------------------------------------

function buildSectionLedger(registry, analysis, proposals) {
  const itemsByRef = new Map(registry.items.map(i => [i.ref, i]));
  const proposalIdsByRef = new Map((proposals.sections || []).map(s => [s.item_ref, s.requirements.map(r => r.requirement_id)]));
  const relevant = (analysis.crossings || []).filter(c => c.pre_go_relevant === true);
  return relevant.map((c) => {
    const item = itemsByRef.get(c.item_ref);
    const governed = (c.governed_requirement_ids || []).filter(id => AGT002_INTEGRAL_GOVERNED_RUNTIME_IDS.includes(id));
    const proposalIds = proposalIdsByRef.get(c.item_ref) || [];
    const produced = governed.length ? governed : proposalIds;
    const origin = governed.length ? 'governed_runtime' : 'section_proposal';
    return {
      item_ref: c.item_ref,
      titulo: item?.titulo ?? c.titulo ?? null,
      fase: c.fase,
      categoria: c.categoria ?? null,
      origin,
      disposition: 'analyzed_candidate',
      produced_requirement_ids: produced,
      reason: origin === 'governed_runtime'
        ? 'seccion_pre_go_con_requisito_gobernado_reconocido'
        : 'seccion_pre_go_con_propuesta_curada_para_revision_humana',
    };
  });
}

function buildProposalLedger(proposals) {
  const ledger = [];
  for (const section of proposals.sections || []) {
    for (const r of section.requirements || []) {
      ledger.push({
        requirement_id: r.requirement_id,
        item_ref: section.item_ref,
        label: r.label,
        requirement_kind: r.requirement_kind,
        candidate_evidence_class_id: r.candidate_evidence_class_id ?? null,
        disposition: 'analyzed_candidate',
        produced_requirement_ids: [r.requirement_id],
        reason: 'propuesta_curada_atomizada_para_revision_humana',
      });
    }
  }
  return ledger;
}

function tallyDispositions(ledger) {
  const by = { analyzed_candidate: 0, excluded_with_reason: 0, unresolved_visible: 0 };
  for (const item of ledger) by[item.disposition] += 1;
  return by;
}

// --- construcción principal -----------------------------------------------------------------

/**
 * Construye el manifiesto integral versionado consolidando las tres fuentes gobernadas y el
 * espejo de la migración 066.
 *
 * @param {object} params.registry     Registro contractual parseado (68 secciones, 17 documentos).
 * @param {object} params.analysis     Análisis pre-GO parseado (15 secciones relevantes pre-GO).
 * @param {object} params.proposals    Propuestas de sección parseadas (20 propuestas en 10 secciones).
 * @param {string} params.generatedAt  Marca ISO determinista (el módulo nunca lee el reloj).
 */
export function buildAgt002ManizalesIntegralManifest({ registry, analysis, proposals, generatedAt } = {}) {
  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.items)) {
    throw new Error('AGT-002 manifiesto integral: registry debe ser el registro contractual con items.');
  }
  if (!analysis || typeof analysis !== 'object' || !Array.isArray(analysis.crossings)) {
    throw new Error('AGT-002 manifiesto integral: analysis debe ser el análisis pre-GO con crossings.');
  }
  if (!proposals || typeof proposals !== 'object' || !Array.isArray(proposals.sections)) {
    throw new Error('AGT-002 manifiesto integral: proposals debe ser el artefacto de propuestas con sections.');
  }
  const generatedAtIso = assertIsoTimestamp(generatedAt, 'generatedAt');

  const source_documents = buildSourceDocuments(registry);
  const sourceDocsById = new Map(source_documents.map(d => [d.document_id, d]));
  const source_text_by_document_id = buildSourceText(proposals);

  const section_ledger = buildSectionLedger(registry, analysis, proposals);
  const proposal_ledger = buildProposalLedger(proposals);

  const entries = [
    ...buildGovernedRuntimeEntries(registry, sourceDocsById, source_text_by_document_id),
    ...buildProposalEntries(proposals, sourceDocsById, source_text_by_document_id),
    buildLifecycleGateEntry(registry, sourceDocsById, source_text_by_document_id),
  ];

  const proposalTotal = (proposals.sections || []).reduce((n, s) => n + s.requirements.length, 0);
  const byCategory = {};
  const byOrigin = { governed_runtime: 0, section_proposal: 0, lifecycle_gate: 0 };
  for (const e of entries) {
    const key = e.category === null ? 'null' : e.category;
    byCategory[key] = (byCategory[key] || 0) + 1;
    byOrigin[e.origin] += 1;
  }

  const coverage = {
    registry_sections: registry.items.length,
    proposals: proposalTotal,
    proposal_sections: (proposals.sections || []).length,
    governed_runtime: GOVERNED_RUNTIME.length,
    governed_bindings_066: Object.keys(AGT002_INTEGRAL_OVERRIDES_066).length,
    section_ledger: { total: section_ledger.length, by_disposition: tallyDispositions(section_ledger) },
    proposal_ledger: { total: proposal_ledger.length, by_disposition: tallyDispositions(proposal_ledger) },
    entries: {
      total: entries.length,
      analyzable: entries.filter(e => e.analyzable).length,
      unresolved_visible: entries.filter(e => e.status === 'unresolved_visible').length,
      by_category: byCategory,
      by_origin: byOrigin,
    },
  };

  const manifest = {
    artifact_type: AGT002_INTEGRAL_MANIFEST_ARTIFACT_TYPE,
    contract_version: AGT002_INTEGRAL_MANIFEST_CONTRACT_VERSION,
    status: AGT002_INTEGRAL_MANIFEST_STATUS,
    human_approval_required: true,
    human_approved: false,
    version: AGT002_INTEGRAL_MANIFEST_VERSION,
    opportunity_id: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
    proceso: AGT002_INTEGRAL_MANIFEST_PROCESO,
    generated_at: generatedAtIso,
    source_set: {
      registry: {
        artifact_type: typeof registry.artifact_type === 'string' ? registry.artifact_type : null,
        taxonomy_version: typeof registry.taxonomy_version === 'string' ? registry.taxonomy_version : null,
        total_secciones: registry.items.length,
        provenance: source_documents.length,
      },
      pre_go_analysis: {
        artifact_type: typeof analysis.artifact_type === 'string' ? analysis.artifact_type : null,
        contract_version: typeof analysis.contract_version === 'string' ? analysis.contract_version : null,
        secciones_relevantes_pre_go: section_ledger.length,
      },
      section_proposals: {
        artifact_type: typeof proposals.artifact_type === 'string' ? proposals.artifact_type : null,
        contract_version: typeof proposals.contract_version === 'string' ? proposals.contract_version : null,
        sections: (proposals.sections || []).length,
        requirements: proposalTotal,
      },
      governed_overrides_066: {
        migration: MIGRATION_066,
        bindings: Object.keys(AGT002_INTEGRAL_OVERRIDES_066).length,
        requirement_ids: Object.keys(AGT002_INTEGRAL_OVERRIDES_066),
      },
    },
    source_documents,
    source_text_by_document_id,
    section_ledger,
    proposal_ledger,
    entries,
    coverage,
    human_gates: {
      applicability: 'decision_humana_por_seccion',
      sufficiency: 'decision_humana_por_requisito',
      subsanability: 'decision_humana_por_requisito',
      go_no_go: 'compuerta_humana_obligatoria',
    },
    probative_limits: PROBATIVE_LIMITS,
  };

  validateAgt002ManizalesIntegralManifest(manifest);
  assertNoOpenPii(manifest);
  return manifest;
}

// --- validación fail-closed -----------------------------------------------------------------

const ENTRY_KEYS = Object.freeze([
  'requirement_id', 'origin', 'item_ref', 'category', 'evidence_class_id', 'materiality',
  'subsanability', 'status', 'analyzable', 'human_review_required', 'source_refs', 'citations',
].sort());

const SOURCE_REF_TYPES = new Set(['section_ledger', 'proposal_ledger', 'governed_runtime', 'registry_supplement']);

// Único registry_supplement de vocabulario cerrado emitido por el builder (compuerta cierre/prórroga).
const REGISTRY_SUPPLEMENT_REFS = new Set(['1.8']);

export function validateAgt002ManizalesIntegralManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('AGT-002 manifiesto integral: el artefacto debe ser un objeto.');
  }
  if (manifest.artifact_type !== AGT002_INTEGRAL_MANIFEST_ARTIFACT_TYPE) throw new Error('AGT-002 manifiesto integral: artifact_type inesperado.');
  if (manifest.contract_version !== AGT002_INTEGRAL_MANIFEST_CONTRACT_VERSION) throw new Error('AGT-002 manifiesto integral: contract_version inesperado.');
  if (manifest.status !== AGT002_INTEGRAL_MANIFEST_STATUS) throw new Error('AGT-002 manifiesto integral: status inesperado.');
  if (manifest.version !== AGT002_INTEGRAL_MANIFEST_VERSION) throw new Error('AGT-002 manifiesto integral: version inesperada.');
  if (manifest.human_approval_required !== true) throw new Error('AGT-002 manifiesto integral: human_approval_required debe ser true.');
  if (manifest.human_approved !== false) throw new Error('AGT-002 manifiesto integral: human_approved debe ser false (candidato, no aprobado).');
  if (manifest.opportunity_id !== AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID) throw new Error('AGT-002 manifiesto integral: opportunity_id inesperado.');
  if (manifest.proceso !== AGT002_INTEGRAL_MANIFEST_PROCESO) throw new Error('AGT-002 manifiesto integral: proceso inesperado.');
  assertIsoTimestamp(manifest.generated_at, 'generated_at');

  if (!Array.isArray(manifest.source_documents) || manifest.source_documents.length !== 17) {
    throw new Error('AGT-002 manifiesto integral: source_documents debe tener exactamente 17 documentos.');
  }
  const docsById = new Map(manifest.source_documents.map(d => [d.document_id, d]));
  const sourceText = manifest.source_text_by_document_id;

  const entries = manifest.entries;
  if (!Array.isArray(entries)) throw new Error('AGT-002 manifiesto integral: entries debe ser un arreglo.');
  const entryIds = new Set();
  for (const e of entries) {
    if (JSON.stringify(Object.keys(e).sort()) !== JSON.stringify(ENTRY_KEYS)) {
      throw new Error(`AGT-002 manifiesto integral: forma de entrada no cerrada en ${e.requirement_id}.`);
    }
    if (entryIds.has(e.requirement_id)) throw new Error(`AGT-002 manifiesto integral: requirement_id de entrada duplicado: ${e.requirement_id}.`);
    entryIds.add(e.requirement_id);
    if (!AGT002_INTEGRAL_MANIFEST_ENTRY_ORIGINS.includes(e.origin)) throw new Error(`AGT-002 manifiesto integral: origin inválido en ${e.requirement_id}.`);
    if (e.item_ref !== null && typeof e.item_ref !== 'string') throw new Error(`AGT-002 manifiesto integral: item_ref inválido en ${e.requirement_id}.`);
    if (e.category !== null && !AGT002_INTEGRAL_MANIFEST_CATEGORIES.includes(e.category)) throw new Error(`AGT-002 manifiesto integral: category fuera de vocabulario en ${e.requirement_id}.`);
    if (e.evidence_class_id !== null && !AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(e.evidence_class_id)) {
      throw new Error(`AGT-002 manifiesto integral: clase de evidencia fuera del catálogo de 17 en ${e.requirement_id}.`);
    }
    if (e.status === 'human_approved') throw new Error(`AGT-002 manifiesto integral: ninguna entrada puede tener status human_approved (${e.requirement_id}).`);
    if (typeof e.analyzable !== 'boolean') throw new Error(`AGT-002 manifiesto integral: analyzable debe ser booleano en ${e.requirement_id}.`);
    // Analizable exige categoría no nula y >=1 cita vigente resuelta.
    if (e.analyzable && (e.category === null || !e.citations.some(c => c.is_vigente && c.resolved))) {
      throw new Error(`AGT-002 manifiesto integral: ${e.requirement_id} marcada analizable sin categoría o sin cita vigente resuelta.`);
    }
    // Origen pliego (proposal) => cita vigente del pliego presente.
    if (e.origin === 'section_proposal' && !e.citations.some(c => c.document_id === VIGENTE_PLIEGO_DOCUMENT_ID && c.is_vigente)) {
      throw new Error(`AGT-002 manifiesto integral: propuesta ${e.requirement_id} sin cita del pliego vigente.`);
    }
    // >=1 source ref resuelto de tipo permitido.
    if (!Array.isArray(e.source_refs) || !e.source_refs.some(r => r.resolved && SOURCE_REF_TYPES.has(r.type))) {
      throw new Error(`AGT-002 manifiesto integral: ${e.requirement_id} sin source_ref resuelto de tipo permitido.`);
    }
    // Cada source_ref debe identificar algo real, no sólo declararse resuelto.
    for (const r of e.source_refs) {
      if (r.type === 'governed_runtime' && !AGT002_INTEGRAL_GOVERNED_RUNTIME_IDS.includes(r.ref)) {
        throw new Error(`AGT-002 manifiesto integral: ${e.requirement_id} referencia governed_runtime desconocida: ${r.ref}.`);
      }
      if (r.type === 'registry_supplement' && !REGISTRY_SUPPLEMENT_REFS.has(r.ref)) {
        throw new Error(`AGT-002 manifiesto integral: ${e.requirement_id} referencia registry_supplement inexistente: ${r.ref}.`);
      }
    }
    // Citas: coherencia de metadatos con las fuentes.
    for (const c of e.citations) {
      const doc = docsById.get(c.document_id);
      if (!doc) throw new Error(`AGT-002 manifiesto integral: cita a documento desconocido en ${e.requirement_id}.`);
      if (c.is_vigente !== doc.is_vigente || c.precedence !== doc.precedence) {
        throw new Error(`AGT-002 manifiesto integral: metadatos de cita inconsistentes con la fuente en ${e.requirement_id}.`);
      }
      if (!Number.isInteger(c.char_start) || !Number.isInteger(c.char_end) || c.char_end <= c.char_start) {
        throw new Error(`AGT-002 manifiesto integral: rango de cita inválido en ${e.requirement_id}.`);
      }
      // `resolved` no se confía tal cual: se recomputa contra source_text_by_document_id.
      if (c.resolved !== citationResolved(sourceText, c)) {
        throw new Error(`AGT-002 manifiesto integral: resolved de cita no coincide con source_text_by_document_id en ${e.requirement_id}.`);
      }
    }
    // material/scorable/economic nunca se excluye en silencio.
    if (['material', 'scorable', 'economic'].includes(e.materiality)) {
      if (!['analyzed_candidate', 'unresolved_visible'].includes(e.status)) {
        throw new Error(`AGT-002 manifiesto integral: ${e.requirement_id} material/scorable/economic no puede excluirse en silencio.`);
      }
    }
  }

  // Compuerta de ciclo de vida cierre/prórroga siempre presente.
  const gate = entries.find(e => e.origin === 'lifecycle_gate');
  if (!gate) throw new Error('AGT-002 manifiesto integral: falta la compuerta de ciclo de vida cierre/prórroga.');
  if (gate.status !== 'unresolved_visible') throw new Error('AGT-002 manifiesto integral: la compuerta cierre/prórroga debe estar al menos unresolved_visible.');
  if (!gate.source_refs.some(r => r.type === 'registry_supplement' && r.resolved)) {
    throw new Error('AGT-002 manifiesto integral: la compuerta cierre/prórroga debe originarse en un suplemento del registro.');
  }

  // Libros cerrados.
  if (!Array.isArray(manifest.section_ledger) || manifest.section_ledger.length !== 15) {
    throw new Error('AGT-002 manifiesto integral: section_ledger debe estar cerrado en exactamente 15.');
  }
  if (!Array.isArray(manifest.proposal_ledger) || manifest.proposal_ledger.length !== 20) {
    throw new Error('AGT-002 manifiesto integral: proposal_ledger debe estar cerrado en exactamente 20.');
  }
  const validateLedger = (ledger, keyField, label) => {
    const seen = new Set();
    for (const item of ledger) {
      const key = item[keyField];
      if (seen.has(key)) throw new Error(`AGT-002 manifiesto integral: ${label} con ${keyField} duplicado: ${key}.`);
      seen.add(key);
      if (!AGT002_INTEGRAL_MANIFEST_DISPOSITIONS.includes(item.disposition)) {
        throw new Error(`AGT-002 manifiesto integral: disposición inválida en ${label} ${key}.`);
      }
      if (item.disposition === 'excluded_with_reason') {
        if (typeof item.reason !== 'string' || !item.reason.trim()) {
          throw new Error(`AGT-002 manifiesto integral: ${label} ${key} excluido sin razón documental.`);
        }
      } else if (!Array.isArray(item.produced_requirement_ids) || item.produced_requirement_ids.length === 0) {
        throw new Error(`AGT-002 manifiesto integral: ${label} ${key} analizado/no resuelto sin produced_requirement_ids.`);
      }
      for (const id of item.produced_requirement_ids || []) {
        if (!entryIds.has(id)) throw new Error(`AGT-002 manifiesto integral: ${label} ${key} produce un id que no resuelve a una entrada: ${id}.`);
      }
    }
  };
  validateLedger(manifest.section_ledger, 'item_ref', 'section_ledger');
  validateLedger(manifest.proposal_ledger, 'requirement_id', 'proposal_ledger');

  // Cobertura coherente.
  const c = manifest.coverage;
  if (!c || c.registry_sections !== 68 || c.proposals !== 20 || c.proposal_sections !== 10
    || c.governed_runtime !== 4 || c.governed_bindings_066 !== 3) {
    throw new Error('AGT-002 manifiesto integral: cobertura no prueba las cuentas requeridas (68/20/10/4/3).');
  }
  if (c.section_ledger.total !== 15 || c.proposal_ledger.total !== 20) {
    throw new Error('AGT-002 manifiesto integral: totales de libro en cobertura inconsistentes.');
  }
  return manifest;
}

// Pasada de CORRECCIONES MECÁNICAS del manifiesto integral versionado de Rama Judicial Manizales
// SA-24-2026 (Phase 2). Recibe un manifiesto YA construido por
// agt002-manizales-integral-manifest.js y le aplica, de forma pura, determinista e idempotente,
// nueve reglas de saneamiento. Toda regla es una DEGRADACIÓN o una ABSTENCIÓN: jamás promueve
// analizabilidad, cumplimiento, suficiencia, puntaje, categoría gobernada ni aprobación humana.
//
// Disciplina (idéntica al resto del flujo AGT-002):
//   - Sin I/O, sin red, sin reloj: función pura del manifiesto de entrada.
//   - No muta la entrada (opera sobre una copia profunda).
//   - Idempotente: una segunda pasada sobre el artefacto corregido produce cero correcciones y un
//     manifiesto byte-idéntico.
//   - No inventa citas ni evidencia: cuando una regla no puede resolver de forma determinista,
//     abstiene (marca no analizable / revisión humana / clase null), nunca adivina.
//   - No debilita el validador de Phase 1: el artefacto corregido vuelve a pasar
//     validateAgt002ManizalesIntegralManifest sin cambios en ese contrato.
//
// Cada corrección se registra como { requirement_id, rule, before, after, basis_citation }.

import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';
import { REGISTRO_FASE_POR_CAPITULO } from './agt002-contractual-registry-taxonomy.js';
import { AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES } from './agt002-pre-go-analysis.js';
import { AGT002_PROPOSAL_SUBSANABILITY } from './agt002-pre-go-section-proposals.js';

const VIGENTE_PLIEGO_DOCUMENT_ID = 'db9752a1-e9ee-49af-b321-883d0c23cf0a';

// Orden CERRADO y determinista de las nueve reglas. También es el orden de aplicación.
export const AGT002_MANIFEST_CORRECTION_RULES = Object.freeze([
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

// Único requisito gobernado cuya materialidad `material` está respaldada por una categoría real del
// catálogo cerrado de impedimentos materiales. No se deriva materialidad para nada más.
const GOVERNED_MATERIAL_BASIS = Object.freeze({
  'financial-working-capital': 'capacidad_financiera_insuficiente',
});

// Clases de evidencia operativas (licencias/habilitaciones) cuyo emparejamiento con un factor
// puramente económico (oferta económica §3.6) es implausible por dominio.
const OPERATIONAL_LICENCE_CLASSES = new Set([
  'supervigilancia_operating_license',
  'communications_license',
  'uniforms_resolution',
  'authorized_weapons_list',
]);

const deepClone = (value) => JSON.parse(JSON.stringify(value));

function pushCorrection(corrections, requirement_id, rule, before, after, basis_citation) {
  corrections.push({ requirement_id, rule, before, after, basis_citation });
}

// Recomputación honesta de la resolución de una cita contra el texto fuente real (misma lógica que
// el builder: un fragmento que la cubra y cuyo slice coincida EXACTAMENTE con la quote).
function citationResolved(sourceText, citation) {
  const doc = sourceText?.[citation.document_id];
  if (!doc || !Array.isArray(doc.fragments)) return false;
  const frag = doc.fragments.find(
    (f) => f.char_start <= citation.char_start && f.char_end >= citation.char_end,
  );
  if (!frag) return false;
  return frag.text.slice(citation.char_start - frag.char_start, citation.char_end - frag.char_start) === citation.quote;
}

function hasVigenteGrounding(entry) {
  return entry.category !== null && (entry.citations || []).some((c) => c.is_vigente === true && c.resolved === true);
}

function demoteToUnresolved(entry) {
  entry.analyzable = false;
  entry.status = 'unresolved_visible';
  entry.human_review_required = true;
}

function normalizeLabel(label) {
  return String(label ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

const cmpCitation = (a, b) => (
  String(a.document_id).localeCompare(String(b.document_id))
  || a.char_start - b.char_start
  || a.char_end - b.char_end
);

function citationsDisjoint(citations) {
  if (!Array.isArray(citations) || citations.length < 2) return false;
  const ordered = [...citations].sort(cmpCitation);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    // solapamiento sólo cuenta dentro del mismo documento.
    if (cur.document_id === prev.document_id && cur.char_start < prev.char_end) return false;
  }
  return true;
}

// Reemplaza, en ambos libros, toda aparición de `oldId` en produced_requirement_ids por `newIds`,
// preservando el orden y sin duplicar. La fila cuyo requirement_id === oldId conserva su id pero
// pasa a producir los `newIds` (sigue resolviendo a entradas reales tras la corrección).
function remapProducedId(working, oldId, newIds) {
  const remapList = (list) => {
    if (!Array.isArray(list)) return list;
    const out = [];
    for (const id of list) {
      if (id === oldId) {
        for (const nid of newIds) if (!out.includes(nid)) out.push(nid);
      } else if (!out.includes(id)) {
        out.push(id);
      }
    }
    return out;
  };
  for (const s of working.section_ledger || []) s.produced_requirement_ids = remapList(s.produced_requirement_ids);
  for (const p of working.proposal_ledger || []) p.produced_requirement_ids = remapList(p.produced_requirement_ids);
}

// --- Regla 1: igualdad exacta de la cita ----------------------------------------------------
function ruleCitationQuoteEquality(working, corrections) {
  const sourceText = working.source_text_by_document_id;
  for (const entry of working.entries) {
    let offending = null;
    for (const c of entry.citations || []) {
      // Sólo DEGRADA: si se afirmaba resuelta pero el slice ya no coincide, se marca no resuelta.
      if (c.resolved === true && citationResolved(sourceText, c) === false) {
        c.resolved = false;
        offending = { kind: 'quote_mismatch', document_id: c.document_id, char_start: c.char_start, char_end: c.char_end };
      }
    }
    if (!offending) continue;
    const before = { analyzable: entry.analyzable, status: entry.status };
    if (entry.analyzable && !hasVigenteGrounding(entry)) demoteToUnresolved(entry);
    pushCorrection(corrections, entry.requirement_id, 'citation-quote-equality', before,
      { analyzable: entry.analyzable, status: entry.status }, offending);
  }
}

// --- Regla 2: vigencia / precedencia --------------------------------------------------------
function ruleVigenciaPrecedence(working, corrections) {
  for (const entry of working.entries) {
    const nonVigente = (entry.citations || []).filter((c) => c.is_vigente === false);
    if (nonVigente.length === 0) continue;
    const before = { citations: entry.citations.length, analyzable: entry.analyzable };
    entry.citations = entry.citations.filter((c) => c.is_vigente === true);
    if (entry.analyzable && !hasVigenteGrounding(entry)) demoteToUnresolved(entry);
    pushCorrection(corrections, entry.requirement_id, 'vigencia-precedence', before,
      { citations: entry.citations.length, analyzable: entry.analyzable },
      { kind: 'superseded_citation_removed', removed: nonVigente.map((c) => ({ document_id: c.document_id, precedence: c.precedence })) });
  }
}

// --- Regla 3: atomización -------------------------------------------------------------------
function ruleAtomization(working, corrections) {
  const nextEntries = [];
  for (const entry of working.entries) {
    if (!citationsDisjoint(entry.citations)) {
      nextEntries.push(entry);
      continue;
    }
    const ordered = [...entry.citations].sort(cmpCitation);
    const atomicIds = ordered.map((_, i) => `${entry.requirement_id}#a${i + 1}`);
    ordered.forEach((citation, i) => {
      const atomic = { ...deepClone(entry), requirement_id: atomicIds[i], citations: [deepClone(citation)] };
      atomic.analyzable = hasVigenteGrounding(atomic);
      atomic.status = atomic.analyzable ? 'analyzed_candidate'
        : (atomic.status === 'excluded_with_reason' ? 'excluded_with_reason' : 'unresolved_visible');
      if (!atomic.analyzable && atomic.status === 'unresolved_visible') atomic.human_review_required = true;
      nextEntries.push(atomic);
    });
    remapProducedId(working, entry.requirement_id, atomicIds);
    pushCorrection(corrections, entry.requirement_id, 'atomization',
      { citations: entry.citations.length }, { atomic_ids: atomicIds },
      { kind: 'disjoint_citations', count: entry.citations.length });
  }
  working.entries = nextEntries;
}

// --- Regla 4: duplicados --------------------------------------------------------------------
function citationStrength(entry) {
  return (entry.citations || []).filter((c) => c.is_vigente === true && c.resolved === true).length;
}

function ruleDuplicateCollapse(working, corrections) {
  const labelById = new Map((working.proposal_ledger || []).map((p) => [p.requirement_id, p.label]));
  const groups = new Map();
  for (const entry of working.entries) {
    if (entry.origin !== 'section_proposal') continue;
    const label = labelById.get(entry.requirement_id);
    if (label == null) continue;
    const key = `${entry.item_ref}||${normalizeLabel(label)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const dropped = new Set();
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    // Conserva la cita más fuerte (más citas vigentes resueltas; desempate por id ascendente).
    const kept = [...group].sort((a, b) => (
      citationStrength(b) - citationStrength(a)
      || (Number(b.analyzable) - Number(a.analyzable))
      || String(a.requirement_id).localeCompare(String(b.requirement_id))
    ))[0];
    for (const entry of group) {
      if (entry === kept) continue;
      dropped.add(entry.requirement_id);
      remapProducedId(working, entry.requirement_id, [kept.requirement_id]);
      pushCorrection(corrections, entry.requirement_id, 'duplicate-collapse',
        { item_ref: entry.item_ref }, { collapsed_into: kept.requirement_id },
        { kind: 'same_label_item_ref', key });
    }
  }
  if (dropped.size) working.entries = working.entries.filter((e) => !dropped.has(e.requirement_id));
}

// --- Regla 5: fase --------------------------------------------------------------------------
function rulePhaseReconciliation(working, corrections) {
  for (const s of working.section_ledger || []) {
    const leading = Number(String(s.item_ref).split('.')[0]);
    const expected = REGISTRO_FASE_POR_CAPITULO[leading];
    if (expected && s.fase !== expected) {
      const before = s.fase;
      s.fase = expected;
      pushCorrection(corrections, s.item_ref, 'phase-reconciliation', { fase: before }, { fase: expected },
        { kind: 'registro_fase_por_capitulo', capitulo: leading });
    }
  }
}

// --- Regla 6: materialidad ------------------------------------------------------------------
function ruleMaterialityDerivation(working, corrections) {
  for (const entry of working.entries) {
    if (entry.materiality !== 'material') continue;
    const basis = GOVERNED_MATERIAL_BASIS[entry.requirement_id];
    const justified = entry.origin === 'governed_runtime' && basis
      && AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES.includes(basis);
    if (justified) continue;
    const before = entry.materiality;
    entry.materiality = 'undetermined';
    pushCorrection(corrections, entry.requirement_id, 'materiality-derivation', { materiality: before },
      { materiality: 'undetermined' }, { kind: 'material_impediment_unclassified', catalog: 'AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES' });
  }
}

// --- Regla 7: subsanabilidad ----------------------------------------------------------------
function ruleSubsanabilityNormalization(working, corrections) {
  const kindById = new Map((working.proposal_ledger || []).map((p) => [p.requirement_id, p.requirement_kind]));
  for (const entry of working.entries) {
    if (entry.origin !== 'section_proposal') continue;
    const before = entry.subsanability;
    let changed = false;
    if (!AGT002_PROPOSAL_SUBSANABILITY.includes(entry.subsanability)) {
      entry.subsanability = 'no_determinada_requiere_humano';
      changed = true;
    }
    const kind = kindById.get(entry.requirement_id);
    const noCompanyEvidence = entry.evidence_class_id === null || entry.evidence_class_id === undefined;
    if (kind === 'regla_entidad' && noCompanyEvidence && entry.subsanability !== 'no_determinada_requiere_humano') {
      entry.subsanability = 'no_determinada_requiere_humano';
      changed = true;
    }
    if (changed) {
      pushCorrection(corrections, entry.requirement_id, 'subsanability-normalization', { subsanability: before },
        { subsanability: entry.subsanability }, { kind: 'proposal_subsanability_vocab', vocab: 'AGT002_PROPOSAL_SUBSANABILITY' });
    }
  }
}

// --- Regla 8: evidencia candidata -----------------------------------------------------------
function ruleCandidateEvidenceValidity(working, corrections) {
  for (const entry of working.entries) {
    if (entry.evidence_class_id === null || entry.evidence_class_id === undefined) continue;
    const before = entry.evidence_class_id;
    if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(entry.evidence_class_id)) {
      entry.evidence_class_id = null;
      pushCorrection(corrections, entry.requirement_id, 'candidate-evidence-validity', { evidence_class_id: before },
        { evidence_class_id: null }, { kind: 'evidence_class_outside_catalog' });
      continue;
    }
    // Vínculo débil: una clase nombrada en una propuesta sin ninguna cita vigente resuelta que la
    // fundamente (nombre coincidente, sin cita) => se anula, no se reemplaza por otra adivinada.
    if (entry.origin === 'section_proposal' && !(entry.citations || []).some((c) => c.is_vigente === true && c.resolved === true)) {
      entry.evidence_class_id = null;
      pushCorrection(corrections, entry.requirement_id, 'candidate-evidence-validity', { evidence_class_id: before },
        { evidence_class_id: null }, { kind: 'weak_link_no_resolved_citation' });
    }
  }
}

// --- Regla 9: asociaciones sospechosas ------------------------------------------------------
function ruleSuspiciousAssociation(working, corrections) {
  for (const entry of working.entries) {
    if (entry.evidence_class_id === null || entry.evidence_class_id === undefined) continue;
    const economicContext = entry.materiality === 'economic' || String(entry.item_ref ?? '').startsWith('3.6');
    if (economicContext && OPERATIONAL_LICENCE_CLASSES.has(entry.evidence_class_id)) {
      const before = entry.evidence_class_id;
      entry.evidence_class_id = null;
      entry.human_review_required = true;
      pushCorrection(corrections, entry.requirement_id, 'suspicious-association', { evidence_class_id: before },
        { evidence_class_id: null }, { kind: 'implausible_owner_pairing', context: 'economic_offer' });
    }
  }
}

// --- recomputación de campos derivados ------------------------------------------------------
function deriveDispositionFromProduced(producedIds, entriesById) {
  const produced = (producedIds || []).map((id) => entriesById.get(id)).filter(Boolean);
  if (produced.length > 0 && produced.every((e) => e.analyzable)) return 'analyzed_candidate';
  return 'unresolved_visible';
}

function tallyDispositions(ledger) {
  const by = { analyzed_candidate: 0, excluded_with_reason: 0, unresolved_visible: 0 };
  for (const item of ledger) by[item.disposition] += 1;
  return by;
}

// Recomputa disposiciones de libro y cobertura tras cambios (misma forma que el builder). Los
// escalares estables (68/20/10/4/3) se conservan de la cobertura de entrada.
function recomputeDerived(working) {
  const entriesById = new Map(working.entries.map((e) => [e.requirement_id, e]));
  for (const s of working.section_ledger || []) {
    if (s.disposition !== 'excluded_with_reason') s.disposition = deriveDispositionFromProduced(s.produced_requirement_ids, entriesById);
  }
  for (const p of working.proposal_ledger || []) {
    if (p.disposition !== 'excluded_with_reason') p.disposition = deriveDispositionFromProduced(p.produced_requirement_ids, entriesById);
  }
  const byCategory = {};
  const byOrigin = { governed_runtime: 0, section_proposal: 0, lifecycle_gate: 0 };
  for (const e of working.entries) {
    const key = e.category === null ? 'null' : e.category;
    byCategory[key] = (byCategory[key] || 0) + 1;
    if (byOrigin[e.origin] !== undefined) byOrigin[e.origin] += 1; else byOrigin[e.origin] = 1;
  }
  const cov = working.coverage;
  cov.section_ledger = { total: working.section_ledger.length, by_disposition: tallyDispositions(working.section_ledger) };
  cov.proposal_ledger = { total: working.proposal_ledger.length, by_disposition: tallyDispositions(working.proposal_ledger) };
  cov.entries = {
    total: working.entries.length,
    analyzable: working.entries.filter((e) => e.analyzable).length,
    unresolved_visible: working.entries.filter((e) => e.status === 'unresolved_visible').length,
    by_category: byCategory,
    by_origin: byOrigin,
  };
}

/**
 * Aplica la pasada de correcciones mecánicas al manifiesto integral.
 *
 * @param {object} manifest  Manifiesto ya construido por buildAgt002ManizalesIntegralManifest.
 * @returns {{ manifest: object, corrections: Array }}  Manifiesto corregido (copia) y el log de
 *   correcciones. Si no hay nada que corregir, el manifiesto se devuelve byte-idéntico y el log
 *   vacío.
 */
export function applyManizalesManifestCorrections(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('AGT-002 correcciones: el manifiesto debe ser un objeto.');
  }
  if (!Array.isArray(manifest.entries)) {
    throw new Error('AGT-002 correcciones: el manifiesto debe tener entries.');
  }
  const working = deepClone(manifest);
  const corrections = [];

  ruleCitationQuoteEquality(working, corrections);
  ruleVigenciaPrecedence(working, corrections);
  ruleAtomization(working, corrections);
  ruleDuplicateCollapse(working, corrections);
  rulePhaseReconciliation(working, corrections);
  ruleMaterialityDerivation(working, corrections);
  ruleSubsanabilityNormalization(working, corrections);
  ruleCandidateEvidenceValidity(working, corrections);
  ruleSuspiciousAssociation(working, corrections);

  if (corrections.length > 0) recomputeDerived(working);
  return { manifest: working, corrections };
}

/**
 * Construye el artefacto gobernado del log de correcciones (JSON persistible). Determinista dada la
 * misma entrada y marca ISO. Nunca promueve: sólo documenta degradaciones/abstenciones.
 */
export function buildManizalesManifestCorrectionsArtifact({ manifest, corrections, generatedAt } = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('AGT-002 correcciones: se requiere el manifiesto fuente.');
  }
  if (!Array.isArray(corrections)) {
    throw new Error('AGT-002 correcciones: se requiere el arreglo de correcciones.');
  }
  if (typeof generatedAt !== 'string' || !generatedAt.trim()) {
    throw new Error('AGT-002 correcciones: se requiere una marca ISO generatedAt.');
  }
  const by_rule = {};
  for (const rule of AGT002_MANIFEST_CORRECTION_RULES) by_rule[rule] = 0;
  for (const c of corrections) by_rule[c.rule] = (by_rule[c.rule] || 0) + 1;

  return {
    artifact_type: 'agt002_manizales_integral_manifest_corrections',
    contract_version: 'agt002-manizales-integral-manifest-corrections@1',
    status: 'validated_candidate',
    human_approval_required: true,
    human_approved: false,
    opportunity_id: manifest.opportunity_id,
    proceso: manifest.proceso,
    generated_at: generatedAt,
    source_manifest: {
      artifact_type: manifest.artifact_type,
      contract_version: manifest.contract_version,
      version: manifest.version,
      generated_at: manifest.generated_at,
    },
    summary: { total: corrections.length, by_rule },
    corrections,
    probative_limits: [
      'Correcciones mecánicas deterministas: sólo degradan o abstienen; nunca promueven analizabilidad, cumplimiento, suficiencia, puntaje, categoría gobernada ni aprobación.',
      'Cada corrección cita su base (cita/regla/taxonomía); no se inventan citas ni evidencia; una clase o cita dudosa se anula, no se reemplaza por una adivinada.',
      'Una segunda pasada sobre el artefacto corregido produce cero correcciones (idempotente) y un manifiesto byte-idéntico.',
    ],
  };
}

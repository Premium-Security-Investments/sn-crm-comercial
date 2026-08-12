// Reconciliación PRODUCTIVA, estrictamente READ-ONLY y METADATA-ONLY, del bloque LOCAL de
// análisis pre-GO gobernado de Rama Judicial Manizales SA-24-2026.
//
// Diferencia con el generador OFFLINE (scripts/agt002-manizales-pre-go-analysis-generate.mjs):
//   - El generador offline NO accede a red/DB/secretos: alimenta evidenceClasses: [] y deja la
//     verificación jurídica gated (corpus local ausente). Su artefacto es byte-reproducible.
//   - Este script SÍ consulta producción (Supabase service_role, SOLO lectura) para observar
//     las 17 clases de evidencia empresarial reales y la versión de corpus jurídico publicada,
//     y las cruza con el MISMO módulo puro (buildAgt002PreGoAnalysis). Su salida depende del
//     estado de producción en el instante de la corrida (point-in-time), por eso NO es
//     byte-reproducible y NO reemplaza al artefacto offline.
//
// DECISIÓN DE FORMA MÁS SEGURA (requisito 8): este script produce un ARTEFACTO SEPARADO
// (docs/governance/analisis/manizales-sa-24-2026.pre-go-production-reconcile.{json,md}) y NUNCA
// toca el generador offline ni sus salidas. Además, el artefacto persistido es SÓLO el RESUMEN
// SANITARIO metadata-only (estados/IDs cerrados, referencias opacas, versión/id/hash/#fuentes
// del corpus jurídico) — jamás el artefacto pre-GO completo de 68 crossings ni contenido
// jurídico. El artefacto pre-GO completo se construye y valida en memoria pero no se persiste,
// minimizando la superficie de exposición. Así el offline sigue reproducible y la reconciliación
// productiva queda con provenance explícita y honesta, sin filtrar producción a disco.
//
// Reglas duras (verificadas por tests estáticos):
//   - PROHIBIDO insert/update/upsert/delete/rpc/storage: el cliente se envuelve en un guardián
//     read-only que lanza si se invoca cualquier verbo de escritura, y sólo se pasa a los dos
//     loaders allowlisted (loadAgt002CompanyEvidenceRegistryEntries / loadPublishedAgt002LegalCorpus).
//   - Se exige la lista cerrada de 17 clases (current, IDs únicos, dentro del catálogo).
//   - La verificación jurídica se muestra SÓLO por versión publicada validada, nunca contenido.
//   - La salida abierta pasa por assertNoOpenPii + assertSanitaryReconcileMetadataOnly antes de
//     escribir; el env se carga sin imprimir secretos.
//
// Uso (manual, requiere credenciales reales de SOLO lectura, nunca versionadas):
//   node scripts/agt002-manizales-pre-go-production-reconcile.mjs --env-file /ruta/.env.local
//   node scripts/agt002-manizales-pre-go-production-reconcile.mjs --env-file /ruta/.env.local --write

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import {
  buildAgt002PreGoAnalysis,
  validateAgt002PreGoAnalysis,
  AGT002_PRE_GO_CROSS_STATES,
} from '../agt002-pre-go-analysis.js';
import {
  buildAgt002CompanyEvidenceClasses,
  loadAgt002CompanyEvidenceRegistryEntries,
  AGT002_COMPANY_EVIDENCE_CLASS_IDS,
  AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES,
  AGT002_COMPANY_EVIDENCE_REVIEW_STATUSES,
  AGT002_COMPANY_EVIDENCE_VALIDITY_STATUSES,
  AGT002_COMPANY_EVIDENCE_APPLICABILITY_STATUSES,
  AGT002_COMPANY_EVIDENCE_COVERAGE_CATEGORIES,
} from '../agt002-company-evidence-classes.js';
import { loadPublishedAgt002LegalCorpus } from '../agt002-legal-corpus-store.js';
import {
  buildAgt002PreGoSectionProposals,
  buildAgt002SectionProposalOverlayIndex,
  validateAgt002PreGoSectionProposals,
} from '../agt002-pre-go-section-proposals.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_JSON = resolve(PROJECT_ROOT, 'docs/governance/registro/manizales-sa-24-2026.registry.json');
const GOVERNANCE_DRAFT_JSON = resolve(PROJECT_ROOT, 'docs/governance/drafts/agt002-rama-judicial-54190e51-15fb-46af-b0aa-8f13461a3110.v1.json');
const OUTPUT_JSON = resolve(PROJECT_ROOT, 'docs/governance/analisis/manizales-sa-24-2026.pre-go-production-reconcile.json');
const OUTPUT_MD = resolve(PROJECT_ROOT, 'docs/governance/analisis/2026-08-12-manizales-pre-go-production-reconcile.md');

export const AGT002_PRE_GO_RECONCILE_ARTIFACT_TYPE = 'agt002_pre_go_production_reconcile';
export const AGT002_PRE_GO_RECONCILE_CONTRACT_VERSION = 'agt002-pre-go-production-reconcile@1';
export const AGT002_EXPECTED_EVIDENCE_CLASS_COUNT = 17;

// --- Guardián de cliente estrictamente READ-ONLY ------------------------------------------
// Defensa en profundidad: además de que este script NUNCA llama un verbo de escritura, el
// cliente se envuelve en un Proxy que lanza si se invoca insert/update/upsert/delete/rpc/
// storage/functions/schema, tanto a nivel de cliente como del query builder de cada .from().
const FORBIDDEN_DB_METHODS = Object.freeze(['insert', 'update', 'upsert', 'delete', 'rpc', 'storage', 'functions', 'schema']);

function forbiddenThrow(method) {
  return () => {
    throw new Error(`AGT-002 reconcile: cliente READ-ONLY; el método de escritura "${method}" está prohibido en la reconciliación productiva.`);
  };
}

function guardBuilder(builder) {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && FORBIDDEN_DB_METHODS.includes(prop)) return forbiddenThrow(prop);
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return value.bind(target);
      return (...args) => {
        const result = value.apply(target, args);
        if (result && (typeof result === 'object' || typeof result === 'function')) {
          return guardBuilder(result);
        }
        return result;
      };
    },
  });
}

export function createReadOnlyClientGuard(client) {
  if (!client || typeof client.from !== 'function') throw new Error('AGT-002 reconcile: se requiere un cliente con .from().');
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && FORBIDDEN_DB_METHODS.includes(prop)) return forbiddenThrow(prop);
      if (prop === 'from') return (table) => guardBuilder(target.from(table));
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// --- Carga de env SIN imprimir secretos ---------------------------------------------------
export function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue;
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

export function parseArgs(argv) {
  const options = { envPath: null, write: false, generatedAt: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--env-file') options.envPath = resolve(argv[++index] || '');
    else if (token === '--write') options.write = true;
    else if (token === '--generated-at') options.generatedAt = argv[++index] || null;
    else throw new Error(`AGT-002 reconcile: argumento no soportado: ${token}`);
  }
  return options;
}

// --- Enlace gobernado local (mismo insumo curado que el generador offline) -----------------
export function loadGovernedLinks(draftPath = GOVERNANCE_DRAFT_JSON) {
  const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
  const evidenceClassLinkByRequirementId = {};
  for (const proposal of draft.evidence_class_link_proposals || []) {
    if (proposal?.requirement_id && proposal?.evidence_class_id) {
      evidenceClassLinkByRequirementId[proposal.requirement_id] = proposal.evidence_class_id;
    }
  }
  const habilitatingGovernedRequirementIds = (draft.category_override_proposals || [])
    .filter(p => p?.category_value === 'habilitating' && p?.requirement_id)
    .map(p => p.requirement_id);
  return { evidenceClassLinkByRequirementId, habilitatingGovernedRequirementIds, draftVersion: draft.version || null };
}

// --- Exigencia de las 17 clases cerradas, current, IDs únicos ------------------------------
export function assertExactClosedCurrentClasses(registryEntries) {
  if (!Array.isArray(registryEntries)) throw new Error('AGT-002 reconcile: registryEntries debe ser un arreglo.');
  if (registryEntries.length !== AGT002_EXPECTED_EVIDENCE_CLASS_COUNT) {
    throw new Error(`AGT-002 reconcile: se esperaban exactamente ${AGT002_EXPECTED_EVIDENCE_CLASS_COUNT} clases current; se observaron ${registryEntries.length}.`);
  }
  const ids = registryEntries.map(entry => (typeof entry?.entry_id === 'string' ? entry.entry_id.trim() : ''));
  if (ids.some(id => !id)) throw new Error('AGT-002 reconcile: toda fila debe tener entry_id no vacío.');
  if (new Set(ids).size !== ids.length) throw new Error('AGT-002 reconcile: hay entry_id duplicados entre las clases observadas.');
  const outside = ids.filter(id => !AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(id));
  if (outside.length) throw new Error(`AGT-002 reconcile: entry_id fuera del catálogo cerrado de 17 clases: ${outside.join(', ')}.`);
  // Con 17 IDs únicos, todos dentro del catálogo cerrado de 17, el conjunto observado ES el
  // catálogo completo: por ello cada clase enlazada por el borrador queda garantizada observada.
  return [...ids].sort();
}

function tally(values, domain) {
  const counts = Object.fromEntries(domain.map(key => [key, 0]));
  for (const value of values) if (value in counts) counts[value] += 1;
  return counts;
}

// --- Resumen SANITARIO metadata-only -------------------------------------------------------
export function buildSanitaryReconcileSummary({
  artifact, classes, coverage, entryIds, legalCorpus, generatedAt, draftVersion, sectionProposals,
}) {
  const cov = artifact.coverage;
  const relevantCrossings = artifact.crossings.filter(c => c.pre_go_relevant);
  const unmappedOfferSections = relevantCrossings
    .filter(c => c.cross_state === 'unverifiable' && (c.governed_requirement_ids || []).length === 0 && !c.proposal_overlay)
    .map(c => c.item_ref).sort();
  const proposedOfferSections = relevantCrossings
    .filter(c => c.cross_state === 'unverifiable' && c.proposal_overlay)
    .map(c => c.item_ref).sort();
  const cctvAbstentionRefs = artifact.crossings
    .filter(c => (c.governed_evidence || []).some(g => g.rule_id === 'no_governed_evidence_class_link'))
    .map(c => c.item_ref).sort();
  const vaultBlockerPresent = artifact.blockers.some(b => b.id === 'evidencia_empresarial_no_observable_localmente');

  return {
    artifact_type: AGT002_PRE_GO_RECONCILE_ARTIFACT_TYPE,
    contract_version: AGT002_PRE_GO_RECONCILE_CONTRACT_VERSION,
    status: artifact.status,
    human_approval_required: true,
    read_only: true,
    metadata_only: true,
    source: 'production_read_only',
    generated_at: generatedAt,
    governed_draft_version: draftVersion,
    opportunity_id: artifact.opportunity_id,
    proceso: artifact.proceso,
    entidad: artifact.entidad,
    registry_evidence: {
      entries_observed: classes.length,
      expected: AGT002_EXPECTED_EVIDENCE_CLASS_COUNT,
      unique_ids: true,
      all_within_closed_catalog: true,
      entry_ids: entryIds,
      presence_breakdown: tally(classes.map(c => c.presence_status), AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES),
      review_breakdown: tally(classes.map(c => c.review_status), AGT002_COMPANY_EVIDENCE_REVIEW_STATUSES),
      validity_breakdown: tally(classes.map(c => c.validity_status), AGT002_COMPANY_EVIDENCE_VALIDITY_STATUSES),
      applicability_breakdown: tally(classes.map(c => c.applicability_status), AGT002_COMPANY_EVIDENCE_APPLICABILITY_STATUSES),
      coverage_counts: Object.fromEntries(AGT002_COMPANY_EVIDENCE_COVERAGE_CATEGORIES.map(key => [key, (coverage[key] || []).length])),
    },
    legal_verification: {
      shown: artifact.legal_verification.shown === true,
      corpus_version: legalCorpus.corpus_version,
      legal_corpus_version_id: legalCorpus.legal_corpus_version_id,
      content_sha256: legalCorpus.content_sha256,
      source_count: legalCorpus.corpus.sources.length,
      note: 'Versión publicada validada (hash verificado contra fuentes). No se afirma verificación jurídica sustantiva ni suficiencia: siguen siendo decisión humana.',
    },
    cross_matrix: {
      total_secciones: cov.total_secciones,
      secciones_relevantes_pre_go: cov.secciones_relevantes_pre_go,
      secciones_no_aplicables_pre_go: cov.secciones_no_aplicables_pre_go,
      por_estado: cov.por_estado,
    },
    section_proposal_overlay: {
      applied: artifact.section_proposal_overlay.applied === true,
      status: sectionProposals.status,
      human_approval_required: true,
      is_approved: false,
      affected_item_refs: proposedOfferSections,
      requirement_count: sectionProposals.coverage.requirements,
      with_candidate_evidence_class: sectionProposals.coverage.with_candidate_evidence_class,
      without_candidate_evidence_class: sectionProposals.coverage.without_candidate_evidence_class,
      note: 'Overlay LOCAL de propuestas curadas. Las clases son candidatas, no enlaces aprobados; ninguna propuesta afirma cumplimiento, suficiencia o puntaje.',
    },
    blockers: artifact.blockers.map(b => ({ id: b.id, class: b.class, affected_count: b.affected_item_refs.length })),
    honest_replacement: {
      vault_not_observable_blocker_present: vaultBlockerPresent,
      sections_human_review_required: cov.por_estado.human_review_required,
      sections_unverifiable: cov.por_estado.unverifiable,
      sections_satisfied_candidate: cov.por_estado.satisfied_candidate,
      sections_missing: cov.por_estado.missing,
      sections_stale: cov.por_estado.stale,
      unmapped_offer_sections: unmappedOfferSections,
      proposed_offer_sections: proposedOfferSections,
      cctv_abstention_refs: cctvAbstentionRefs,
      note: 'Las 17 clases están reported (no verified) con revisión humana y aplicabilidad de caso pendientes: por diseño quedan human_review_required, nunca satisfied/missing/cumplido. Las clases sin hash figuran como inaccessible/pending y las vigencias sin fecha como unknown, sin promoverse.',
    },
    recommendation: {
      recommendation_candidate: artifact.recommendation.recommendation_candidate,
      confidence: artifact.recommendation.confidence,
      human_go_no_go_required: true,
    },
    probative_note: 'Reconciliación estructural point-in-time contra producción (solo lectura). No decide cumplimiento, habilitación, puntaje ni GO/NO-GO: son compuertas humanas.',
  };
}

// --- Guarda de salida abierta: SÓLO metadata sanitaria -------------------------------------
// Prohíbe claves y subcadenas que revelarían source_reference de SharePoint, contenido
// jurídico, PII, credenciales o rutas de secreto. Complementa assertNoOpenPii.
const FORBIDDEN_METADATA_KEYS = Object.freeze([
  'source_reference', 'current_text', 'official_url', 'issuing_authority', 'published_by',
  'notes', 'excerpt', 'cite', 'apikey', 'authorization', 'service_role_key', 'password', 'secret',
]);
const FORBIDDEN_METADATA_SUBSTRINGS = Object.freeze([
  'sharepoint', '://', '.env', 'service_role', 'bearer ', 'apikey', 'x-api-key',
  '/root/', 'c:\\', 'begin private key', 'eyj',
]);
const MAX_SANITARY_STRING_LENGTH = 480;

export function assertSanitaryReconcileMetadataOnly(node, path = '') {
  if (typeof node === 'string') {
    const lower = node.toLowerCase();
    for (const needle of FORBIDDEN_METADATA_SUBSTRINGS) {
      if (lower.includes(needle)) {
        throw new Error(`AGT-002 reconcile: subcadena prohibida "${needle}" en salida sanitaria (${path || '(root)'}).`);
      }
    }
    if (node.length > MAX_SANITARY_STRING_LENGTH) {
      throw new Error(`AGT-002 reconcile: cadena demasiado larga en ${path || '(root)'} (${node.length}); la salida es metadata-only, no contenido.`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertSanitaryReconcileMetadataOnly(item, `${path}[${index}]`));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_METADATA_KEYS.includes(key.toLowerCase())) {
        throw new Error(`AGT-002 reconcile: clave prohibida "${key}" en salida sanitaria (${path || '(root)'}).`);
      }
      assertSanitaryReconcileMetadataOnly(child, path ? `${path}.${key}` : key);
    }
  }
}

// --- Orquestación read-only (recibe un cliente; testeable con cliente fake) -----------------
export async function runProductionReconcile({
  database, generatedAt, registryPath = REGISTRY_JSON, draftPath = GOVERNANCE_DRAFT_JSON, asOf,
}) {
  const guarded = createReadOnlyClientGuard(database);
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const { evidenceClassLinkByRequirementId, habilitatingGovernedRequirementIds, draftVersion } = loadGovernedLinks(draftPath);

  // Solo lectura, select allowlisted (eq current=true) — nunca select('*').
  const registryEntries = await loadAgt002CompanyEvidenceRegistryEntries(guarded);
  const entryIds = assertExactClosedCurrentClasses(registryEntries);
  const { classes, coverage } = buildAgt002CompanyEvidenceClasses({
    registryEntries, asOf: asOf instanceof Date ? asOf : new Date(generatedAt),
  });

  // Corpus jurídico publicado: sólo la VERSIÓN validada (hash verificado); nunca su contenido.
  const legalCorpus = await loadPublishedAgt002LegalCorpus(guarded);

  // Overlay LOCAL de propuestas curadas: se valida en memoria y sólo se proyectan conteos/refs
  // sanitarios. No es un requirement_manifest aprobado ni cambia estados de cumplimiento.
  const sectionProposals = buildAgt002PreGoSectionProposals({ registry, generatedAt });
  validateAgt002PreGoSectionProposals(sectionProposals);
  const sectionProposalOverlay = buildAgt002SectionProposalOverlayIndex(sectionProposals);

  const artifact = buildAgt002PreGoAnalysis({
    registry,
    evidenceClasses: classes,
    evidenceClassLinkByRequirementId,
    habilitatingGovernedRequirementIds,
    legalCorpusVersion: legalCorpus.corpus_version,
    generatedAt,
    sectionProposalOverlay,
  });
  validateAgt002PreGoAnalysis(artifact);

  // Invariantes honestos derivados de los datos observados (no fixtures): con clases reales,
  // el blocker de bóveda no-observable desaparece; sin ninguna clase promovible, nada satisfied.
  if (artifact.blockers.some(b => b.id === 'evidencia_empresarial_no_observable_localmente')) {
    throw new Error('AGT-002 reconcile: se observaron clases reales pero persiste el blocker de bóveda no-observable; el cruce es inconsistente.');
  }
  const anyPromotable = classes.some(c => c.applicability_status === 'applicable'
    && (c.review_status === 'approved' || c.review_status === 'rejected') && c.validity_status === 'current');
  if (!anyPromotable && artifact.coverage.por_estado.satisfied_candidate > 0) {
    throw new Error('AGT-002 reconcile: ninguna clase es aplicable+revisada+vigente, pero hay secciones satisfied_candidate; presencia habría promovido indebidamente.');
  }
  const anyAbsent = classes.some(c => c.presence_status === 'not_verified');
  if (!anyAbsent && artifact.coverage.por_estado.missing > 0) {
    throw new Error('AGT-002 reconcile: ninguna clase está ausente, pero hay secciones missing; ausencia de señal se confundió con documento ausente.');
  }

  const summary = buildSanitaryReconcileSummary({
    artifact, classes, coverage, entryIds, legalCorpus, generatedAt, draftVersion, sectionProposals,
  });
  assertNoOpenPii(summary);
  assertSanitaryReconcileMetadataOnly(summary);
  return { summary };
}

export function renderMarkdown(summary) {
  const re = summary.registry_evidence;
  const lv = summary.legal_verification;
  const cm = summary.cross_matrix;
  const hr = summary.honest_replacement;
  const lines = [];
  lines.push('# Reconciliación pre-GO PRODUCTIVA (read-only, metadata-only) — Rama Judicial Manizales SA-24-2026');
  lines.push('');
  lines.push(`> Artefacto sanitario: \`docs/governance/analisis/manizales-sa-24-2026.pre-go-production-reconcile.json\`.`);
  lines.push('> Estado: **draft_for_human_review**, `human_approval_required: true`. Point-in-time contra producción');
  lines.push(`> (solo lectura). Generado: ${summary.generated_at}. Enlace gobernado local v${summary.governed_draft_version}.`);
  lines.push('');
  lines.push('Este bloque **no reemplaza** al generador offline (que sigue reproducible). Consulta las 17 clases de');
  lines.push('evidencia empresarial reales y la versión de corpus jurídico publicada, y las cruza con el mismo módulo puro.');
  lines.push('**No decide cumplimiento, habilitación, puntaje ni GO/NO-GO**: son compuertas humanas.');
  lines.push('');
  lines.push('## Evidencia empresarial (17 clases cerradas, current)');
  lines.push('');
  lines.push(`- Clases observadas: **${re.entries_observed}/${re.expected}**, IDs únicos dentro del catálogo cerrado.`);
  lines.push(`- Presencia: ${JSON.stringify(re.presence_breakdown)}.`);
  lines.push(`- Revisión humana: ${JSON.stringify(re.review_breakdown)}.`);
  lines.push(`- Vigencia: ${JSON.stringify(re.validity_breakdown)} (sin fecha ⇒ unknown, sin promover).`);
  lines.push(`- Aplicabilidad: ${JSON.stringify(re.applicability_breakdown)}.`);
  lines.push(`- Cobertura (conteos): ${JSON.stringify(re.coverage_counts)} — \`inaccessible\` incluye clases sin hash accesible.`);
  lines.push('');
  lines.push('## Verificación jurídica (sólo versión publicada validada)');
  lines.push('');
  lines.push(`- Mostrada: **${lv.shown}** — versión \`${lv.corpus_version}\`, id \`${lv.legal_corpus_version_id}\`.`);
  lines.push(`- Hash de contenido: \`${lv.content_sha256}\` · fuentes: **${lv.source_count}**.`);
  lines.push(`- ${lv.note}`);
  lines.push('');
  lines.push('## Matriz de cruce (cobertura estructural, no exhaustividad humana)');
  lines.push('');
  lines.push('| Estado de cruce | Secciones |');
  lines.push('|---|---|');
  for (const state of AGT002_PRE_GO_CROSS_STATES) lines.push(`| ${state} | ${cm.por_estado[state]} |`);
  lines.push(`| **Total** | **${cm.total_secciones}** |`);
  lines.push('');
  lines.push(`- Relevantes pre-GO: **${cm.secciones_relevantes_pre_go}**; no aplicables pre-GO: **${cm.secciones_no_aplicables_pre_go}**.`);
  lines.push('');
  lines.push('## Overlay local de propuestas curadas (no aprobado)');
  lines.push('');
  lines.push(`- Aplicado: **${summary.section_proposal_overlay.applied}** · estado: \`${summary.section_proposal_overlay.status}\` · aprobado: **${summary.section_proposal_overlay.is_approved}**.`);
  lines.push(`- Secciones: **${summary.section_proposal_overlay.affected_item_refs.length}** · requisitos propuestos: **${summary.section_proposal_overlay.requirement_count}**.`);
  lines.push(`- Con clase empresarial candidata: **${summary.section_proposal_overlay.with_candidate_evidence_class}**; sin clase: **${summary.section_proposal_overlay.without_candidate_evidence_class}**.`);
  lines.push(`- ${summary.section_proposal_overlay.note}`);
  lines.push('');
  lines.push('## Reemplazo honesto (clases reales vs. bóveda no observable)');
  lines.push('');
  lines.push(`- Blocker "bóveda no observable localmente" presente: **${hr.vault_not_observable_blocker_present}** (desaparece con clases reales).`);
  lines.push(`- Secciones human_review_required: **${hr.sections_human_review_required}**; unverifiable: **${hr.sections_unverifiable}**.`);
  lines.push(`- satisfied_candidate: **${hr.sections_satisfied_candidate}**; missing: **${hr.sections_missing}**; stale: **${hr.sections_stale}** (nada promovido).`);
  lines.push(`- Secciones de oferta sin mapeo gobernado: ${hr.unmapped_offer_sections.length ? hr.unmapped_offer_sections.join(', ') : '(ninguna)'}.`);
  lines.push(`- CCTV/videovigilancia en abstención: ${hr.cctv_abstention_refs.length ? hr.cctv_abstention_refs.join(', ') : '(ninguna)'}.`);
  lines.push(`- ${hr.note}`);
  lines.push('');
  lines.push('## Bloqueadores (metadata)');
  lines.push('');
  if (summary.blockers.length === 0) {
    lines.push('- (sin bloqueadores)');
  } else {
    for (const b of summary.blockers) lines.push(`- **[${b.class}] ${b.id}** — secciones afectadas: ${b.affected_count}.`);
  }
  lines.push('');
  lines.push('## Recomendación (SÓLO candidata — GO/NO-GO humano obligatorio)');
  lines.push('');
  lines.push(`- **recommendation_candidate: ${summary.recommendation.recommendation_candidate}** (confianza: ${summary.recommendation.confidence}).`);
  lines.push(`- ${summary.probative_note}`);
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile(options.envPath);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (solo lectura, service_role).');
  }
  const database = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const generatedAt = options.generatedAt || new Date().toISOString();

  const { summary } = await runProductionReconcile({ database, generatedAt });

  if (options.write) {
    const markdown = renderMarkdown(summary);
    mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
    writeFileSync(OUTPUT_JSON, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    writeFileSync(OUTPUT_MD, `${markdown}\n`, 'utf8');
  }

  // Sólo metadata sanitaria a stdout (nunca secretos ni contenido).
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (options.write) process.stdout.write(`-> ${OUTPUT_JSON}\n-> ${OUTPUT_MD}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Sólo el mensaje (primera línea), nunca el stack ni variables de entorno.
    process.stderr.write(`agt002-manizales-pre-go-production-reconcile falló: ${String(error?.message || error).split(/\r?\n/, 1)[0]}\n`);
    process.exitCode = 1;
  });
}

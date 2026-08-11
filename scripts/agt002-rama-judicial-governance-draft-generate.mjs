// Read-only, reproducible generator for the AGT-002 governance DRAFT proposal
// (docs/governance/drafts/agt002-rama-judicial-54190e51-...v1.json) for the Rama
// Judicial opportunity. Every Supabase call in this script is a GET/select — it never
// inserts, updates, deletes, or calls a model/canary. It is a manual, human-run utility
// (never wired into server/index.js, api/[...path].js, or any migration/seed path — see
// tests/agt002-governance-draft-proposal-runtime-isolation-static.test.mjs).
//
// Chunk reconstruction: this script no longer treats psi_tender_document_chunks as the
// source of document text. It reads extracted_text directly from the 17 current
// psi_tender_document_versions rows (the same column the real production chunking phase
// reads — server/index.js's chunkDocuments) and rebuilds chunks LOCALLY and
// deterministically via the exact same pure, closed contract
// (buildAgt002DocumentChunks, agt002-document-chunks.js) that production uses — never a
// private reimplementation. This closes the coverage gap from v1 of this script, which
// could only extract from the 3/17 documents that happened to already have persisted,
// current=true chunk rows (the append-only chunking pipeline was never re-run against the
// canonical snapshot). The local reconstruction is cross-checked against whatever DB chunk
// rows do exist, by exact chunk_id/content_hash/chunk_hash equality, before being trusted.
//
// The mechanical steps below (chunk reconstruction, deterministic requirement extraction,
// requirement manifest, chunk-level citation search) are pure and reusable. The
// CATEGORY_OVERRIDE_PROPOSALS / EVIDENCE_CLASS_LINK_PROPOSALS / ABSTENTIONS tables further
// down are curated judgment — a human-equivalent reading of the real pliego clauses
// performed during the authoring session, cited by exact section — never a
// keyword/presence heuristic. A human reviewer must confirm or replace them before any
// real curated row is authored in migration/curation (psi_agt002_integral_governance_
// overrides grants no write path to any role — see migration 064).
//
// IMPORTANT — extractor scope, not semantic coverage: tender-requirement-extraction.js is
// a closed classifier. For this governed opportunity's legal front, it now recognizes two
// closed, context-distinguished requirement_id (legal-rce-policy, legal-collective-life-
// policy — HR-003, docs/governance/2026-08-11-agt002-rama-judicial-human-review.md),
// replacing the generic legal-guarantee-policy this script used through draft version 2.
// The legacy generic legal-guarantee-policy path (extractLegalRequirements/
// buildRequirementAnalysis) is untouched and still used by the v2 product-wide rule-based
// preanalysis (tender-deep-analysis.js, server/index.js) — this script never called that
// v2 path for its legal front from version 3 onward; it now calls the dedicated governed
// entry point (buildGovernedRequirementAnalysis) instead. Together with
// financial-working-capital and technical-video-surveillance-scope (unchanged), this
// script recognizes exactly four fixed requirement_id, regardless of how many documents
// feed it. Running this script against 17/17 documents instead of 3/17 expands the
// *evidence* available to those four requirements (more citations, better-grounded
// proposals/abstentions); it does NOT and cannot discover new requirement_ids — that would
// require a different, human-authored extraction pass over the full pliego, out of scope
// for this script. See the `extractor_scope_is_not_full_pliego_coverage` data gap emitted
// below.
//
// Usage (manual, requires real Supabase read credentials — never committed):
//   ENV_FILE=/path/to/.env.local node scripts/agt002-rama-judicial-governance-draft-generate.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { buildGovernedRequirementAnalysis, AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS } from '../tender-requirement-extraction.js';
import { buildAgt002RequirementManifest } from '../agt002-deep-analysis-matrix.js';
import { buildAgt002GovernanceDraftProposal } from '../agt002-governance-draft-proposal.js';
import { buildAgt002DocumentChunks } from '../agt002-document-chunks.js';
import { loadAgt002CompanyEvidenceRegistryEntries, AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPPORTUNITY_ID = '54190e51-15fb-46af-b0aa-8f13461a3110';
const SNAPSHOT_ID = 'c33159a5-defe-4a6f-8fa4-68c5ceb60e59';
const DRAFT_VERSION = 3;
const OUTPUT_PATH = resolve(ROOT, 'docs/governance/drafts/agt002-rama-judicial-54190e51-15fb-46af-b0aa-8f13461a3110.v1.json');

// Imported directly from tender-requirement-extraction.js (never a private, driftable
// duplicate) — used here only to locate which real chunks a requirement's evidence could
// plausibly come from (a citation aid), never to redecide the requirement's own
// status/values.
const REQUIREMENT_CITATION_PATTERNS = AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS;
const DIACRITIC_MARKS = /[̀-ͯ]/g;
function searchNormalize(value) { return value.toLowerCase().normalize('NFD').replace(DIACRITIC_MARKS, ''); }

function loadEnvFile(path) {
  let source = '';
  try { source = readFileSync(path, 'utf8'); } catch { return; }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

// Audit-only read of whatever chunk rows already exist for this opportunity — used solely
// to cross-check (reconcile) the local pure reconstruction below, never as the source of
// document text.
async function fetchExistingChunks(database, opportunityId) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await database
      .from('psi_tender_document_chunks')
      .select('chunk_id,document_version_id,content_hash,chunk_hash,snapshot_id,current')
      .eq('opportunity_id', opportunityId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

// Reconciles the locally-rebuilt chunk set against whatever chunk rows the real,
// production append-only pipeline already persisted for this opportunity — by exact ID
// equality (chunk_id), never by count. Any current=true DB row whose chunk_id also exists
// in the local reconstruction must match byte-for-byte on content_hash/chunk_hash; any
// mismatch means the local pure reimplementation has drifted from production and must not
// be trusted. Returns the distinct real snapshot_id(s) actually observed for the matched
// (reconciled) chunk_ids, for evidence_chunk_snapshot_ids.
function reconcileLocalChunksAgainstDb(localChunks, existingDbChunks) {
  const dbByChunkId = new Map(existingDbChunks.filter(row => row.current === true).map(row => [row.chunk_id, row]));
  const reconciledSnapshotIds = new Set();
  const mismatches = [];
  let matchedCount = 0;
  for (const local of localChunks) {
    const dbRow = dbByChunkId.get(local.chunk_id);
    if (!dbRow) continue;
    matchedCount += 1;
    if (dbRow.content_hash !== local.content_hash || dbRow.chunk_hash !== local.chunk_hash) {
      mismatches.push({ chunk_id: local.chunk_id, local: { content_hash: local.content_hash, chunk_hash: local.chunk_hash }, db: { content_hash: dbRow.content_hash, chunk_hash: dbRow.chunk_hash } });
      continue;
    }
    if (typeof dbRow.snapshot_id === 'string' && dbRow.snapshot_id) reconciledSnapshotIds.add(dbRow.snapshot_id);
  }
  if (mismatches.length) {
    throw new Error(
      `Reconciliación fallida: ${mismatches.length} chunk_id coinciden entre la reconstrucción local y `
      + `psi_tender_document_chunks pero difieren en content_hash/chunk_hash (la reimplementación local `
      + `se desvió del pipeline real): ${JSON.stringify(mismatches.slice(0, 5))}`,
    );
  }
  return { matchedCount, reconciledSnapshotIds };
}

// --- Curated judgment (this authoring session; not a keyword/presence heuristic) -------

const CATEGORY_OVERRIDE_PROPOSALS = [
  {
    requirement_id: 'financial-working-capital',
    category_value: 'habilitating',
    rationale: 'El pliego evalúa el índice de Capital de Trabajo dentro de "2.2 CAPACIDAD FINANCIERA", subsección explícita del Capítulo II "REQUISITOS HABILITANTES".',
    source_reference: 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II §2.2, secciones 408-410.',
    caveat: null,
  },
  {
    requirement_id: 'legal-rce-policy',
    category_value: 'habilitating',
    rationale: 'HR-003 (docs/governance/2026-08-11-agt002-rama-judicial-human-review.md): la póliza de responsabilidad civil extracontractual (ítem 17) está numerada dentro del Capítulo II "REQUISITOS HABILITANTES" del pliego. Extraída ahora por contexto real (frase "responsabilidad civil extracontractual"), no por el patrón genérico "polizas?" usado hasta la versión 2 de este borrador.',
    source_reference: 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 350-355.',
    caveat: 'Las garantías posteriores de ejecución del contrato (sección 110, cronograma, posteriores a la adjudicación) quedan expresamente excluidas de esta clasificación (HR-002/HR-003) y se excluyen estructuralmente en la extracción (tender-requirement-extraction.js, exclusión por contexto de ejecución/adjudicación posterior), no solo documentadas como advertencia.',
  },
  {
    requirement_id: 'legal-collective-life-policy',
    category_value: 'habilitating',
    rationale: 'HR-003: la póliza de seguro de vida colectivo (ítem 18) está numerada dentro del Capítulo II "REQUISITOS HABILITANTES" del pliego. Extraída ahora por contexto real (frase "vida colectiv[oa]"), no por el patrón genérico "polizas?" usado hasta la versión 2 de este borrador.',
    source_reference: 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 356-360.',
    caveat: 'Las garantías posteriores de ejecución del contrato (sección 110, cronograma, posteriores a la adjudicación) quedan expresamente excluidas de esta clasificación (HR-002/HR-003) y se excluyen estructuralmente en la extracción, no solo documentadas como advertencia.',
  },
];

const EVIDENCE_CLASS_LINK_PROPOSALS = [
  {
    requirement_id: 'financial-working-capital',
    evidence_class_id: 'rup',
    rationale: 'El pliego basa expresamente la evaluación de los requisitos financieros en el Registro Único de Proponentes.',
    source_reference: 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), sección 409.',
  },
  {
    requirement_id: 'legal-rce-policy',
    evidence_class_id: 'rce_policy',
    rationale: 'HR-003: enlace directo, sin ambigüedad, entre el requisito ya subdividido por contexto real y la clase cerrada de póliza de responsabilidad civil extracontractual del catálogo de 17 clases empresariales.',
    source_reference: 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 350-355.',
  },
  {
    requirement_id: 'legal-collective-life-policy',
    evidence_class_id: 'collective_life_policy',
    rationale: 'HR-003: enlace directo, sin ambigüedad, entre el requisito ya subdividido por contexto real y la clase cerrada de póliza de seguro de vida colectivo del catálogo de 17 clases empresariales.',
    source_reference: 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 356-360.',
  },
];

const ABSTENTIONS = [
  {
    requirement_id: 'technical-video-surveillance-scope',
    axis: 'category_override',
    reason: 'evidence_quality_insufficient_false_positive_dominated',
    detail: 'Con la extracción ampliada a 17/17 documentos vigentes (33 citas automáticas frente a 9 en la extracción sobre 3/17), 27 de 33 citas siguen siendo falsos positivos (verificado leyendo cada una): 24 son "Cámara(s) de Comercio"/Confecámaras (registro mercantil, representación legal), 2 usan "monitoreo" en el sentido de seguimiento de indicadores de un programa de gestión de contratistas (Anexo 5), no de video, y 1 es una mención no relacionada a la Superintendencia de Vigilancia sobre infraestructura física en Manizales. Las 6 citas restantes son señales reales pero no cuantificables, ahora corroboradas de forma idéntica en tres documentos independientes (Estudios previos, Proyecto de pliego y Pliego definitivo): (a) dos turnos de personal llamados literalmente "Monitoreo" (24h, sin arma) dentro de la tabla de puestos de vigilancia; (b) una frase narrativa de justificación ("Estudios previos" §14) que menciona circuitos cerrados de televisión como herramienta de apoyo, sin cifra ni alcance; (c) una definición regulatoria genérica de "medios tecnológicos" en vigilancia privada (Estudios del Sector §133, no específica de este contrato); y (d) un listado de procesos de OTRAS entidades que sí incluyeron medios tecnológicos (Estudios del Sector §216, comparación de mercado, no un requisito de este pliego). Ninguna de las 6 especifica cantidad de cámaras, cobertura o especificación técnica exigida para este contrato; siguen siendo indicio contextual, no una condición cuantificable cerrada.',
  },
  {
    requirement_id: 'technical-video-surveillance-scope',
    axis: 'evidence_class_link',
    reason: 'no_catalog_class_conceptually_corresponds',
    detail: 'El catálogo cerrado de 17 clases de evidencia empresarial (agt002-company-evidence-classes.js) describe documentos de calificación de la empresa (licencias, RUP, pólizas, financieros, personal); ninguna clase corresponde conceptualmente al alcance técnico de videovigilancia/CCTV exigido por el pliego para la ejecución del servicio.',
  },
];

async function main() {
  const envFile = process.env.ENV_FILE || resolve(ROOT, '.env.local');
  loadEnvFile(envFile);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (solo lectura, service_role).');
  }
  const database = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // --- Snapshot alignment: verify SNAPSHOT_ID is genuinely the opportunity's live
  // canonical pointer (psi_tender_document_state.current_snapshot_id — the same table
  // getCurrentTenderAnalysis in tender-analysis-foundation.js treats as authoritative),
  // and that its embedded 17-document manifest identity set is exactly the opportunity's
  // 17 current document versions. Fail loudly rather than silently assuming either. ---
  const { data: stateRow, error: stateError } = await database
    .from('psi_tender_document_state')
    .select('opportunity_id,current_snapshot_id,refresh_in_progress')
    .eq('opportunity_id', OPPORTUNITY_ID)
    .maybeSingle();
  if (stateError) throw stateError;
  if (!stateRow || stateRow.current_snapshot_id !== SNAPSHOT_ID) {
    throw new Error(
      `El snapshot canónico esperado (${SNAPSHOT_ID}) no coincide con psi_tender_document_state.current_snapshot_id `
      + `(${stateRow ? stateRow.current_snapshot_id : 'sin fila de estado'}); no se puede continuar sin reconciliar esto primero.`,
    );
  }

  const { data: currentVersions, error: versionsError } = await database
    .from('psi_tender_document_versions')
    .select('id,source_document_id,version,name,document_type,content_hash,extracted_text')
    .eq('opportunity_id', OPPORTUNITY_ID)
    .eq('current', true)
    .order('source_document_id');
  if (versionsError) throw versionsError;
  if (currentVersions.length !== 17) {
    throw new Error(`Se esperaban 17 documentos vigentes; se encontraron ${currentVersions.length}.`);
  }

  const { data: snapshotRow, error: snapshotError } = await database
    .from('psi_tender_document_snapshots')
    .select('id,document_manifest')
    .eq('id', SNAPSHOT_ID)
    .maybeSingle();
  if (snapshotError) throw snapshotError;
  const manifestDocumentIds = (snapshotRow?.document_manifest?.documents || []).map(doc => doc.document_id).sort();
  const currentVersionIds = currentVersions.map(version => version.id).sort();
  if (JSON.stringify(manifestDocumentIds) !== JSON.stringify(currentVersionIds)) {
    throw new Error(
      'El conjunto de document_id del snapshot canónico no coincide exactamente con los 17 document_version_id vigentes; '
      + 'no se puede presumir la equivalencia snapshot-manifest = versiones vigentes.',
    );
  }

  // --- Local, deterministic, pure chunk reconstruction — no network, exactly the same
  // contract and inputs production's chunkDocuments phase feeds buildAgt002DocumentChunks
  // (server/index.js). This is what closes the 3/17 → 17/17 coverage gap: text comes
  // straight from psi_tender_document_versions.extracted_text (the real source column),
  // never from the possibly-stale, possibly-partial psi_tender_document_chunks table. ---
  const pureChunkInputDocuments = currentVersions.map(version => ({
    document_id: version.source_document_id,
    document_version_id: version.id,
    opportunity_id: OPPORTUNITY_ID,
    snapshot_id: SNAPSHOT_ID,
    document_type: version.document_type,
    name: version.name,
    version: version.version,
    content_hash: version.content_hash,
    current: true,
    extracted_text: version.extracted_text || '',
  }));
  const { chunks: localChunks, gaps: localChunkGaps } = buildAgt002DocumentChunks(pureChunkInputDocuments);

  const chunksByVersion = new Map();
  for (const chunk of localChunks) {
    if (!chunksByVersion.has(chunk.document_version_id)) chunksByVersion.set(chunk.document_version_id, []);
    chunksByVersion.get(chunk.document_version_id).push(chunk);
  }

  // --- Reconciliation: cross-check the local reconstruction against whatever the real
  // pipeline already persisted, by exact chunk_id/content_hash/chunk_hash equality. Fails
  // loudly on any mismatch — silence here would mean trusting an unfaithful
  // reimplementation for the 14 previously-uncovered documents. ---
  const existingDbChunks = await fetchExistingChunks(database, OPPORTUNITY_ID);
  const { matchedCount: reconciledChunkCount, reconciledSnapshotIds } = reconcileLocalChunksAgainstDb(localChunks, existingDbChunks);

  const documentsWithLocalChunks = currentVersions.filter(version => chunksByVersion.has(version.id));
  const documentsWithoutLocalChunks = currentVersions.filter(version => !chunksByVersion.has(version.id));

  // --- Requirement extraction runs over the real extracted_text directly (the same
  // `content` field tender-requirement-extraction.js's canonicalDocuments reads via
  // `document.content ?? document.extracted_text`) — not a chunk-join reconstruction — for
  // every one of the 17 current documents with non-blank text; unverifiable_documents
  // (buildGovernedRequirementAnalysis's own gap tracking) honestly records any that are blank. ---
  const documents = currentVersions.map(version => ({
    document_id: version.id,
    name: version.name,
    document_type: version.document_type,
    content: version.extracted_text || '',
  }));
  const provenanceDocuments = currentVersions.map(version => ({
    document_id: version.id,
    document_version_id: version.id,
    content_hash: version.content_hash,
  }));

  const analysis = buildGovernedRequirementAnalysis(documents, {});
  const matrix = { legal: analysis.legal, financial: analysis.financial, technical: analysis.technical };
  const requirementManifest = buildAgt002RequirementManifest({ matrix, documents: provenanceDocuments });

  const chunkCitations = {};
  const evidenceChunkSnapshotIds = new Set();
  const dbChunkSnapshotById = new Map(existingDbChunks.filter(row => row.current === true).map(row => [row.chunk_id, row.snapshot_id]));
  for (const entry of requirementManifest.requirement_manifest) {
    const patterns = REQUIREMENT_CITATION_PATTERNS[entry.requirement_id] || [];
    const citations = [];
    for (const source of entry.sources) {
      for (const chunk of chunksByVersion.get(source.document_version_id) || []) {
        const normalized = searchNormalize(chunk.text);
        if (patterns.some(pattern => pattern.test(normalized))) {
          citations.push({
            document_version_id: source.document_version_id,
            document_name: chunk.name,
            document_type: chunk.document_type,
            page: chunk.page,
            section: chunk.section,
            chunk_index: chunk.chunk_index,
            chunk_id: chunk.chunk_id,
            chunk_hash: chunk.chunk_hash,
          });
          // Evidence-chunk provenance: the real DB-observed snapshot when this exact chunk_id
          // is already persisted (reconciled above); otherwise the canonical snapshot this
          // local reconstruction ran against (disclosed honestly in data_gaps as not yet
          // persisted to psi_tender_document_chunks).
          evidenceChunkSnapshotIds.add(dbChunkSnapshotById.get(chunk.chunk_id) || SNAPSHOT_ID);
        }
      }
    }
    citations.sort((left, right) => left.document_version_id.localeCompare(right.document_version_id)
      || left.page - right.page || left.section - right.section || left.chunk_index - right.chunk_index);
    chunkCitations[entry.requirement_id] = citations;
  }

  const dataGaps = [];
  if (documentsWithoutLocalChunks.length) {
    dataGaps.push({
      gap_id: 'documents_without_extractable_chunks',
      description: `De los 17 documentos vigentes, ${documentsWithoutLocalChunks.length} (${documentsWithoutLocalChunks.map(v => v.source_document_id).sort().join(', ')}) no produjeron chunks locales (extracted_text vacío o ilegible por la clasificación de agt002-document-chunks.js) y por lo tanto no aportan citas de chunk, aunque sí participaron en la extracción de requisitos si su texto no estaba en blanco.`,
      affected_document_ids: documentsWithoutLocalChunks.map(version => version.source_document_id).sort(),
    });
  }
  const notYetPersistedDocumentIds = documentsWithLocalChunks
    .filter(version => !(chunksByVersion.get(version.id) || []).every(chunk => dbChunkSnapshotById.has(chunk.chunk_id)))
    .map(version => version.source_document_id)
    .sort();
  dataGaps.push({
    gap_id: 'local_reconstruction_not_yet_persisted_in_db',
    description: `Esta ejecución reconstruyó chunks localmente (deterministas, contrato agt002-document-chunks.js) para ${documentsWithLocalChunks.length}/17 documentos vigentes directamente desde psi_tender_document_versions.extracted_text — no desde psi_tender_document_chunks. Se reconciliaron por igualdad exacta de chunk_id/content_hash/chunk_hash contra los ${reconciledChunkCount} chunks que sí existen hoy en psi_tender_document_chunks (current=true) para esta oportunidad, sin ninguna discrepancia. De esos ${documentsWithLocalChunks.length} documentos, ${notYetPersistedDocumentIds.length} (${notYetPersistedDocumentIds.join(', ') || 'ninguno'}) tienen chunk evidence que existe únicamente en esta reconstrucción local (nunca ejecutada por el pipeline real de producción contra el snapshot canónico ${SNAPSHOT_ID}); esos chunk_id no están hoy en psi_tender_document_chunks. Esta sesión no escribió ningún chunk a la base de datos: la reconstrucción es puramente local, en memoria, para este borrador.`,
    affected_document_ids: notYetPersistedDocumentIds,
  });
  dataGaps.push({
    gap_id: 'extractor_scope_is_not_full_pliego_coverage',
    description: 'tender-requirement-extraction.js (a través de buildGovernedRequirementAnalysis, HR-003) es un clasificador cerrado que solo reconoce exactamente cuatro requirement_id fijos para esta oportunidad (legal-rce-policy, legal-collective-life-policy, financial-working-capital, technical-video-surveillance-scope) sin importar cuántos documentos se le entreguen — no es un extractor semántico exhaustivo del pliego. legal-rce-policy y legal-collective-life-policy reemplazan, solo para este flujo gobernado, al requisito genérico legal-guarantee-policy que usaban las versiones 1 y 2 de este borrador; el extractor genérico (extractLegalRequirements/legal-guarantee-policy) sigue existiendo sin cambios para el flujo v2 de preanálisis por reglas (fuera del alcance de este script). Ejecutar esta extracción sobre 17/17 documentos vigentes (en vez de 3/17) amplía la evidencia disponible para esos cuatro requisitos (más citas, propuestas/abstenciones mejor fundamentadas) pero NO descubre nuevos requirement_id ni constituye cobertura semántica total del pliego real, que puede contener requisitos habilitantes, técnicos o financieros adicionales que este extractor cerrado simplemente no está diseñado para reconocer. Una extracción exhaustiva del pliego requeriría una revisión humana adicional, fuera del alcance de este script.',
    affected_document_ids: [],
  });

  // --- Real evidence registry read: same allowlisted select the governed v3 engine
  // uses (agt002-company-evidence-classes.js), never select('*'). Cross-checks every
  // evidence_class_link proposal against the classes actually observed for this
  // company, not merely against the static 17-id catalog. ---
  const registryEntries = await loadAgt002CompanyEvidenceRegistryEntries(database);
  if (registryEntries.length !== 17) {
    throw new Error(`Se esperaban 17 filas vigentes en psi_agt002_company_evidence_registry; se encontraron ${registryEntries.length}.`);
  }
  const observedEntryIds = new Set(registryEntries.map(entry => entry.entry_id));
  for (const id of observedEntryIds) {
    if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(id)) throw new Error(`entry_id fuera del catálogo cerrado: ${id}.`);
  }
  for (const proposal of EVIDENCE_CLASS_LINK_PROPOSALS) {
    if (!observedEntryIds.has(proposal.evidence_class_id)) {
      throw new Error(
        `evidence_class_link_proposals propone "${proposal.evidence_class_id}" para ${proposal.requirement_id}, `
        + 'pero esa clase no está entre las filas reales observadas de psi_agt002_company_evidence_registry.',
      );
    }
  }

  const draft = buildAgt002GovernanceDraftProposal({
    opportunityId: OPPORTUNITY_ID,
    snapshotId: SNAPSHOT_ID,
    evidenceChunkSnapshotIds: [...evidenceChunkSnapshotIds].sort(),
    generatedAt: new Date().toISOString(),
    version: DRAFT_VERSION,
    requirementManifest,
    chunkCitations,
    categoryOverrideProposals: CATEGORY_OVERRIDE_PROPOSALS,
    evidenceClassLinkProposals: EVIDENCE_CLASS_LINK_PROPOSALS,
    abstentions: ABSTENTIONS,
    dataGaps,
  });

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(draft, null, 2)}\n`);
  console.log(`Draft escrito en ${OUTPUT_PATH}`);
  console.log(JSON.stringify({
    coverage: analysis.coverage,
    documents_total: currentVersions.length,
    documents_with_local_chunks: documentsWithLocalChunks.length,
    documents_without_local_chunks: documentsWithoutLocalChunks.length,
    local_chunks_total: localChunks.length,
    local_chunk_gaps: localChunkGaps.length,
    reconciled_chunk_count_matching_db: reconciledChunkCount,
    reconciled_snapshot_ids_observed_in_db: [...reconciledSnapshotIds].sort(),
    evidence_chunk_snapshot_ids: [...evidenceChunkSnapshotIds].sort(),
    unverifiable_documents: analysis.unverifiable_documents,
    registry_entries_observed: registryEntries.length,
    registry_entry_ids: [...observedEntryIds].sort(),
  }, null, 2));
}

main().catch(error => {
  console.error('agt002-rama-judicial-governance-draft-generate failed:', error.message);
  process.exitCode = 1;
});

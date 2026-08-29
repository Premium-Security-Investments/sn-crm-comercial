import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AGT002_CONTEXT_VERSION, buildAgt002ContextV2 } from './agt002-context-v2.js';
import { validateAgt002CompanyEvidenceIdentity } from './agt002-company-evidence-identity.js';
import { AGT002_MANIZALES_CHECKED_IN_MANIFEST } from './agt002-manizales-manifest-source.js';
import {
  deriveAgt002ManizalesManifestScope,
  deriveAgt002ManizalesUnresolvedManifestEntries,
} from './agt002-manizales-manifest-wiring.js';
import { validateAgt002ManifestScope } from './agt002-tender-adapter.js';
import { deriveAgt002ManizalesExerciseDecisionReview } from './agt002-manizales-exercise-decision-review.js';
import { deriveAgt002GenericDecisionReview } from './agt002-generic-decision-review.js';
import { deriveAgt002DecisionAnalysis } from './agt002-decision-axis-analysis.js';
import { canonicalizeTenderDocumentGaps } from './tender-document-gap-canonical.js';

const RULES_PRODUCER = 'siio_rules_v1';
const RULES_METHOD = 'rules';
const RULES_SCHEMA_VERSION = 'siio-tender-analysis-rules-v1';
const RULES_POLICY_VERSION = 'siio-rules-v1';
const ZERO_USAGE = Object.freeze({ input_tokens: 0, output_tokens: 0, cost_usd: 0 });

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function contentSha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function normalizeTenderDocumentContent(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function stableDocumentId(document, content) {
  const explicitId = [document?.id, document?.source_document_id]
    .find(value => value != null && String(value).trim());
  if (explicitId != null) return String(explicitId).trim();
  return sha256({
    name: String(document?.name ?? ''),
    document_type: String(document?.document_type ?? ''),
    content,
  });
}

function canonicalDocument(document) {
  const content = normalizeTenderDocumentContent(document?.content ?? document?.extracted_text);
  return {
    document_id: stableDocumentId(document, content),
    name: String(document?.name ?? ''),
    document_type: String(document?.document_type ?? ''),
    content,
    content_sha256: contentSha256(content),
    current: document?.current !== false,
  };
}

function canonicalRulesResult(result) {
  return stable(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'generated_at')));
}

function requireId(value, label) {
  if (!value || typeof value !== 'string') throw new Error(`${label} es obligatorio para registrar el preanálisis.`);
  return value;
}

function unwrapRpc(response) {
  if (response?.error) throw new Error(response.error.message || String(response.error));
  if (!response || response.data == null) throw new Error('La RPC de análisis no devolvió un resultado.');
  return response.data;
}

function countCriticalOpenQuestions(result) {
  return Array.isArray(result?.questions)
    ? result.questions.filter(question => question?.critical === true).length
    : 0;
}

/**
 * Insumo canónico del snapshot documental: los documentos, los HUECOS del
 * expediente y el perfil, cada uno con su identidad.
 *
 * `document_gaps` es parte del hecho inmutable, no una nota al margen: un
 * expediente al que le falta un documento oficial (tope de selección) o cuya
 * extracción tipada quedó en `gap` (un ZIP con entradas ilegibles) NO puede
 * reutilizar la identidad documental del expediente íntegro, porque entonces la
 * publicación append-only lo daría por ya publicado y el hueco desaparecería.
 *
 * Compatibilidad append-only: un expediente SIN huecos conserva exactamente la
 * identidad ya persistida en psi_tender_document_snapshots —`sha256(documentos
 * canónicos)`—. Si esa identidad cambiara, todo snapshot histórico dejaría de
 * casar con sus documentos y `getCurrentTenderAnalysis` marcaría `current:
 * false` en masa. Solo cuando hay al menos un hueco la identidad pasa a ligar
 * documentos + huecos.
 */
export function buildTenderSnapshotInput(records, companyProfile, documentGaps = []) {
  const documentsById = new Map();
  for (const record of records || []) {
    const document = canonicalDocument(record);
    documentsById.set(document.document_id, document);
  }
  const documents = [...documentsById.values()]
    .sort((left, right) => left.document_id.localeCompare(right.document_id));
  const gaps = canonicalizeTenderDocumentGaps(documentGaps);
  const profile = stable(companyProfile || {});
  return {
    documents,
    document_gaps: gaps,
    document_hash: gaps.length ? sha256({ documents, document_gaps: gaps }) : sha256(documents),
    company_profile: profile,
    profile_hash: sha256(profile),
  };
}

export async function registerTenderDocumentSnapshot(database, context) {
  const opportunityId = requireId(context?.opportunity_id, 'La oportunidad');
  const tenderId = requireId(context?.tender_id, 'La licitación');
  const actorId = requireId(context?.actor_id, 'El actor');
  const refreshToken = requireId(context?.refresh_token, 'El token de actualización documental');
  const snapshot = buildTenderSnapshotInput(context.documents, context.company_profile, context.document_gaps);
  const record = unwrapRpc(await database.rpc('psi_record_tender_document_snapshot', {
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_document_hash: snapshot.document_hash,
    p_profile_hash: snapshot.profile_hash,
    // El manifiesto gobernado lleva los huecos junto a los documentos: es la
    // única copia inmutable de lo que faltaba cuando se publicó el expediente, y
    // de ahí la vuelve a leer AGT-002 (agt002-tender-requirement-gaps.js).
    p_document_manifest: { documents: snapshot.documents, document_gaps: snapshot.document_gaps },
    p_profile_snapshot: snapshot.company_profile,
    p_actor_id: actorId,
    p_refresh_token: refreshToken,
  }));
  return { ...snapshot, ...record, id: requireId(record.id, 'El snapshot documental') };
}

export async function registerSiioRulesAnalysis(database, context) {
  const opportunityId = requireId(context?.opportunity_id, 'La oportunidad');
  const tenderId = requireId(context?.tender_id, 'La licitación');
  const actorId = requireId(context?.actor_id, 'El actor');
  const result = context?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('El preanálisis por reglas requiere su resultado estructurado real.');
  }
  const canonicalResult = canonicalRulesResult(result);

  // Mismo expediente ⇒ misma identidad, huecos incluidos: un análisis que ignore
  // los huecos con los que se publicó el snapshot ya no puede hacerse pasar por
  // el expediente gobernado.
  const expectedSnapshot = buildTenderSnapshotInput(context.documents, context.company_profile, context.document_gaps);
  let snapshotRecord;
  if (context?.snapshot_record) {
    const providedSnapshotId = requireId(context.snapshot_record.id, 'El snapshot documental');
    if (context.snapshot_record.document_hash !== expectedSnapshot.document_hash
      || context.snapshot_record.profile_hash !== expectedSnapshot.profile_hash) {
      throw new Error('El snapshot documental gobernado no coincide con los documentos y perfil analizados.');
    }
    snapshotRecord = { ...expectedSnapshot, ...context.snapshot_record, id: providedSnapshotId };
  } else {
    snapshotRecord = await registerTenderDocumentSnapshot(database, context);
  }
  const snapshotId = requireId(snapshotRecord.id, 'El snapshot documental');
  const criticalOpenCount = countCriticalOpenQuestions(canonicalResult);
  const runRecord = unwrapRpc(await database.rpc('psi_record_tender_analysis_run', {
    p_snapshot_id: snapshotId,
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_producer: RULES_PRODUCER,
    p_method: RULES_METHOD,
    p_status: 'completed',
    p_result: canonicalResult,
    p_critical_open_count: criticalOpenCount,
    p_idempotency_key: sha256({ opportunity_id: opportunityId, snapshot_id: snapshotId, policy_version: RULES_POLICY_VERSION }),
    p_schema_version: RULES_SCHEMA_VERSION,
    p_policy_version: RULES_POLICY_VERSION,
    p_model: null,
    p_usage: { ...ZERO_USAGE },
  }));
  const runId = requireId(runRecord.id, 'La ejecución de análisis');
  return {
    run_id: runId,
    snapshot_id: snapshotId,
    producer: RULES_PRODUCER,
    method: RULES_METHOD,
    status: runRecord.status || 'completed',
    current: true,
    result: canonicalResult,
    critical_open_count: runRecord.critical_open_count ?? criticalOpenCount,
  };
}

// Columns of psi_tender_analysis_runs the current-analysis read ever needs. `result` is the
// only wide one: an AGT-002 V3 canonical run carries its whole integral analysis there, so the
// value is TOASTed and every read of it is charged to the statement that selects it (that is the
// statement Supabase cancels with `canceling statement due to statement timeout`). Callers that
// never render the payload ask for the typed metadata only.
function currentAnalysisRunColumns({ canonicalOnly, includeResult }) {
  return [
    'id', 'snapshot_id', 'producer', 'method', 'status',
    ...(includeResult ? ['result'] : []),
    'critical_open_count', 'created_at', 'completed_at',
    ...(canonicalOnly ? ['canonical'] : []),
  ].join(',');
}

/**
 * Resolves the analysis run that is authoritative for the opportunity's current snapshot.
 *
 * `includeResult: false` returns the same typed provenance (run_id/snapshot_id/producer/method/
 * status/canonical/current/critical_open_count/timestamps) with `result: null`, and never asks
 * PostgREST for the run payload. It is a projection of the read, never a relaxation of any gate:
 * callers that decide anything on the analysis content (GO preparation, presentation) keep the
 * default and still receive the full result.
 */
export async function getCurrentTenderAnalysis(database, opportunityId, currentDocuments = null, { canonicalOnly = false, includeResult = true } = {}) {
  const normalizedOpportunityId = requireId(opportunityId, 'La oportunidad');
  const stateResponse = await database.from('psi_tender_document_state')
    .select('current_snapshot_id,refresh_in_progress')
    .eq('opportunity_id', normalizedOpportunityId)
    .maybeSingle();
  if (stateResponse?.error) throw new Error(stateResponse.error.message || String(stateResponse.error));
  const state = stateResponse?.data;
  if (!state?.current_snapshot_id) return null;
  const snapshotResponse = await database.from('psi_tender_document_snapshots')
    .select('id,document_hash')
    .eq('id', state.current_snapshot_id)
    .maybeSingle();
  if (snapshotResponse?.error) throw new Error(snapshotResponse.error.message || String(snapshotResponse.error));
  const latestSnapshot = snapshotResponse?.data;
  if (!latestSnapshot?.id) return null;

  // Indexable read contract — locked by tests/tender-current-analysis-read-contract.test.mjs.
  // Every equality below must be provable by Postgres against an existing index, otherwise this
  // lookup silently degrades into a descending scan over every run of the opportunity with a heap
  // visibility check per row, which is exactly what exhausts statement_timeout on a cold cache:
  //   * `status = 'completed'` on the canonical branch adds NO restriction — 050's
  //     psi_tender_analysis_runs_canonical_agt002_check already guarantees canonical ⇒ completed —
  //     but it is what lets the planner match the predicate of the two canonical partial indexes
  //     (050 psi_tender_analysis_runs_canonical_current_idx and 063's unique
  //     psi_tender_analysis_runs_one_canonical_current_idx, both `where canonical and
  //     status = 'completed'`). Without it neither index is usable at all.
  //   * the (opportunity_id, snapshot_id) equality pair is covered by 071's composite index, so
  //     the snapshot-scoped lookup is an exact index range whose ORDER BY is already satisfied and
  //     whose cost no longer grows with the number of runs the opportunity accumulates.
  const selectLatestRun = async (snapshotId = null) => {
    let query = database.from('psi_tender_analysis_runs')
      .select(currentAnalysisRunColumns({ canonicalOnly, includeResult }))
      .eq('opportunity_id', normalizedOpportunityId);
    if (canonicalOnly) query = query.eq('canonical', true).eq('status', 'completed');
    if (snapshotId) query = query.eq('snapshot_id', snapshotId);
    const response = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1);
    if (response?.error) throw new Error(response.error.message || String(response.error));
    return Array.isArray(response?.data) ? response.data[0] : response?.data;
  };

  const currentSnapshotRun = await selectLatestRun(latestSnapshot.id);
  const run = currentSnapshotRun || (canonicalOnly ? null : await selectLatestRun());
  if (!run) return null;
  const documentsMatchSnapshot = !Array.isArray(currentDocuments)
    || buildTenderSnapshotInput(currentDocuments, {}).document_hash === latestSnapshot.document_hash;
  return {
    run_id: run.id,
    opportunity_id: normalizedOpportunityId,
    snapshot_id: run.snapshot_id,
    producer: run.producer,
    method: run.method,
    status: run.status,
    ...(canonicalOnly ? { canonical: run.canonical === true } : {}),
    current: !state.refresh_in_progress && run.snapshot_id === latestSnapshot.id && documentsMatchSnapshot,
    result: includeResult ? run.result : null,
    critical_open_count: run.critical_open_count ?? 0,
    created_at: run.created_at || null,
    completed_at: run.completed_at || null,
  };
}

/**
 * Persists an immutable, append-only AGT-002 context v2 version: the validated
 * closed context (including the human answers effective at creation time) plus
 * its content hash. Every canonical analysis run that consumes this context must
 * reference the returned id so past runs stay reproducible even after new human
 * answers or evidence arrive later.
 *
 * `context.company_evidence_identity`, when present, is an optional sibling of
 * `context.context`: the run-binding company evidence identity (see
 * agt002-company-evidence-identity.js). It is re-validated and folded into the persisted
 * context (and therefore its hash/idempotency key) before the RPC call — never merely
 * accepted and ignored.
 */
export async function registerAgt002ContextVersion(database, context) {
  const opportunityId = requireId(context?.opportunity_id, 'La oportunidad');
  const tenderId = requireId(context?.tender_id, 'La licitación');
  const snapshotId = requireId(context?.snapshot_id, 'El snapshot documental');
  const actorId = requireId(context?.actor_id, 'El actor');
  const baseContext = buildAgt002ContextV2(context?.context);
  const rawCompanyEvidenceIdentity = context?.company_evidence_identity;
  // Optional, backward-compatible extension: an absent sibling leaves validatedContext
  // byte-for-byte identical to baseContext (same contextHash/idempotencyKey as before this
  // field existed); a present sibling is re-validated (never trusted verbatim) and folded in
  // BEFORE contextHash/idempotencyKey are derived, so persisted context, its hash and the
  // context-version idempotency key all genuinely depend on which evidence backed this run.
  const validatedContext = rawCompanyEvidenceIdentity == null
    ? baseContext
    : Object.freeze({
      ...baseContext,
      company_evidence_identity: validateAgt002CompanyEvidenceIdentity(rawCompanyEvidenceIdentity),
    });
  const contextHash = sha256(validatedContext);
  const humanEvidenceCount = validatedContext.human_evidence.length;
  const idempotencyKey = sha256({ opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: snapshotId, context_hash: contextHash });
  const record = unwrapRpc(await database.rpc('psi_record_agt002_context_version', {
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_snapshot_id: snapshotId,
    p_context_version: AGT002_CONTEXT_VERSION,
    p_context: validatedContext,
    p_context_hash: contextHash,
    p_human_evidence_count: humanEvidenceCount,
    p_idempotency_key: idempotencyKey,
    p_actor_id: actorId,
  }));
  return { ...record, id: requireId(record.id, 'La versión de contexto') };
}

// AGT-002 V3 visibility defect fix: the Manizales SA-24-2026 pilot's manifest_scope carries 25
// atomized entries, 20 analyzable and 5 unresolved_visible, but nothing surfaced the identities
// of the 5 to a human. `manifest_unresolved_entries` closes that gap on the READ side only —
// it never touches the engine's analyzable selection, integral_analysis.analysis_units, or the
// persisted run. Derived once, at module load, from the same checked-in validated manifest the
// engine itself uses, so the presented identities can never drift from the governed source.
const MANIZALES_PILOT_MANIFEST_SCOPE = deriveAgt002ManizalesManifestScope(AGT002_MANIZALES_CHECKED_IN_MANIFEST);
const MANIZALES_PILOT_UNRESOLVED_MANIFEST_ENTRIES = deriveAgt002ManizalesUnresolvedManifestEntries(AGT002_MANIZALES_CHECKED_IN_MANIFEST);

// Fail-closed match against the exact pilot scope: an absent, malformed, or foreign scope never
// enriches — never a generic fallback. Compared field-by-field (via the stable/sorted-key
// serialization already used for hashing above) rather than by raw key order, since a scope that
// round-tripped through JSON/DB storage is not guaranteed to preserve insertion order.
function matchesManizalesPilotManifestScope(candidateScope) {
  if (!candidateScope || typeof candidateScope !== 'object') return false;
  let normalized;
  try {
    normalized = validateAgt002ManifestScope(candidateScope);
  } catch {
    return false;
  }
  return JSON.stringify(stable(normalized)) === JSON.stringify(stable(MANIZALES_PILOT_MANIFEST_SCOPE));
}

// The integral_analysis must itself be the governed 20-analyzable run this manifest_scope
// describes — never a mismatched or partial run (e.g. a stalled job that only persisted a few
// units) wearing the pilot's manifest_scope.
function integralAnalysisAlignedWithManizalesAnalyzableIds(integralAnalysis) {
  const analyzedIds = integralAnalysis?.coverage?.analyzed_requirement_ids;
  const expectedIds = MANIZALES_PILOT_MANIFEST_SCOPE.analyzable_requirement_ids;
  return Array.isArray(analyzedIds)
    && analyzedIds.length === expectedIds.length
    && analyzedIds.every((id, index) => id === expectedIds[index]);
}

// Manizales SA-24-2026 decision-review presentation (read-side only, opt-in for a single pinned
// production artifact): the human-curated review of the 20 canonical units + the manifest's
// unresolved_visible entries + 2 registry-supplement requirements, derived by the pure, generic,
// fail-closed layer in agt002-manizales-exercise-decision-review.js. This is a PRESENTATION
// integration only — it never touches the engine, the canonical run, or persistence — and it is
// gated to the exact production opportunity + the exact pinned canonical run this review was
// authored against, so it can never attach to any other opportunity, tender, or later re-run.
//
// Runtime data source, versioned outside tests/fixtures so production code never depends on a
// test-only path; the checked-in tests/fixtures copy is verified byte-identical to this source by
// tests/agt002-manizales-decision-review-presentation.test.mjs to prevent drift.
const MANIZALES_EXERCISE_DECISION_REVIEW_SOURCE = JSON.parse(readFileSync(
  new URL('./data/agt002/manizales-sa-24-2026.exercise-decision-review.v1.json', import.meta.url),
  'utf8',
));
// Real, checked-in governed contractual registry — the only source of registry_citation
// evidence_refs. Never fabricated: the derivation layer fail-closes if a fixture citation does
// not match this index exactly.
const MANIZALES_CONTRACTUAL_REGISTRY = JSON.parse(readFileSync(
  new URL('./data/agt002/manizales-sa-24-2026.registry.json', import.meta.url),
  'utf8',
));
const MANIZALES_REGISTRY_CITATION_INDEX = new Map();
for (const item of MANIZALES_CONTRACTUAL_REGISTRY.items) {
  for (const subItem of item.sub_items || []) {
    MANIZALES_REGISTRY_CITATION_INDEX.set(subItem.sub_item_id, { item_ref: item.ref, char_start: subItem.cite.char_start });
  }
}
const MANIZALES_PILOT_MANIFEST_UNRESOLVED_REQUIREMENT_IDS = new Set(
  MANIZALES_PILOT_UNRESOLVED_MANIFEST_ENTRIES.map(entry => entry.requirement_id),
);
// The single production artifact this presentation integration targets: opportunity 54190e51 and
// its canonical run 7553a51f. Any other opportunity/run never receives decision_review.
const MANIZALES_DECISION_REVIEW_OPPORTUNITY_ID = '54190e51-15fb-46af-b0aa-8f13461a3110';
const MANIZALES_DECISION_REVIEW_RUN_ID = '7553a51f-e4ca-4ad4-bde8-02528063d178';

// Fail-closed: derives decision_review only when the artifact's own opportunity/run identity, the
// Manizales pilot manifest_scope, and the real 20-canonical-unit alignment all match. A validation
// failure inside the derivation (e.g. a future canonical run that no longer matches the reviewed
// fixture) never surfaces a partial/broken review — it silently omits the key, exactly like the
// manifest_unresolved_entries gate above.
function deriveManizalesDecisionReviewIfEligible(currentAnalysis, result) {
  if (currentAnalysis?.opportunity_id !== MANIZALES_DECISION_REVIEW_OPPORTUNITY_ID) return null;
  if (currentAnalysis?.run_id !== MANIZALES_DECISION_REVIEW_RUN_ID) return null;
  if (!matchesManizalesPilotManifestScope(result.manifest_scope)) return null;
  if (!integralAnalysisAlignedWithManizalesAnalyzableIds(result.integral_analysis)) return null;
  try {
    const canonicalUnitIds = new Set(result.integral_analysis.analysis_units.map(unit => unit.requirement_id));
    return deriveAgt002ManizalesExerciseDecisionReview(result.integral_analysis, MANIZALES_EXERCISE_DECISION_REVIEW_SOURCE, {
      canonicalUnitIds,
      manifestUnresolvedRequirementIds: MANIZALES_PILOT_MANIFEST_UNRESOLVED_REQUIREMENT_IDS,
      registryIndex: MANIZALES_REGISTRY_CITATION_INDEX,
    });
  } catch (error) {
    console.warn('agt002_manizales_decision_review_validation_failed', { event: 'agt002_manizales_decision_review_validation_failed', message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Produces the document-API analysis payload without allowing result JSON to forge typed-run authority. */
export function presentCurrentTenderAnalysis(currentAnalysis, questionResponses = []) {
  if (!currentAnalysis) return null;
  const trustedQuestionResponses = Array.isArray(questionResponses) ? questionResponses : [];
  const rawResult = currentAnalysis.result && typeof currentAnalysis.result === 'object' && !Array.isArray(currentAnalysis.result)
    ? currentAnalysis.result
    : {};
  // Never let a model/result-JSON-forged manifest_unresolved_entries or decision_review pass
  // through the spread below; the only values ever presented under these keys are server-derived,
  // and only when their respective fail-closed gates pass.
  const {
    manifest_unresolved_entries: _forgedManifestUnresolvedEntries,
    decision_review: _forgedDecisionReview,
    decision_axis_analysis: _forgedDecisionAxisAnalysis,
    ...result
  } = rawResult;
  const manifestUnresolvedEntries = matchesManizalesPilotManifestScope(result.manifest_scope)
    && integralAnalysisAlignedWithManizalesAnalyzableIds(result.integral_analysis)
    ? MANIZALES_PILOT_UNRESOLVED_MANIFEST_ENTRIES
    : null;
  const decisionReview = deriveManizalesDecisionReviewIfEligible(currentAnalysis, result)
    ?? deriveAgt002GenericDecisionReview(currentAnalysis, result);
  // Server-owned, read-only "Análisis para decidir" projection over the decision_review already
  // resolved above (curated Manizales branch or generic). Never fabricates its own decision_review
  // and never lets the derivation throw out of this function: any failure is fail-closed, exactly
  // like the curated Manizales gate above — the key is simply omitted, never a partial/broken value.
  let decisionAxisAnalysis = null;
  try {
    decisionAxisAnalysis = deriveAgt002DecisionAnalysis(currentAnalysis, result, trustedQuestionResponses, decisionReview);
  } catch (error) {
    console.warn('agt002_decision_axis_analysis_failed', { event: 'agt002_decision_axis_analysis_failed', message: error instanceof Error ? error.message : String(error) });
    decisionAxisAnalysis = null;
  }
  return {
    ...result,
    run_id: currentAnalysis.run_id,
    snapshot_id: currentAnalysis.snapshot_id,
    producer: currentAnalysis.producer,
    method: currentAnalysis.method,
    status: currentAnalysis.status,
    ...(typeof currentAnalysis.canonical === 'boolean' ? { canonical: currentAnalysis.canonical } : {}),
    current: currentAnalysis.current,
    critical_open_count: currentAnalysis.critical_open_count,
    created_at: currentAnalysis.created_at || null,
    completed_at: currentAnalysis.completed_at || null,
    ...(manifestUnresolvedEntries ? { manifest_unresolved_entries: manifestUnresolvedEntries } : {}),
    ...(decisionReview ? { decision_review: decisionReview } : {}),
    ...(decisionAxisAnalysis ? { decision_axis_analysis: decisionAxisAnalysis } : {}),
  };
}

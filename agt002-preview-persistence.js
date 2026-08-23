import { createHash, randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { validateAgt002RequirementManifest } from './agt002-deep-analysis-matrix.js';
import { validateTenderRequirementInventory } from './tender-requirement-inventory.js';
import { projectAgt002IntegralV3ToV2, computeAgt002IntegralV3CriticalOpenCount } from './agt002-v3-compatibility.js';
import { validateAgt002IntegralGovernanceProvenance } from './agt002-integral-governance-overrides.js';
import { validateAgt002ManifestScope } from './agt002-tender-adapter.js';

const CONTENT_KEYS = ['recommendation', 'summary', 'strengths', 'weaknesses', 'blockers', 'questions', 'unverified', 'next_action', 'human_review_required'];
const AGT002_INTEGRAL_V3_SCHEMA_VERSION = '3.0.0';
export const AGT002_INTEGRAL_V3_CONTRACT_VERSION = 'agt002-integral-analysis-v3';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateEvidenceCoverage(value, snapshotId, { requireTenderRequirementInventory = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.snapshot_id !== snapshotId
    || !value.budget || typeof value.budget !== 'object' || Array.isArray(value.budget)
    || !value.coverage_manifest || typeof value.coverage_manifest !== 'object' || Array.isArray(value.coverage_manifest)
    || !Array.isArray(value.selected_chunks)
    || !Array.isArray(value.omitted_chunks)
    || !Array.isArray(value.citation_allowlist)
    || typeof value.material_omissions !== 'boolean') {
    throw new Error('La cobertura de evidencia no corresponde al snapshot o tiene estructura inválida.');
  }
  if (value.selected_chunks.some(chunk => !chunk || typeof chunk !== 'object' || Object.hasOwn(chunk, 'text'))) {
    throw new Error('La cobertura de evidencia no puede persistir texto de chunks.');
  }
  const selectedRefs = value.selected_chunks.map(chunk => chunk.evidence_ref).sort();
  const allowlist = [...value.citation_allowlist].sort();
  if (selectedRefs.length !== allowlist.length || selectedRefs.some((reference, index) => reference !== allowlist[index])) {
    throw new Error('La cobertura de evidencia tiene una allowlist inconsistente.');
  }
  // The self-contained requirement provenance manifest is never trusted verbatim: it is always
  // present alongside evidence_coverage (buildAgt002RequirementManifest fails closed if it
  // can't be built) and is re-validated field-by-field here, independent of the builder.
  if (value.requirement_manifest_version === undefined || value.requirement_manifest === undefined) {
    throw new Error('La cobertura de evidencia requiere el manifiesto de requisitos (requirement_manifest).');
  }
  validateAgt002RequirementManifest({
    requirement_manifest_version: value.requirement_manifest_version,
    requirement_manifest: value.requirement_manifest,
  });
  if (value.tender_requirement_inventory !== undefined) {
    validateAgt002TenderRequirementInventoryCoverage(value.tender_requirement_inventory);
  } else if (requireTenderRequirementInventory) {
    throw new Error('La cobertura canónica requiere tender_requirement_inventory server-side.');
  }
  return value;
}

/**
 * The tender-specific inventory is owned by the server and is deliberately revalidated on the
 * persistence boundary. A missing inventory, forged citation/hash, undisposed source unit, or
 * legacy four-item result therefore cannot be saved as an integral decision record.
 */
export function validateAgt002TenderRequirementInventoryCoverage(value) {
  return validateTenderRequirementInventory(value);
}

function requireId(value, label) {
  if (!value || typeof value !== 'string') throw new Error(`${label} es obligatorio para registrar AGT-002 Preview.`);
  return value;
}

function countCriticalOpenQuestions(content) {
  return Array.isArray(content?.questions) ? content.questions.filter(question => question?.critical === true).length : 0;
}

function unwrapRpc(response) {
  if (response?.error) throw new Error(response.error.message || String(response.error));
  if (!response || response.data == null) throw new Error('La RPC de AGT-002 Preview no devolvió un resultado.');
  return response.data;
}

/**
 * Deterministic per (snapshot, policy, model, optional contract): the DB enforces a single successful
 * run per identity. When contextVersionId is given (a new AGT-002 context version
 * created from human evidence), the identity also binds to it, so a reanalysis never
 * collides with the run it supersedes and callers can reserve/find it consistently.
 */
export function computeAgt002PreviewIdempotencyKey({
  snapshotId, policyVersion, model, contextVersionId = null, legalCorpusVersionId = null, contractVersion = null,
  inventoryVersion = null, inventoryHash = null, snapshotHash = null,
}) {
  const base = createHash('sha256').update(`agt002-preview\0${snapshotId}\0${policyVersion}\0${model}`).digest('hex');
  const withContext = contextVersionId
    ? createHash('sha256').update(`${base}\0context_version\0${contextVersionId}`).digest('hex')
    : base;
  const withLegalCorpus = legalCorpusVersionId
    ? createHash('sha256').update(`${withContext}\0legal_corpus_version\0${legalCorpusVersionId}`).digest('hex')
    : withContext;
  const withContract = contractVersion
    ? createHash('sha256').update(`${withLegalCorpus}\0contract_version\0${contractVersion}`).digest('hex')
    : withLegalCorpus;
  if (inventoryVersion === null && inventoryHash === null && snapshotHash === null) return withContract;
  if (![inventoryVersion, inventoryHash, snapshotHash].every(value => typeof value === 'string' && value.trim())) {
    throw new Error('La identidad de idempotencia del inventario requiere versión, inventory_hash y snapshot_hash juntos.');
  }
  return createHash('sha256').update(`${withContract}\0inventory_version\0${inventoryVersion}\0inventory_hash\0${inventoryHash}\0snapshot_hash\0${snapshotHash}`).digest('hex');
}

/** Atomically reserves one cross-request provider slot in PostgreSQL. */
export async function claimAgt002PreviewRun(database, { idempotencyKey, dailyMaxRuns, maxConcurrent, leaseSeconds }) {
  const key = requireId(idempotencyKey, 'La clave de idempotencia');
  if (![dailyMaxRuns, maxConcurrent, leaseSeconds].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('Los límites de la reserva AGT-002 Preview no son válidos.');
  }
  const result = unwrapRpc(await database.rpc('psi_claim_agt002_preview_run', {
    p_idempotency_key: key,
    p_daily_max_runs: dailyMaxRuns,
    p_max_concurrent: maxConcurrent,
    p_lease_seconds: leaseSeconds,
  }));
  const status = result?.status;
  if (!['claimed', 'existing', 'in_progress', 'quota', 'saturated'].includes(status)) {
    throw new Error('La reserva AGT-002 Preview devolvió un estado inválido.');
  }
  if (status === 'claimed' && (typeof result.claim_id !== 'string' || !result.claim_id)) {
    throw new Error('La reserva AGT-002 Preview no devolvió su identificador.');
  }
  return status === 'claimed' ? { status, claim_id: result.claim_id } : { status };
}

/** Releases a provider slot after persistence or a failed attempt; stale leases also expire in DB. */
export async function releaseAgt002PreviewClaim(database, { idempotencyKey, claimId }) {
  const key = requireId(idempotencyKey, 'La clave de idempotencia');
  const claim = requireId(claimId, 'La reserva');
  const released = unwrapRpc(await database.rpc('psi_release_agt002_preview_claim', {
    p_idempotency_key: key,
    p_claim_id: claim,
  }));
  if (released !== true) throw new Error('No fue posible liberar la reserva AGT-002 Preview.');
  return true;
}

/**
 * Persists a completed AGT-002 Preview run via the existing append-only RPC.
 * Only the model's own closed findings are stored: no prompt, no document
 * text, no policy text, and no credential ever reaches this module.
 */
export async function registerAgt002PreviewAnalysis(database, context) {
  const opportunityId = requireId(context?.opportunity_id, 'La oportunidad');
  const tenderId = requireId(context?.tender_id, 'La licitación');
  const snapshotId = requireId(context?.snapshot_id, 'El snapshot documental');
  const envelope = context?.envelope;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('AGT-002 Preview requiere su envelope estructurado real.');
  }
  const isIntegralV3 = envelope.schema_version === AGT002_INTEGRAL_V3_SCHEMA_VERSION;
  const requireTenderRequirementInventory = context?.requireTenderRequirementInventory === true;
  if (requireTenderRequirementInventory && envelope.evidence_coverage === undefined) {
    throw new Error('La persistencia canónica requiere evidence_coverage con tender_requirement_inventory server-side.');
  }

  if (isIntegralV3) {
    if (envelope.agent_id !== 'AGT-002' || envelope.method !== 'agent_ai') {
      throw new Error('Sólo se puede registrar un envelope con identidad AGT-002.');
    }
    if (context?.canonicalOnly !== true) {
      throw new Error('AGT-002 Preview v3 requiere registro canónico (canonicalOnly): el contrato v3 sólo existe detrás de AGT002_CANONICAL_ONLY.');
    }
  } else if (envelope.producer !== 'AGT-002' || envelope.agent_id !== 'AGT-002' || envelope.method !== 'agent_ai') {
    throw new Error('Sólo se puede registrar un envelope con identidad AGT-002.');
  }

  const usage = envelope.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage) || typeof usage.model !== 'string' || !usage.model.trim()) {
    throw new Error('AGT-002 Preview requiere un uso (usage) con modelo real.');
  }
  const policyVersion = envelope.policy_version;
  if (typeof policyVersion !== 'string' || !policyVersion.trim()) {
    throw new Error('AGT-002 Preview requiere una versión de política real.');
  }

  let content;
  let legalCorpusVersionId;
  let hasLegalCorpusVersionId;

  if (isIntegralV3) {
    // Task 7 (design section 4.3/9): v3 persists BOTH the validated integral_analysis and
    // its deterministic v2 projection atomically, in the same append-only JSONB blob —
    // existing v2 readers keep working against the flattened projection fields, and
    // v3-aware readers additionally see `integral_analysis`. Never re-derived here: both
    // pieces are trusted only because the engine already validated them before returning.
    const integralAnalysis = envelope.integral_analysis;
    if (!isRecord(integralAnalysis) || integralAnalysis.contract_version !== AGT002_INTEGRAL_V3_CONTRACT_VERSION
      || !isRecord(integralAnalysis.coverage) || !Array.isArray(integralAnalysis.analysis_units)) {
      throw new Error('AGT-002 Preview v3 requiere un integral_analysis validado.');
    }
    const v2Projection = envelope.v2_projection;
    if (!isRecord(v2Projection) || CONTENT_KEYS.some(key => !Object.hasOwn(v2Projection, key))) {
      throw new Error('AGT-002 Preview v3 requiere su proyección v2 determinística completa.');
    }
    // Design section 9.9/11.9: never trust the envelope's own copy of the v2 projection —
    // recompute it from integral_analysis (the only validated source of truth) and reject
    // the whole run before any RPC if the carried projection disagrees. This closes the
    // gap where a future non-engine caller (API route, backfill, reader) could otherwise
    // persist an arbitrary/contradictory projection alongside a valid integral_analysis.
    const recomputedProjection = projectAgt002IntegralV3ToV2(integralAnalysis);
    try {
      deepStrictEqual(v2Projection, recomputedProjection);
    } catch {
      throw new Error('AGT-002 Preview v3: v2_projection no coincide con la proyección determinística recomputada desde integral_analysis.');
    }
    content = recomputedProjection;
    content.integral_analysis = integralAnalysis;
    if (envelope.evidence_coverage !== undefined) {
      content.evidence_coverage = validateEvidenceCoverage(envelope.evidence_coverage, snapshotId, { requireTenderRequirementInventory });
    }
    // P2-1: the engine already scoped this to exactly what it bound (agt002-preview-engine.js's
    // selectBoundGovernanceProvenance), but it is never trusted verbatim — re-validated here
    // the same way evidence_coverage above is, so a curated link's class/rationale/version
    // survive to the persisted run only after passing the same fail-closed checks a real
    // curated row must pass.
    if (envelope.governance_provenance !== undefined) {
      content.governance_provenance = validateAgt002IntegralGovernanceProvenance(envelope.governance_provenance);
    }
    // Phase 4: a manifest-driven run carries a server-owned, top-level manifest_scope beside
    // integral_analysis. It is never trusted verbatim: it is re-validated here (closed shape +
    // arithmetic) and deep-compared to a SEPARATELY supplied, server-owned expected scope
    // (context.expectedManifestScope) — envelope self-validation alone is insufficient. A scope
    // with no governing expected scope, a missing scope under one, or a malformed/forged scope
    // is rejected BEFORE any RPC. The expected scope is never sourced from a request body.
    const expectedManifestScope = context?.expectedManifestScope ?? null;
    const envelopeHasManifestScope = Object.hasOwn(envelope, 'manifest_scope');
    if (envelopeHasManifestScope || expectedManifestScope !== null) {
      if (expectedManifestScope === null) {
        throw new Error('AGT-002 Preview v3: se recibió manifest_scope sin un alcance gobernado esperado del servidor para verificarlo.');
      }
      if (!envelopeHasManifestScope) {
        throw new Error('AGT-002 Preview v3: falta el manifest_scope requerido para una corrida gobernada por manifiesto.');
      }
      const persistedScope = validateAgt002ManifestScope(envelope.manifest_scope);
      const expectedScope = validateAgt002ManifestScope(expectedManifestScope);
      try {
        deepStrictEqual(persistedScope, expectedScope);
      } catch {
        throw new Error('AGT-002 Preview v3: el manifest_scope no coincide con el alcance gobernado esperado del servidor.');
      }
      content.manifest_scope = persistedScope;
    }
    // design section 5, invariant 7: legal_corpus_version_id is nullable and stands alone
    // for v3 — legal grounding is validated per-unit inside integral_analysis itself, so
    // there is no separate legal_findings array to pair it with (that pairing is v2-only).
    legalCorpusVersionId = envelope.legal_corpus_version_id ?? null;
    hasLegalCorpusVersionId = typeof legalCorpusVersionId === 'string' && legalCorpusVersionId.trim().length > 0;
    if (hasLegalCorpusVersionId) content.legal_corpus_version_id = legalCorpusVersionId;
  } else {
    content = Object.fromEntries(CONTENT_KEYS.map(key => [key, envelope[key]]));
    if (envelope.evidence_coverage !== undefined) {
      content.evidence_coverage = validateEvidenceCoverage(envelope.evidence_coverage, snapshotId, { requireTenderRequirementInventory });
    }
    const hasLegalEvidence = envelope.legal_evidence !== undefined;
    const hasLegalFindings = envelope.legal_findings !== undefined;
    if (hasLegalEvidence !== hasLegalFindings) {
      throw new Error('La evidencia jurídica y los hallazgos jurídicos deben persistirse como un par atómico.');
    }
    if (hasLegalEvidence) {
      if (!envelope.legal_evidence || typeof envelope.legal_evidence !== 'object' || Array.isArray(envelope.legal_evidence)
        || !Array.isArray(envelope.legal_findings)) {
        throw new Error('La evidencia jurídica del envelope no tiene estructura válida.');
      }
      content.legal_evidence = envelope.legal_evidence;
      content.legal_findings = envelope.legal_findings;
    }
    // The exact published corpus UUID the legal evidence was retrieved from is part of the
    // same atomic pair: a legal run without it (or a stray UUID without legal evidence) can
    // never persist, since it would leave the attribution unauditable or misleading.
    legalCorpusVersionId = envelope.legal_corpus_version_id;
    hasLegalCorpusVersionId = typeof legalCorpusVersionId === 'string' && legalCorpusVersionId.trim().length > 0;
    if (hasLegalEvidence !== hasLegalCorpusVersionId) {
      throw new Error('La evidencia jurídica requiere su legal_corpus_version_id exacto como par atómico.');
    }
  }
  // v3's critical_open_count is derived directly from integral_analysis (design section
  // 10), independent of the projected `questions` array, rather than re-counting the
  // projection's own critical markers — a second, independent derivation from the
  // validated source of truth, not a re-read of a value already trusted once.
  const criticalOpenCount = isIntegralV3
    ? computeAgt002IntegralV3CriticalOpenCount(envelope.integral_analysis)
    : countCriticalOpenQuestions(content);
  // Canonical persistence is fail-closed: every new Vig-IA run must point to the
  // immutable context version it consumed, including an initial version with no
  // human evidence yet. This also makes reanalysis idempotency context-specific.
  const contextVersionId = context?.context_version_id ?? null;
  const canonicalOnly = context?.canonicalOnly === true;
  if (canonicalOnly && !contextVersionId) {
    throw new Error('Un análisis canónico Vig-IA requiere context_version_id.');
  }
  const tenderRequirementInventory = content?.evidence_coverage?.tender_requirement_inventory ?? null;
  const inventoryIdentity = tenderRequirementInventory
    ? {
      inventoryVersion: tenderRequirementInventory.inventory_version,
      inventoryHash: tenderRequirementInventory.inventory_hash,
      snapshotHash: tenderRequirementInventory.snapshot_hash,
    }
    : {};
  const idempotencyKey = computeAgt002PreviewIdempotencyKey({
    snapshotId, policyVersion, model: usage.model, contextVersionId,
    legalCorpusVersionId: hasLegalCorpusVersionId ? legalCorpusVersionId : null,
    contractVersion: isIntegralV3 ? AGT002_INTEGRAL_V3_CONTRACT_VERSION : null,
    ...inventoryIdentity,
  });
  if (context?.expectedIdempotencyKey != null) {
    const expectedIdempotencyKey = requireId(context.expectedIdempotencyKey, 'La clave de idempotencia reservada');
    if (expectedIdempotencyKey !== idempotencyKey) {
      throw new Error('La identidad recalculada del análisis no coincide con la reserva de idempotencia.');
    }
  }

  const commonParams = {
    p_snapshot_id: snapshotId,
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_result: content,
    p_critical_open_count: criticalOpenCount,
    p_idempotency_key: idempotencyKey,
    p_schema_version: envelope.schema_version,
    p_policy_version: policyVersion,
    p_model: usage.model,
    p_usage: usage,
    ...(canonicalOnly && contextVersionId ? { p_context_version_id: contextVersionId } : {}),
    ...(canonicalOnly && hasLegalCorpusVersionId ? { p_legal_corpus_version_id: legalCorpusVersionId } : {}),
  };
  const runRecord = unwrapRpc(await database.rpc(
    canonicalOnly ? 'psi_record_agt002_canonical_analysis_run' : 'psi_record_tender_analysis_run',
    canonicalOnly ? commonParams : { ...commonParams, p_producer: 'AGT-002', p_method: 'agent_ai', p_status: 'completed' },
  ));
  const runId = requireId(runRecord.id, 'La ejecución de AGT-002 Preview');
  const canonical = canonicalOnly ? runRecord.canonical === true : false;
  return {
    run_id: runId,
    snapshot_id: runRecord.snapshot_id || snapshotId,
    producer: runRecord.producer || 'AGT-002',
    method: runRecord.method || 'agent_ai',
    status: runRecord.status || 'completed',
    canonical,
    current: canonicalOnly ? canonical : true,
    result: content,
    critical_open_count: runRecord.critical_open_count ?? criticalOpenCount,
    context_version_id: runRecord.context_version_id ?? contextVersionId,
    ...(hasLegalCorpusVersionId ? { legal_corpus_version_id: runRecord.legal_corpus_version_id ?? legalCorpusVersionId } : {}),
  };
}

/** Appends one immutable lifecycle event for a canonical Vig-IA attempt. */
export async function appendAgt002AnalysisAttempt(database, context, { eventKeyGenerator = randomUUID } = {}) {
  const snapshotId = requireId(context?.snapshot_id, 'El snapshot documental');
  const opportunityId = requireId(context?.opportunity_id, 'La oportunidad');
  const tenderId = requireId(context?.tender_id, 'La licitación');
  const attemptKey = requireId(context?.attempt_key, 'La clave del intento');
  const state = requireId(context?.state, 'El estado del intento');
  if (!['queued', 'running', 'completed', 'retry_wait', 'needs_attention', 'unavailable'].includes(state)) {
    throw new Error('El estado del intento AGT-002 no es válido.');
  }
  const eventKey = requireId(context?.event_key || eventKeyGenerator(), 'La clave del evento');
  return unwrapRpc(await database.rpc('psi_append_agt002_analysis_attempt', {
    p_snapshot_id: snapshotId,
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_attempt_key: attemptKey,
    p_event_key: eventKey,
    p_producer: 'AGT-002',
    p_state: state,
    p_error_code: context?.error_code || null,
    p_error_message: context?.error_message || null,
    p_analysis_run_id: context?.analysis_run_id || null,
  }));
}

/** Returns the latest safe lifecycle projection; raw provider error messages never leave persistence. */
export async function getLatestAgt002AnalysisAttempt(database, opportunityId, { snapshotId = null } = {}) {
  const normalizedOpportunityId = requireId(opportunityId, 'La oportunidad');
  let query = database.from('psi_agt002_analysis_attempt_events')
    .select('id,snapshot_id,tender_id,attempt_key,producer,state,error_code,analysis_run_id,created_at')
    .eq('opportunity_id', normalizedOpportunityId);
  if (snapshotId != null) query = query.eq('snapshot_id', requireId(snapshotId, 'El snapshot documental'));
  const response = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1);
  if (response?.error) throw new Error(response.error.message || String(response.error));
  const row = Array.isArray(response?.data) ? response.data[0] : response?.data;
  if (!row) return null;
  return {
    event_id: row.id,
    snapshot_id: row.snapshot_id,
    tender_id: row.tender_id,
    attempt_key: row.attempt_key,
    producer: row.producer,
    state: row.state,
    error_code: row.error_code || null,
    analysis_run_id: row.analysis_run_id || null,
    created_at: row.created_at || null,
  };
}

/** Interpretable daily quota probe: counts only AGT-002 Preview runs since UTC midnight, never a client-supplied number. */
export async function countAgt002PreviewRunsToday(database, { now = () => new Date() } = {}) {
  const current = now();
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
    throw new Error('El reloj de la cuota diaria de AGT-002 Preview no es válido.');
  }
  const startOfDayUtc = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate())).toISOString();
  const response = await database.from('psi_tender_analysis_runs')
    .select('id', { count: 'exact', head: true })
    .eq('producer', 'AGT-002')
    .gte('created_at', startOfDayUtc);
  if (response?.error) throw new Error(response.error.message || String(response.error));
  const count = response?.count;
  if (!Number.isInteger(count) || count < 0) throw new Error('No se pudo calcular la cuota diaria de AGT-002 Preview.');
  return count;
}

/** Looks up an existing AGT-002 Preview run by idempotency key so callers can skip re-invoking the model entirely. */
export async function findAgt002PreviewRun(database, idempotencyKey, { canonicalOnly = false } = {}) {
  const key = requireId(idempotencyKey, 'La clave de idempotencia');
  let query = database.from('psi_tender_analysis_runs')
    .select(`id,opportunity_id,snapshot_id,producer,method,status,result,critical_open_count,created_at,completed_at${canonicalOnly ? ',canonical' : ''}`)
    .eq('idempotency_key', key);
  const response = await query.maybeSingle();
  if (response?.error) throw new Error(response.error.message || String(response.error));
  const row = response?.data;
  if (!row) return null;
  return {
    run_id: row.id,
    opportunity_id: row.opportunity_id,
    snapshot_id: row.snapshot_id,
    producer: row.producer,
    method: row.method,
    status: row.status,
    ...(canonicalOnly ? { canonical: row.canonical === true } : {}),
    current: canonicalOnly ? row.canonical === true : true,
    result: row.result,
    critical_open_count: row.critical_open_count ?? 0,
    created_at: row.created_at || null,
    completed_at: row.completed_at || null,
  };
}

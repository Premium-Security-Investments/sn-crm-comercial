import { createHash } from 'node:crypto';
import { normalizeTenderDocumentContent } from './tender-analysis-foundation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_OPERATOR_ERROR = Symbol('safe-agt002-fixed-snapshot-error');

function operatorError(message, status) {
  return Object.assign(new Error(message), { status, [SAFE_OPERATOR_ERROR]: true });
}

export function sanitizeAgt002FixedSnapshotError(error) {
  if (error?.[SAFE_OPERATOR_ERROR] === true) return error;
  return operatorError('No fue posible completar la reanálisis fija.', 500);
}

function requireUuid(value, label) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw operatorError(`${label} no es válido.`, 400);
  return normalized;
}

function parseRequest(body) {
  const expectedDocumentCount = Number(body?.expected_document_count);
  if (!Number.isSafeInteger(expectedDocumentCount) || expectedDocumentCount < 1 || expectedDocumentCount > 1000) {
    throw operatorError('El conteo documental esperado no es válido.', 400);
  }
  return {
    opportunityId: requireUuid(body?.opportunity_id, 'La oportunidad'),
    priorAnalysisRunId: requireUuid(body?.prior_analysis_run_id, 'La corrida previa'),
    expectedSnapshotId: requireUuid(body?.expected_snapshot_id, 'El snapshot esperado'),
    expectedDocumentCount,
  };
}

function assertSupportedRuntimeProfile(analysisConfig, autoAnalysisEnabled) {
  const canonical = analysisConfig?.AGT002_CANONICAL_ONLY;
  const retrieval = analysisConfig?.AGT002_DOCUMENT_RETRIEVAL;
  const legal = analysisConfig?.AGT002_LEGAL_CORPUS;
  const v3 = analysisConfig?.AGT002_INTEGRAL_CONTRACT_V3;
  const isE4Profile = legal === false && v3 === false;
  const isE5V3Profile = legal === true && v3 === true;
  if (canonical !== true || retrieval !== true || autoAnalysisEnabled !== true || !(isE4Profile || isE5V3Profile)) {
    throw operatorError('La reanálisis fija sólo está disponible con perfil canónico E4 (E5 y v3 apagadas) o perfil canónico E5/V3 (E5 y v3 activas), siempre con autoanálisis activo.', 409);
  }
}

function manifestIdentity(document, source) {
  const id = String(source === 'snapshot' ? document?.document_id : document?.id || '').trim();
  const hash = source === 'snapshot'
    ? String(document?.content_sha256 || '').trim().toLowerCase()
    : typeof document?.extracted_text === 'string'
      ? createHash('sha256').update(normalizeTenderDocumentContent(document.extracted_text), 'utf8').digest('hex')
      : '';
  if (!UUID_PATTERN.test(id) || !/^[0-9a-f]{64}$/.test(hash)) {
    throw operatorError('El manifiesto documental no permite comprobar la identidad exacta del snapshot.', 409);
  }
  return `${id}\0${hash}`;
}

function assertExactDocumentSet(snapshot, currentDocuments, expectedDocumentCount) {
  const manifestDocuments = snapshot?.document_manifest?.documents;
  const current = (currentDocuments || []).filter(document => document?.current !== false);
  if (!Array.isArray(manifestDocuments)
    || manifestDocuments.length !== expectedDocumentCount
    || current.length !== expectedDocumentCount) {
    throw operatorError('El conteo documental actual no coincide exactamente con el snapshot esperado.', 409);
  }
  const expected = manifestDocuments.map(document => manifestIdentity(document, 'snapshot')).sort();
  const actual = current.map(document => manifestIdentity(document, 'current')).sort();
  if (expected.some((identity, index) => identity !== actual[index])) {
    throw operatorError('El conjunto documental actual no coincide exactamente con el manifiesto del snapshot.', 409);
  }
}

function assertPriorRun(priorRun, request) {
  if (!priorRun
    || priorRun.id !== request.priorAnalysisRunId
    || priorRun.opportunity_id !== request.opportunityId
    || priorRun.snapshot_id !== request.expectedSnapshotId
    || priorRun.producer !== 'AGT-002'
    || priorRun.method !== 'agent_ai'
    || priorRun.status !== 'completed'
    || priorRun.canonical !== true) {
    throw operatorError('La corrida previa no es un análisis canónico AGT-002 válido para la oportunidad y el snapshot indicados.', 409);
  }
}

function assertSnapshot(snapshot, request, priorRun) {
  if (!snapshot
    || snapshot.id !== request.expectedSnapshotId
    || snapshot.opportunity_id !== request.opportunityId
    || snapshot.tender_id !== priorRun.tender_id
    || !UUID_PATTERN.test(String(snapshot.actor_id || ''))) {
    throw operatorError('El snapshot no pertenece exactamente a la corrida y oportunidad indicadas.', 409);
  }
}

function assertHumanActor(profile, expectedActorId) {
  const humanIdentity = profile?.identity_type === 'human' || profile?.identity_type == null;
  if (!profile
    || profile.id !== expectedActorId
    || !humanIdentity
    || profile.active !== true) {
    throw operatorError('El snapshot no tiene un actor humano activo autorizado para la reanálisis.', 409);
  }
}

/**
 * Operator-only orchestration for one AGT-002 fixed-snapshot rerun against an immutable
 * snapshot, supporting either the canonical E4 profile or the canonical E5/V3 profile.
 * Authentication and every invariant are checked before model delegation. This function
 * never imports documents and has no dependency on GO/NO-GO persistence.
 */
export async function runAgt002FixedSnapshotReanalysis({
  authorize, body, analysisConfig, autoAnalysisEnabled,
  loadPriorRun, loadSnapshot, loadCurrentDocuments, loadActorProfile, reanalyze,
}) {
  if (typeof authorize !== 'function' || authorize() !== true) {
    throw operatorError('No autorizado.', 403);
  }
  const request = parseRequest(body);
  assertSupportedRuntimeProfile(analysisConfig, autoAnalysisEnabled);

  const priorRun = await loadPriorRun(request.priorAnalysisRunId);
  assertPriorRun(priorRun, request);
  const snapshot = await loadSnapshot(request.expectedSnapshotId);
  assertSnapshot(snapshot, request, priorRun);
  const currentDocuments = await loadCurrentDocuments(request.opportunityId);
  assertExactDocumentSet(snapshot, currentDocuments, request.expectedDocumentCount);
  const actorProfile = await loadActorProfile(snapshot.actor_id);
  assertHumanActor(actorProfile, snapshot.actor_id);

  const result = await reanalyze({
    opportunityId: request.opportunityId,
    analysisRunId: request.priorAnalysisRunId,
    currentProfile: actorProfile,
  });
  const analysisRunId = result?.analysis?.run_id || result?.analysis?.analysis_run_id || result?.analysis?.id;
  if (!result || typeof result.status !== 'string' || !UUID_PATTERN.test(String(result.context_version_id || ''))
    || (result.status === 'completed' && !UUID_PATTERN.test(String(analysisRunId || '')))) {
    throw operatorError('La reanálisis E4 no devolvió una identidad persistida válida.', 502);
  }
  return {
    status: result.status,
    reused: result.reused === true,
    context_version_id: result.context_version_id,
    analysis_run_id: analysisRunId || null,
  };
}

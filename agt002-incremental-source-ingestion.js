import { randomUUID } from 'node:crypto';
import { requireAuthorizedLicitacionesAnalysisActor } from './agt002-incremental-authority.js';
import { buildAgt002IncrementalSignal, ingestAndSealAgt002IncrementalSignals } from './agt002-incremental-reanalysis-triggers.js';

function publicResult(result) {
  return {
    status: result.status,
    change_set_id: result.change_set_id || null,
    signal_ids: result.signal_ids || [],
    dispatch_required: result.status === 'sealed',
  };
}

export async function ingestAgt002HumanResponseSignal(database, {
  opportunityId,
  tenderId,
  profile,
  response,
  attachmentEvidence = [],
  ensureOpportunityAccess,
}) {
  if (!response?.id || !response?.responded_at) {
    throw new Error('La respuesta humana persistida no está disponible para registrar la señal incremental.');
  }
  let trustClass = 'trusted';
  try {
    await requireAuthorizedLicitacionesAnalysisActor({ database, opportunityId, profile, ensureOpportunityAccess });
  } catch (error) {
    if (error?.code !== 'AGT002_INCREMENTAL_ACTOR_UNAUTHORIZED') throw error;
    trustClass = 'pending_validation';
  }
  const content = JSON.stringify({
    question_id: String(response?.question_id || ''),
    question_text: String(response?.question_text || ''),
    status: String(response?.status || ''),
    response: String(response?.response || ''),
    evidence_notes: response?.evidence_notes == null ? null : String(response.evidence_notes),
    attachments: attachmentEvidence.map(item => ({
      name: String(item?.name || ''), mime_type: String(item?.mime_type || ''),
      size_bytes: Number(item?.size_bytes || 0), content_hash: String(item?.content_hash || ''),
    })).sort((left, right) => `${left.content_hash}\0${left.name}`.localeCompare(`${right.content_hash}\0${right.name}`)),
  });
  const signal = buildAgt002IncrementalSignal({
    triggerKind: 'human_interaction', trustClass,
    sourceTable: 'psi_tender_question_responses', sourceType: 'answer',
    sourceId: String(response.id), sourceVersion: String(response.responded_at || response.id),
    content, observedAt: String(response.responded_at), actorProfileId: profile.id,
  });
  const result = await ingestAndSealAgt002IncrementalSignals(database, {
    opportunityId, tenderId, sourceTransactionId: `human-response:${response.id}`, signals: [signal],
  });
  return publicResult(result);
}

export async function ingestAgt002OfficialDocumentBatchSignals(database, {
  opportunityId,
  tenderId,
  refreshResults,
  observedAt = new Date().toISOString(),
}) {
  const changed = refreshResults.filter(item => ['new', 'updated'].includes(item?.status)
    && item?.version?.id && item?.analysis_content_hash && item?.source_batch_id);
  if (changed.length === 0) return { status: 'unchanged', change_set_id: null, signal_ids: [], dispatch_required: false };
  const batchIds = [...new Set(changed.map(item => item.source_batch_id))];
  if (batchIds.length !== 1) throw new Error('El cierre oficial debe conservar exactamente un source_batch_id.');
  const signals = changed.map(item => buildAgt002IncrementalSignal({
    triggerKind: 'official_document', trustClass: 'trusted',
    sourceTable: 'psi_tender_document_versions', sourceType: String(item.document_type || 'official_document'),
    sourceId: String(item.source_document_id), sourceVersion: String(item.version.id),
    contentHash: String(item.analysis_content_hash), observedAt,
  }));
  const result = await ingestAndSealAgt002IncrementalSignals(database, {
    opportunityId, tenderId, sourceBatchId: batchIds[0],
    sourceTransactionId: `official-batch:${batchIds[0]}`, signals,
  });
  return publicResult(result);
}

export function createAgt002OfficialSourceBatchId() {
  return randomUUID();
}

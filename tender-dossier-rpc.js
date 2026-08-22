import { randomUUID } from 'node:crypto';
import { ACTIONS, requireAction } from './access-control.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_TYPES = new Set(['documento', 'pendiente_humano', 'general']);
const ITEM_ACTIONS = new Set(['status_changed', 'assigned', 'evidence_attached', 'marked_not_applicable', 'requirement_changed', 'reopened']);
const ITEM_STATUSES = new Set(['pendiente', 'en_progreso', 'listo', 'bloqueado']);
const EVIDENCE_KINDS = new Set(['texto', 'url']);
const CONTENT_KINDS = new Set(['markdown', 'texto', 'metadata']);
const REVIEW_DECISIONS = new Set(['aprobado', 'rechazado']);

function dossierError(message, status = 400, code = 'TENDER_DOSSIER_INVALID_INPUT') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requireUuid(value, label) {
  const text = String(value || '').trim();
  if (!UUID_PATTERN.test(text)) throw dossierError(`Debe indicar ${label}.`);
  return text.toLowerCase();
}

function nullableUuid(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, label);
}

function nullableText(value, max = 2000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function requiredText(value, label, max) {
  const text = nullableText(value, max);
  if (!text) throw dossierError(`Debe indicar ${label}.`);
  return text;
}

function nullableDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw dossierError('La fecha objetivo debe ser YYYY-MM-DD.');
  }
  return text;
}

function nullableHttpsUrl(value) {
  const text = nullableText(value, 2000);
  if (!text) return null;
  if (/\s/.test(text)) throw dossierError('La evidencia URL debe usar https y no contener espacios.');
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('invalid');
  } catch {
    throw dossierError('La evidencia URL debe usar https y ser válida.');
  }
  return text;
}

function mapDatabaseError(error) {
  if (error?.status) return error;
  const statusByCode = {
    '42501': 403,
    P0002: 404,
    '40001': 409,
    '23505': 409,
    '23514': 409,
    '22023': 409,
  };
  const mapped = new Error(error?.message || 'No fue posible operar el expediente.');
  mapped.status = statusByCode[error?.code] || 500;
  mapped.code = error?.code || 'TENDER_DOSSIER_DATABASE_ERROR';
  return mapped;
}

async function rpc(database, name, args) {
  if (!database?.rpc) throw dossierError('La base de datos del expediente no está disponible.', 503, 'TENDER_DOSSIER_UNAVAILABLE');
  const { data, error } = await database.rpc(name, args);
  if (error) throw mapDatabaseError(error);
  return data;
}

function actorId(currentProfile) {
  return requireUuid(currentProfile?.id, 'un actor válido');
}

function requireOperationalAccess(currentProfile) {
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  return actorId(currentProfile);
}

function requireManagerAccess(currentProfile) {
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
  return actorId(currentProfile);
}

function canApprove(currentProfile) {
  try {
    requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
    return true;
  } catch {
    return false;
  }
}

/**
 * `options.workbenchEnabled` es la única fuente de activación de la Mesa Vig-IA y debe
 * resolverla el servidor (gate de runtime) en cada solicitud. Fail-closed: sin la opción,
 * o con cualquier valor que no sea el booleano `true`, la mesa queda apagada. El valor
 * homónimo que pueda venir de la BD o del cliente se descarta siempre.
 */
export async function getTenderDossierWorkspace(database, opportunityId, currentProfile, options = {}) {
  const id = requireUuid(opportunityId, 'una oportunidad válida');
  requireOperationalAccess(currentProfile);
  const workspace = await rpc(database, 'psi_get_tender_dossier_workspace', { p_opportunity_id: id });
  const ready = workspace?.readiness?.ready === true;
  return {
    ...(workspace || {}),
    can_mark_ready: ready && canApprove(currentProfile),
    workbench_enabled: options?.workbenchEnabled === true,
  };
}

export async function callCreateTenderDossierItem(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const actor = requireOperationalAccess(currentProfile);
  const itemType = String(input?.item_type || '').trim();
  if (!ITEM_TYPES.has(itemType)) throw dossierError('Tipo de ítem inválido.');
  return rpc(database, 'psi_create_tender_dossier_item', {
    p_opportunity_id: opportunityId,
    p_actor_id: actor,
    p_item_key: nullableText(input?.item_key, 200) || randomUUID(),
    p_title: requiredText(input?.title, 'el título del ítem', 400),
    p_item_type: itemType,
    p_required: input?.required === true,
  });
}

export async function callAppendTenderDossierItemAction(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const itemId = requireUuid(input?.item_id, 'un ítem válido');
  const actionType = String(input?.action_type || '').trim();
  if (!ITEM_ACTIONS.has(actionType)) throw dossierError('Acción de ítem inválida.');
  const actor = actionType === 'marked_not_applicable'
    ? requireManagerAccess(currentProfile)
    : requireOperationalAccess(currentProfile);
  const toStatus = nullableText(input?.to_status, 40);
  if (actionType === 'status_changed' && !ITEM_STATUSES.has(toStatus)) throw dossierError('Estado de ítem inválido.');
  const evidenceKind = nullableText(input?.evidence_kind, 20);
  if (actionType === 'evidence_attached' && !EVIDENCE_KINDS.has(evidenceKind)) {
    throw dossierError('La evidencia requiere tipo texto o url.');
  }
  const evidenceText = nullableText(input?.evidence_text, 5000);
  const evidenceUrl = nullableHttpsUrl(input?.evidence_url);
  if (actionType === 'evidence_attached' && evidenceKind === 'texto' && !evidenceText) {
    throw dossierError('La evidencia de texto no puede estar vacía.');
  }
  if (actionType === 'evidence_attached' && evidenceKind === 'url' && !evidenceUrl) {
    throw dossierError('La evidencia URL debe usar https y ser válida.');
  }
  const justification = nullableText(input?.justification, 2000);
  if (actionType === 'marked_not_applicable' && !justification) {
    throw dossierError('Marcar no aplica requiere justificación.');
  }
  return rpc(database, 'psi_append_tender_dossier_item_action', {
    p_opportunity_id: opportunityId,
    p_item_id: itemId,
    p_actor_id: actor,
    p_action_type: actionType,
    p_to_status: actionType === 'status_changed' ? toStatus : null,
    p_assignee_id: nullableUuid(input?.assignee_id, 'un responsable válido'),
    p_target_date: nullableDate(input?.target_date),
    p_evidence_kind: actionType === 'evidence_attached' ? evidenceKind : null,
    p_evidence_text: actionType === 'evidence_attached' ? evidenceText : null,
    p_evidence_url: actionType === 'evidence_attached' ? evidenceUrl : null,
    p_justification: justification,
    p_note: nullableText(input?.note, 2000),
  });
}

export async function callCreateTenderDossierArtifact(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const actor = requireOperationalAccess(currentProfile);
  return rpc(database, 'psi_create_tender_dossier_artifact', {
    p_opportunity_id: opportunityId,
    p_actor_id: actor,
    p_artifact_key: nullableText(input?.artifact_key, 200) || randomUUID(),
    p_title: requiredText(input?.title, 'el título del documento', 400),
    p_required: input?.required === true,
  });
}

export async function callAddTenderDossierArtifactVersion(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const artifactId = requireUuid(input?.artifact_id, 'un documento válido');
  const actor = requireOperationalAccess(currentProfile);
  const contentKind = String(input?.content_kind || '').trim();
  if (!CONTENT_KINDS.has(contentKind)) throw dossierError('Tipo de contenido inválido.');
  let contentText = null;
  let contentMetadata = null;
  if (contentKind === 'metadata') {
    if (!input?.content_metadata || typeof input.content_metadata !== 'object' || Array.isArray(input.content_metadata)) {
      throw dossierError('La versión metadata requiere un objeto.');
    }
    contentMetadata = input.content_metadata;
  } else {
    contentText = requiredText(input?.content_text, 'el contenido de la versión', 100000);
  }
  return rpc(database, 'psi_add_tender_dossier_artifact_version', {
    p_opportunity_id: opportunityId,
    p_artifact_id: artifactId,
    p_actor_id: actor,
    p_content_kind: contentKind,
    p_content_text: contentText,
    p_content_metadata: contentMetadata,
  });
}

export async function callRecordTenderDossierArtifactReview(database, input, currentProfile) {
  const versionId = requireUuid(input?.version_id, 'una versión válida');
  const actor = requireManagerAccess(currentProfile);
  const decision = String(input?.decision || '').trim();
  if (!REVIEW_DECISIONS.has(decision)) throw dossierError('Decisión de revisión inválida.');
  const comment = nullableText(input?.comment, 5000);
  if (decision === 'rechazado' && !comment) throw dossierError('Rechazar requiere un comentario.');
  return rpc(database, 'psi_record_tender_dossier_artifact_review', {
    p_version_id: versionId,
    p_actor_id: actor,
    p_decision: decision,
    p_comment: comment,
  });
}

export async function callSeedTenderDossier(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const actor = requireManagerAccess(currentProfile);
  return rpc(database, 'psi_seed_tender_dossier', {
    p_opportunity_id: opportunityId,
    p_actor_id: actor,
  });
}

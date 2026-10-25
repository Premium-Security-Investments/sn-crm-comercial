// AGT-002 revisión accionable — helpers HTTP puros compartidos por
// `server/index.js` y `api/[...path].js` (paridad byte-semántica; design
// docs/superpowers/specs/2026-08-31-agt002-actionable-review-knowledge-design.md
// §7.1, §11, §12, §17-18). No contiene acceso a base de datos ni a Express:
// sólo construcción de recursos/errores/hashes de request cerrados, para que
// ambos backends inline llamen exactamente la misma lógica.

import { createHash, randomBytes } from 'node:crypto';
import { buildActionableReviewIntegralUnitSource, hashActionableReviewJson } from './agt002-actionable-review-canonical.js';
import {
  ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY,
  ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION,
} from './agt002-actionable-review-attachment-validation.js';

const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACTIONABLE_REVIEW_OUTCOMES = Object.freeze([
  'aclarado_con_soporte',
  'riesgo_confirmado',
  'no_aplica',
  'informacion_insuficiente',
]);

function actionableReviewError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function actionableReviewItemNotFoundError() {
  return actionableReviewError(404, 'review_item_not_found', 'La revisión indicada no existe o no está disponible.');
}

export function actionableReviewForbiddenError() {
  return actionableReviewError(403, 'review_action_forbidden', 'No tiene autorización para realizar esta operación sobre la revisión.');
}

export function invalidActionableReviewInputError(message) {
  return actionableReviewError(400, 'invalid_review_input', message);
}

// §7.2: las identidades no humanas (agente, técnica) nunca reciben ninguna de
// las cinco acciones nuevas; se rechazan antes de cualquier lookup del
// recurso, a diferencia del 404 uniforme de recurso inexistente/no visible.
export function requireHumanActionableReviewIdentity(profile) {
  if (profile?.identity_type != null && profile.identity_type !== 'human') {
    throw actionableReviewForbiddenError();
  }
}

// §7.1: el recurso es enteramente server-owned. area/subarea fijan la
// subárea Licitaciones (nunca la del propietario), owner_id es el dueño real
// de la oportunidad y assigned_profile_id la relación de asignación
// server-owned aplicable al recurso (ausente todavía para pendientes ->
// colaborador falla cerrado hasta que exista esa relación).
export function actionableReviewResource(ownerId, assignedProfileId = null) {
  return { area_code: 'comercial', subarea_code: 'licitaciones', owner_id: ownerId, assigned_profile_id: assignedProfileId };
}

function requireIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw invalidActionableReviewInputError('La clave de idempotencia debe ser un UUID.');
  }
  return value;
}

function requireBoundedText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 10000) {
    throw invalidActionableReviewInputError(`${label} debe tener entre 1 y 10000 caracteres.`);
  }
  return text;
}

// Cada constructor produce el payload semántico cerrado (§11) que se hashea
// con el único módulo canónico (§6.4); el servidor nunca acepta actor_id,
// origin ni request_hash del cliente.
export function validateActionableReviewCommentInput(body) {
  const comment = requireBoundedText(body?.comment, 'El comentario');
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  return { comment, idempotencyKey, requestHash: hashActionableReviewJson({ kind: 'actionable_review_comment', comment }) };
}

export function validateActionableReviewOutcomeInput(body) {
  const outcome = String(body?.outcome || '');
  if (!ACTIONABLE_REVIEW_OUTCOMES.includes(outcome)) throw invalidActionableReviewInputError('El resultado no es válido.');
  const note = requireBoundedText(body?.note, 'La nota de resolución');
  const reusableRequested = body?.reusable_requested === true;
  if (reusableRequested && outcome === 'informacion_insuficiente') {
    throw invalidActionableReviewInputError('reusable_requested sólo es válido cuando el resultado cierra el pendiente.');
  }
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  return {
    outcome,
    note,
    reusableRequested,
    idempotencyKey,
    requestHash: hashActionableReviewJson({ kind: 'actionable_review_outcome', outcome, note, reusable_requested: reusableRequested }),
  };
}

export function validateActionableReviewReopenInput(body) {
  const note = requireBoundedText(body?.note, 'La nota de reapertura');
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  return { note, idempotencyKey, requestHash: hashActionableReviewJson({ kind: 'actionable_review_reopen', note }) };
}

// §18: mapeo cerrado de errcode Postgres -> HTTP/código público. `23505` sólo
// lo levantan estas RPC para el mismatch de idempotencia (nunca otra
// violación), por lo que el mapeo directo es seguro.
const RPC_ERROR_STATUS_BY_CODE = {
  '22023': [400, 'invalid_review_input'],
  '28000': [403, 'review_action_forbidden'],
  P0002: [404, 'review_item_not_found'],
  '40001': [409, 'review_version_conflict'],
  '55000': [409, 'review_version_conflict'],
  '23505': [409, 'idempotency_payload_mismatch'],
};
export function mapActionableReviewRpcError(rpcError) {
  const mapped = RPC_ERROR_STATUS_BY_CODE[rpcError?.code];
  if (!mapped) return actionableReviewError(500, 'review_internal_error', 'No se pudo procesar la revisión accionable.');
  return actionableReviewError(mapped[0], mapped[1], rpcError.message || 'No se pudo procesar la revisión accionable.');
}

// §13.1: allowlist cerrada extensión <-> MIME declarado para adjuntos de
// soporte de la revisión accionable (nunca los prefijos de documentos
// oficiales ni de question-responses, §13.3). La tabla vive en el módulo de
// validación de bytes y se reutiliza aquí a propósito: la extensión/MIME que
// se admite al emitir el ticket y la que se exige sobre los bytes reales al
// completar deben ser literalmente la misma decisión, no dos copias.
export const ACTIONABLE_REVIEW_ATTACHMENT_MAX_BYTES = ACTIONABLE_REVIEW_ATTACHMENT_BYTE_POLICY.maxBytes;
export const ACTIONABLE_REVIEW_ATTACHMENT_DOWNLOAD_TTL_SECONDS = 120;

export function attachmentTypeNotAllowedError() {
  return actionableReviewError(415, 'attachment_type_not_allowed', 'El tipo de archivo no está permitido para adjuntos de la revisión accionable.');
}
export function attachmentTooLargeError() {
  return actionableReviewError(413, 'attachment_too_large', 'El archivo supera el límite de 25 MiB.');
}
export function attachmentTicketInvalidError() {
  return actionableReviewError(409, 'attachment_ticket_invalid', 'El ticket de carga no es válido, expiró, ya fue consumido o no coincide con los datos presentados.');
}
// §13.2 paso 5: ÚNICA respuesta pública para cualquier fallo de validación
// sobre los bytes reales (objeto ausente/ilegible, tamaño o hash distintos,
// MIME real distinto del declarado, contenedor OOXML inválido, ruta fuera del
// espacio de nombres aprobado). No distingue la causa ni revela si el objeto
// llegó a existir: quien la recibe sólo sabe que su propia carga no quedó
// registrada. El ticket NO se consume, así que reintentar con bytes correctos
// sigue siendo posible hasta que expire.
export function attachmentContentInvalidError() {
  return actionableReviewError(400, 'attachment_content_invalid', 'El contenido cargado no pudo validarse; vuelva a cargar el archivo.');
}

function actionableReviewAttachmentExtensionFromName(name) {
  const match = /\.[^./\\]+$/.exec(name);
  return match ? match[0].toLowerCase() : '';
}

// §13.1-13.2: valida nombre/traversal, allowlist extensión<->MIME, tamaño y
// hash SHA-256 declarado ANTES de firmar nada; el identificador lógico del
// adjunto es un token opaco de correlación del cliente, nunca interpretado
// ni validado como UUID en esta capa.
export function validateActionableReviewAttachmentUploadInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 140) throw invalidActionableReviewInputError('El nombre del archivo debe tener entre 1 y 140 caracteres.');
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw invalidActionableReviewInputError('El nombre del archivo contiene caracteres no permitidos.');
  }
  const logicalAttachmentId = typeof body?.logical_attachment_id === 'string' ? body.logical_attachment_id.trim() : '';
  if (!logicalAttachmentId) throw invalidActionableReviewInputError('Debe indicar el identificador lógico del adjunto.');
  const extension = actionableReviewAttachmentExtensionFromName(name);
  const mimeType = typeof body?.mime_type === 'string' ? body.mime_type : '';
  if (!extension || ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION[extension] !== mimeType) throw attachmentTypeNotAllowedError();
  const sizeBytes = Number(body?.size_bytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw invalidActionableReviewInputError('El tamaño del archivo no es válido.');
  if (sizeBytes > ACTIONABLE_REVIEW_ATTACHMENT_MAX_BYTES) throw attachmentTooLargeError();
  const sha256 = typeof body?.sha256 === 'string' ? body.sha256.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw invalidActionableReviewInputError('Debe indicar el SHA-256 declarado del archivo.');
  return { name, extension, mimeType, sizeBytes, sha256, logicalAttachmentId };
}

export function buildActionableReviewAttachmentUploadRequestHash({ logicalAttachmentId, version, name, extension, mimeType, sizeBytes, sha256 }) {
  return hashActionableReviewJson({
    kind: 'actionable_review_attachment_upload_ticket',
    logical_attachment_id: logicalAttachmentId, version, name, extension, mime_type: mimeType, size_bytes: sizeBytes, sha256,
  });
}

// §9.4: entropy for the upload-ticket nonce is entirely Node-owned —
// `crypto.randomBytes` is a CSPRNG independent of anything the SQL layer
// computes. Only the SHA-256 digest of the returned hex string is ever handed
// to the issue RPC/persisted as `nonce_hash`; the plaintext is returned to the
// caller exactly once, straight from this same call site, and the RPC never
// receives or stores it.
const ACTIONABLE_REVIEW_UPLOAD_TICKET_NONCE_BYTES = 32;
export function generateActionableReviewUploadTicketNonce() {
  return randomBytes(ACTIONABLE_REVIEW_UPLOAD_TICKET_NONCE_BYTES).toString('hex');
}
export function hashActionableReviewUploadTicketNonce(nonce) {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

// §9.4: closed canonical hash binding the ticket's Node-known semantic fields
// (item/opportunity/actor identity, logical attachment slot and the declared
// file contract). `ticket_id` and `expires_at` are DB-generated and
// deliberately excluded: Node cannot know them before the issue RPC creates
// the row, and it doesn't need to — the row's primary key, the append-only
// guard trigger and the global uniqueness of `storage_path` already bind
// those generated fields to this exact ticket.
export function buildActionableReviewAttachmentTicketPayloadHash({
  reviewItemId, opportunityId, actorId, logicalAttachmentId, version, name, extension, mimeType, sizeBytes, sha256,
}) {
  return hashActionableReviewJson({
    kind: 'actionable_review_attachment_ticket_payload',
    review_item_id: reviewItemId, opportunity_id: opportunityId, actor_id: actorId,
    logical_attachment_id: logicalAttachmentId, version, name, extension, mime_type: mimeType, size_bytes: sizeBytes, sha256,
  });
}

export function validateActionableReviewAttachmentCompleteInput(body) {
  const ticketId = typeof body?.ticket_id === 'string' ? body.ticket_id.trim() : '';
  const nonce = typeof body?.nonce === 'string' ? body.nonce.trim() : '';
  if (!ticketId || !nonce) throw invalidActionableReviewInputError('Debe indicar el ticket y el nonce de carga.');
  return { ticketId, nonce };
}

export function buildActionableReviewAttachmentCompleteRequestHash({ ticketId, nonce }) {
  return hashActionableReviewJson({ kind: 'actionable_review_attachment_complete', ticket_id: ticketId, nonce });
}

// §9.4/§13.2: único punto de mapeo para las RPC de ticket/adjunto — el
// errcode 55000 genérico de `psi_reject_agt002_review_attachment_ticket` se
// traduce siempre al mismo 409 `attachment_ticket_invalid`, nunca al
// `review_version_conflict` genérico del resto de rutas de revisión.
export function mapActionableReviewAttachmentRpcError(rpcError) {
  const message = rpcError?.message || '';
  if (rpcError?.code === '55000' && message.startsWith('attachment_ticket_invalid')) return attachmentTicketInvalidError();
  if (rpcError?.code === '22023' && message.startsWith('attachment_type_not_allowed')) return attachmentTypeNotAllowedError();
  if (rpcError?.code === '22023' && message.startsWith('attachment_too_large')) return attachmentTooLargeError();
  return mapActionableReviewRpcError(rpcError);
}

// AGT-002 conocimiento — GREEN 4C: helpers HTTP puros para las rutas de
// `psi_tender_knowledge_*` (design §§9.6-9.10, 10.2, 11, 12, 15, 18). Mismo
// patrón que arriba: sin acceso a base de datos ni Express, sólo
// validación/construcción de payload cerrado y mapeo de errores RPC, para que
// ambos backends inline compartan exactamente la misma lógica.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWLEDGE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const TENDER_KNOWLEDGE_SCOPE_TYPES = Object.freeze(['general', 'regional', 'cliente', 'tipo_servicio']);
export const TENDER_KNOWLEDGE_CONFIDENTIALITY_VALUES = Object.freeze(['interno', 'restringido']);
// §10.2: mapeo cerrado evento -> estado proyectado, espejo de
// `psi_agt002_knowledge_version_status` en SQL; usado por el handler de
// publish para exigir "sólo una versión aprobada vigente" antes de tocar
// SharePoint, nunca después.
export const TENDER_KNOWLEDGE_STATUS_BY_EVENT_TYPE = Object.freeze({
  draft_created: 'borrador',
  submitted: 'pendiente_aprobacion',
  approved: 'pendiente_aprobacion',
  rejected: 'rechazado',
  published: 'publicado',
  replaced: 'reemplazado',
});

export function knowledgeStateConflictError(message) {
  return actionableReviewError(409, 'knowledge_state_conflict', message);
}
export function knowledgeGeneratorUnavailableError() {
  return actionableReviewError(503, 'knowledge_generator_unavailable', 'El generador de conocimiento no está disponible en este momento.');
}
export function knowledgeSanitizationFailedError(message) {
  return actionableReviewError(422, 'knowledge_sanitization_failed', message);
}
export function sharepointPublicationUnavailableError() {
  return actionableReviewError(503, 'sharepoint_publication_unavailable', 'La publicación en SharePoint no está disponible en este momento.');
}
export function sharepointPublicationConflictError() {
  return actionableReviewError(409, 'review_version_conflict', 'La publicación en SharePoint tiene un conflicto de versión; actualice y confirme de nuevo.');
}

// §18: `55000` con mensaje `knowledge_state_conflict:` es el único código que
// las RPC de conocimiento levantan para transición inválida/versión
// reemplazada; todo lo demás (22023/28000/P0002/40001/23505) reutiliza el
// mapeo genérico de revisión accionable.
export function mapTenderKnowledgeRpcError(rpcError) {
  const message = rpcError?.message || '';
  if (rpcError?.code === '55000' && message.startsWith('knowledge_state_conflict')) {
    return knowledgeStateConflictError(message);
  }
  return mapActionableReviewRpcError(rpcError);
}

function requireUuidValue(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw invalidActionableReviewInputError(`${label} debe ser un UUID.`);
  return value;
}
function requireKnowledgeDate(value, label) {
  if (typeof value !== 'string' || !KNOWLEDGE_DATE_PATTERN.test(value)) throw invalidActionableReviewInputError(`${label} debe ser una fecha con formato AAAA-MM-DD.`);
  return value;
}
function requireKnowledgeTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw invalidActionableReviewInputError('Las etiquetas deben ser un arreglo de máximo 20 valores.');
  for (const tag of value) {
    if (typeof tag !== 'string' || tag.length < 1 || tag.length > 64) throw invalidActionableReviewInputError('Cada etiqueta debe tener entre 1 y 64 caracteres.');
  }
  return [...value];
}
function requireSanitizationAttestation(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 20 || text.length > 2000) throw invalidActionableReviewInputError('La atestación de saneamiento debe tener entre 20 y 2000 caracteres.');
  return text;
}
function requireReusableSummary(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 4000) throw invalidActionableReviewInputError('El resumen reutilizable debe tener entre 1 y 4000 caracteres.');
  return text;
}
function requireKnowledgeConfidentiality(value, agentReuseAllowed) {
  if (!TENDER_KNOWLEDGE_CONFIDENTIALITY_VALUES.includes(value)) throw invalidActionableReviewInputError('La confidencialidad no es válida.');
  if (value === 'restringido' && agentReuseAllowed === true) {
    throw invalidActionableReviewInputError('agent_reuse_allowed no puede ser verdadero cuando la confidencialidad es restringido.');
  }
  return value;
}
function requireKnowledgeValidityWindow({ validFrom, validUntil, reviewOn }) {
  if (validUntil !== null) {
    if (!(validUntil > validFrom)) throw invalidActionableReviewInputError('valid_until debe ser posterior a valid_from.');
    if (!(reviewOn >= validFrom && reviewOn <= validUntil)) throw invalidActionableReviewInputError('review_on debe estar entre valid_from y valid_until.');
  } else if (!(reviewOn > validFrom)) {
    throw invalidActionableReviewInputError('review_on debe ser posterior a valid_from cuando no hay valid_until.');
  }
}

// §9.7/§11/§15: entrada cerrada para crear manualmente la versión sucesora de
// una ficha de conocimiento ya existente (`psi_add_tender_knowledge_version`).
export function validateTenderKnowledgeVersionInput(body) {
  const reusableSummary = requireReusableSummary(body?.reusable_summary);
  const validFrom = requireKnowledgeDate(body?.valid_from, 'valid_from');
  const validUntil = body?.valid_until === null || body?.valid_until === undefined ? null : requireKnowledgeDate(body.valid_until, 'valid_until');
  const reviewOn = requireKnowledgeDate(body?.review_on, 'review_on');
  requireKnowledgeValidityWindow({ validFrom, validUntil, reviewOn });
  const tags = requireKnowledgeTags(body?.tags);
  const agentReuseAllowed = body?.agent_reuse_allowed === true;
  const confidentiality = requireKnowledgeConfidentiality(body?.confidentiality, agentReuseAllowed);
  const responsibleProfileId = requireUuidValue(body?.responsible_profile_id, 'responsible_profile_id');
  const sanitizationAttestation = requireSanitizationAttestation(body?.sanitization_attestation);
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  const requestHash = hashActionableReviewJson({
    kind: 'tender_knowledge_version', reusable_summary: reusableSummary, valid_from: validFrom, valid_until: validUntil,
    review_on: reviewOn, tags, confidentiality, agent_reuse_allowed: agentReuseAllowed,
    responsible_profile_id: responsibleProfileId, sanitization_attestation: sanitizationAttestation,
  });
  return { reusableSummary, validFrom, validUntil, reviewOn, tags, confidentiality, agentReuseAllowed, responsibleProfileId, sanitizationAttestation, idempotencyKey, requestHash };
}

export function validateTenderKnowledgeSubmitInput(body) {
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  return { idempotencyKey, requestHash: hashActionableReviewJson({ kind: 'tender_knowledge_submit' }) };
}
export function validateTenderKnowledgeApproveInput(body) {
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  return { idempotencyKey, requestHash: hashActionableReviewJson({ kind: 'tender_knowledge_approve' }) };
}
export function validateTenderKnowledgePublishInput(body) {
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  return { idempotencyKey, requestHash: hashActionableReviewJson({ kind: 'tender_knowledge_publish' }) };
}
export function validateTenderKnowledgeRejectInput(body) {
  const note = requireBoundedText(body?.note, 'La nota de rechazo');
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  return { note, idempotencyKey, requestHash: hashActionableReviewJson({ kind: 'tender_knowledge_reject', note }) };
}

// §14.1: entrada de la persona para arrancar la generación (alcance elegido +
// idempotencia); el resto de la entrada del generador es server-owned.
export function validateTenderKnowledgeCandidateGenerateInput(body) {
  const scopeType = String(body?.scope_type || '');
  if (!TENDER_KNOWLEDGE_SCOPE_TYPES.includes(scopeType)) throw invalidActionableReviewInputError('El alcance no es válido.');
  let scopeValue = null;
  if (scopeType === 'general') {
    if (body?.scope_value != null && body.scope_value !== '') throw invalidActionableReviewInputError('El alcance general no admite scope_value.');
  } else {
    scopeValue = typeof body?.scope_value === 'string' ? body.scope_value.trim() : '';
    if (!scopeValue) throw invalidActionableReviewInputError(`El alcance ${scopeType} requiere scope_value.`);
  }
  const idempotencyKey = requireIdempotencyKey(body?.idempotency_key);
  return { scopeType, scopeValue, idempotencyKey };
}

// §10.1/§12.2: forma completa y segura de la lista — nunca storage_path,
// unit_id, source_hash, tickets/nonces, request hashes ni eTags. Todo lo que
// sigue es proyección pura sobre filas ya cargadas por el servidor (batch,
// sin N+1): la ruta HTTP resuelve las consultas y esta función sólo deriva
// el estado/conteos/timeline/summary a partir de ellas.
export const ACTIONABLE_REVIEW_TIMELINE_MAX_EVENTS = 200;
const ACTIONABLE_REVIEW_CLOSED_OUTCOMES = new Set(['aclarado_con_soporte', 'riesgo_confirmado', 'no_aplica']);
const ACTIONABLE_REVIEW_OPEN_STATES = new Set(['pendiente', 'en_revision', 'reabierto']);

// §10.1: espejo puro de `psi_agt002_review_resolution_is_vigente` — el estado
// y el resultado vigente siguen el último evento de ciclo de vida relevante
// (`outcome_recorded` con un resultado que cierra, o `reopened`), nunca
// simplemente el último evento por timestamp; un comentario o adjunto
// posterior a un cierre no lo reabre en silencio.
export function deriveActionableReviewItemLifecycle(eventsAscending) {
  let state = eventsAscending.length ? 'en_revision' : 'pendiente';
  let outcome = null;
  let resolutionEventId = null;
  for (const event of eventsAscending) {
    if (event.event_type === 'outcome_recorded' && ACTIONABLE_REVIEW_CLOSED_OUTCOMES.has(event.outcome)) {
      state = 'resuelto';
      outcome = event.outcome;
      resolutionEventId = event.id;
    } else if (event.event_type === 'reopened') {
      state = 'reabierto';
      outcome = null;
      resolutionEventId = null;
    }
  }
  return { state, outcome, resolutionEventId };
}

// El texto de un comentario viaja en la misma columna `note` que la nota de
// resultado/reapertura; se bifurca aquí por event_type para que el frontend
// nunca tenga que adivinar cuál de los dos campos leer.
function projectActionableReviewTimelineEvent(event, profileNameById) {
  const isComment = event.event_type === 'comment_added';
  return {
    id: event.id,
    sequence: event.sequence,
    event_type: event.event_type,
    comment: isComment ? (event.note ?? null) : null,
    outcome: event.outcome ?? null,
    note: isComment ? null : (event.note ?? null),
    reusable_requested: event.reusable_requested ?? null,
    attachment_id: event.attachment_id ?? null,
    actor_id: event.actor_id,
    actor_name: profileNameById.get(event.actor_id) ?? null,
    created_at: event.created_at,
  };
}

function projectActionableReviewAttachment(attachment) {
  return {
    id: attachment.id,
    logical_attachment_id: attachment.logical_attachment_id,
    version: attachment.version,
    name: attachment.name,
    declared_mime_type: attachment.declared_mime_type,
    size_bytes: attachment.size_bytes,
    uploaded_at: attachment.uploaded_at,
  };
}

function sortAscendingBySequence(rows) {
  return rows.slice().sort((a, b) => a.sequence - b.sequence);
}

function sortAscendingByUpload(rows) {
  return rows.slice().sort((a, b) => {
    if (a.uploaded_at < b.uploaded_at) return -1;
    if (a.uploaded_at > b.uploaded_at) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// items: filas crudas `id,requirement_id`; eventsByItemId/attachmentsByItemId:
// Map<review_item_id, fila[]> ya cargados por la ruta en consultas batch;
// supportsCountByResolutionEventId: Map<resolution_event_id, count> de la
// única consulta adicional de soportes (sólo para las resoluciones vigentes
// encontradas, nunca por ítem); profileNameById: Map<actor_id, full_name>;
// canContribute/canResolve: booleanos ya calculados por `can(...)` sobre el
// recurso de la oportunidad (idénticos para todos los ítems de una misma
// respuesta — la identidad agente nunca llega aquí con capacidades true).
export function projectActionableReviewList({
  items, eventsByItemId, attachmentsByItemId, supportsCountByResolutionEventId, profileNameById, canContribute, canResolve,
}) {
  const capabilities = { can_contribute: canContribute === true, can_resolve: canResolve === true };
  const projectedItems = items.map((item) => {
    const eventsAscending = sortAscendingBySequence(eventsByItemId.get(item.id) || []);
    const { state, outcome, resolutionEventId } = deriveActionableReviewItemLifecycle(eventsAscending);
    const commentCount = eventsAscending.filter(event => event.event_type === 'comment_added').length;
    const attachmentCount = eventsAscending.filter(event => event.event_type === 'attachment_added').length;
    const currentSupportsCount = resolutionEventId != null ? (supportsCountByResolutionEventId.get(resolutionEventId) || 0) : 0;
    const sequence = eventsAscending.length ? eventsAscending[eventsAscending.length - 1].sequence : 0;
    const timelineTruncated = eventsAscending.length > ACTIONABLE_REVIEW_TIMELINE_MAX_EVENTS;
    const timeline = eventsAscending
      .slice(Math.max(0, eventsAscending.length - ACTIONABLE_REVIEW_TIMELINE_MAX_EVENTS))
      .map(event => projectActionableReviewTimelineEvent(event, profileNameById));
    const attachments = sortAscendingByUpload(attachmentsByItemId.get(item.id) || []).map(projectActionableReviewAttachment);
    return {
      id: item.id,
      requirement_id: item.requirement_id ?? null,
      state,
      outcome,
      sequence,
      comment_count: commentCount,
      attachment_count: attachmentCount,
      current_supports_count: currentSupportsCount,
      capabilities,
      timeline,
      timeline_truncated: timelineTruncated,
      attachments,
    };
  });
  const openCount = projectedItems.filter(item => ACTIONABLE_REVIEW_OPEN_STATES.has(item.state)).length;
  const confirmedRiskCount = projectedItems.filter(item => item.state === 'resuelto' && item.outcome === 'riesgo_confirmado').length;
  return { items: projectedItems, summary: { open_count: openCount, confirmed_risk_count: confirmedRiskCount } };
}

// AGT-002 revisión accionable — GREEN 5C1: puente de "primera acción" que
// materializa la identidad estable del pendiente (design §§6.1-6.4, 11, 12.1,
// 18). Mismo patrón puro que arriba: sin base de datos ni Express. El cuerpo
// es CERRADO — el navegador sólo elige a qué origen ya existente en el
// resultado canónico se refiere; `tender_id`, `source_hash`, la proyección
// canónica y cualquier otra clave se rechazan explícitamente, nunca se
// ignoran en silencio.
export const ACTIONABLE_REVIEW_SOURCE_KINDS = Object.freeze(['integral_unit', 'decision_review_finding']);
// §6.1/§6.2: sólo `integral_unit` es revalidable hoy. `decision_review` es una
// vista derivada y no persistida del resultado, así que el servidor no puede
// volver a localizar el hallazgo dentro de un payload inmutable ni hashear una
// proyección estable; materializar una raíz sobre eso sería fabricar identidad
// desde texto, que §6.2 prohíbe. Se rechaza de forma explícita hasta que exista
// esa persistencia, en vez de degradar a un ID de respaldo.
export const ACTIONABLE_REVIEW_ENSURABLE_SOURCE_KINDS = Object.freeze(['integral_unit']);
const ACTIONABLE_REVIEW_ENSURE_BODY_KEYS = Object.freeze([
  'opportunity_id', 'analysis_run_id', 'source_kind', 'source_id', 'idempotency_key',
]);
const ACTIONABLE_REVIEW_SOURCE_ID_MAX_LENGTH = 120;

// §18: 409 `review_version_conflict` cubre "secuencia/hash/corrida cambió" —
// aquí, un origen ambiguo (unit_id duplicado), una unidad que ya no cumple el
// contrato cerrado, o una identidad ya registrada con otro `source_hash`.
export function actionableReviewSourceVersionConflictError() {
  return actionableReviewError(409, 'review_version_conflict', 'El origen del pendiente cambió en el resultado canónico de la corrida; actualice el análisis y vuelva a intentarlo.');
}

export function validateEnsureActionableReviewItemInput(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidActionableReviewInputError('El cuerpo de la solicitud no es válido.');
  }
  for (const key of Object.keys(body)) {
    if (!ACTIONABLE_REVIEW_ENSURE_BODY_KEYS.includes(key)) {
      throw invalidActionableReviewInputError('El cuerpo sólo admite opportunity_id, analysis_run_id, source_kind, source_id e idempotency_key; el servidor deriva la licitación, la proyección canónica y su hash.');
    }
  }
  const opportunityId = requireUuidValue(body.opportunity_id, 'opportunity_id');
  const analysisRunId = requireUuidValue(body.analysis_run_id, 'analysis_run_id');
  const sourceKind = typeof body.source_kind === 'string' ? body.source_kind : '';
  if (!ACTIONABLE_REVIEW_SOURCE_KINDS.includes(sourceKind)) throw invalidActionableReviewInputError('El origen del pendiente no es válido.');
  if (!ACTIONABLE_REVIEW_ENSURABLE_SOURCE_KINDS.includes(sourceKind)) {
    throw invalidActionableReviewInputError('Sólo las unidades del análisis integral V3 pueden materializar una identidad revisable; los hallazgos de decision_review son derivados y no persistidos, y no admiten revalidación en servidor.');
  }
  const sourceId = typeof body.source_id === 'string' ? body.source_id.trim() : '';
  if (!sourceId || sourceId.length > ACTIONABLE_REVIEW_SOURCE_ID_MAX_LENGTH) {
    throw invalidActionableReviewInputError(`source_id debe tener entre 1 y ${ACTIONABLE_REVIEW_SOURCE_ID_MAX_LENGTH} caracteres.`);
  }
  // La RPC de ensure es idempotente por su clave única (analysis_run_id,
  // source_kind, source_id) y no recibe key ni request_hash, así que la clave
  // opcional sólo se valida en forma y jamás se reenvía como argumento.
  if (body.idempotency_key !== undefined && body.idempotency_key !== null) requireIdempotencyKey(body.idempotency_key);
  return { opportunityId, analysisRunId, sourceKind, sourceId };
}

// §6.2/§6.4: localiza la unidad EXACTA dentro del resultado inmutable de la
// corrida por su `unit_id` estructural y construye la proyección/hash cerrados.
// Origen ausente = el mismo 404 que un recurso inexistente (un source_id
// forjado nunca revela nada); origen ambiguo o malformado = 409 cerrado.
export function resolveActionableReviewIntegralUnitSource(result, sourceId) {
  const units = Array.isArray(result?.integral_analysis?.analysis_units) ? result.integral_analysis.analysis_units : [];
  const matches = units.filter(unit => unit !== null && typeof unit === 'object' && !Array.isArray(unit) && unit.unit_id === sourceId);
  if (matches.length === 0) throw actionableReviewItemNotFoundError();
  if (matches.length > 1) throw actionableReviewSourceVersionConflictError();
  try {
    return buildActionableReviewIntegralUnitSource(matches[0]);
  } catch {
    throw actionableReviewSourceVersionConflictError();
  }
}

// §11: la RPC de ensure levanta `23514` para el conflicto de `source_hash`
// (identidad ya registrada con otra proyección). El resto reutiliza el mapeo
// genérico; se mantiene local para no cambiar el significado de `23514` en las
// demás rutas, donde lo levantan constraints distintas.
export function mapEnsureActionableReviewItemRpcError(rpcError) {
  if (rpcError?.code === '23514') return actionableReviewSourceVersionConflictError();
  return mapActionableReviewRpcError(rpcError);
}

// §12.2: la respuesta de ensure es la misma forma mínima y pública del listado
// — nunca source_hash, unit_id, tender_id ni ruta de almacenamiento.
export function projectEnsuredActionableReviewItem(item) {
  return { id: item.id, requirement_id: item.requirement_id ?? null, status: 'pendiente', created_at: item.created_at };
}

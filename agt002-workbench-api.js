import { ACTIONS, requireAction } from './access-control.js';
import {
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
} from './agt002-workbench-contract.js';
import {
  appendAgt002HumanMessage,
  computeAgt002WorkbenchIdempotencyKey,
  getAgt002Workbench,
  retryAgt002WorkbenchJob,
  reviewAgt002LearningProposal,
} from './agt002-workbench-persistence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_KEYS = Object.freeze([
  'opportunity_id', 'thread_id', 'client_message_id', 'content', 'context_links',
  'capability_id', 'snapshot_id', 'base_version_id',
]);
const RETRY_KEYS = Object.freeze(['opportunity_id', 'job_id']);
const REVIEW_KEYS = Object.freeze(['opportunity_id', 'proposal_id', 'decision', 'scope', 'comment']);

function apiError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function assertEnabled(options) {
  if (options?.enabled !== true) {
    throw apiError('La Mesa de trabajo de Vig-IA está desactivada.', 503, 'AGT002_WORKBENCH_DISABLED');
  }
}

function exactBody(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== expected.length
    || !expected.every(key => Object.hasOwn(value, key))) {
    throw apiError('El body contiene claves inesperadas; actor_id no está permitido.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
}

function uuid(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw apiError(`${label} debe ser UUID.`, 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  return value.toLowerCase();
}

function actor(profile, action) {
  try {
    requireAction(profile, action);
  } catch (error) {
    throw apiError(error?.message || 'No tiene autorización para realizar esta operación.', 403, 'AGT002_WORKBENCH_FORBIDDEN');
  }
  return uuid(profile?.id, 'El actor autenticado');
}

function mapDatabaseError(error) {
  if (error?.code === 'AGT002_WORKBENCH_DISABLED') return error;
  const mapped = new Error(error?.message || 'No fue posible operar la Mesa de trabajo.');
  const publicError = ({
    '42501': [403, 'AGT002_WORKBENCH_FORBIDDEN'],
    P0002: [404, 'AGT002_WORKBENCH_NOT_FOUND'],
    '23505': [409, 'AGT002_WORKBENCH_IN_PROGRESS'],
    '23514': [409, 'AGT002_WORKBENCH_IN_PROGRESS'],
    '22023': [400, 'AGT002_WORKBENCH_BAD_REQUEST'],
    '55000': [409, 'AGT002_WORKBENCH_IN_PROGRESS'],
  })[error?.code] || (error?.status === 403
    ? [403, 'AGT002_WORKBENCH_FORBIDDEN']
    : error?.status === 404
      ? [404, 'AGT002_WORKBENCH_NOT_FOUND']
      : error?.status === 409
        ? [409, 'AGT002_WORKBENCH_IN_PROGRESS']
        : error?.status === 400
          ? [400, 'AGT002_WORKBENCH_BAD_REQUEST']
          : [503, 'AGT002_WORKBENCH_UNAVAILABLE']);
  [mapped.status, mapped.code] = publicError;
  return mapped;
}

async function mapped(operation) {
  try {
    return await operation();
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

export async function getAgt002WorkbenchApi(database, opportunityId, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_USE);
  const id = uuid(opportunityId, 'opportunity_id');
  return mapped(async () => ({ enabled: true, ...(await getAgt002Workbench(database, { opportunityId: id, actorId })) }));
}

export async function postAgt002MessageApi(database, body, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_USE);
  exactBody(body, MESSAGE_KEYS);
  const opportunityId = uuid(body.opportunity_id, 'opportunity_id');
  const threadId = uuid(body.thread_id, 'thread_id');
  const messageId = uuid(body.client_message_id, 'client_message_id');
  const snapshotId = uuid(body.snapshot_id, 'snapshot_id');
  const baseVersionId = uuid(body.base_version_id, 'base_version_id', true);
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 12000 || !Array.isArray(body.context_links)) {
    throw apiError('content o context_links no es válido.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  const idempotencyKey = computeAgt002WorkbenchIdempotencyKey({
    threadId,
    originMessageId: messageId,
    snapshotId,
    capabilityId: body.capability_id,
    contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
    policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
    baseVersionId,
  });
  return mapped(() => appendAgt002HumanMessage(database, {
    opportunityId,
    actorId,
    threadId,
    messageId,
    content: body.content.trim(),
    contextLinks: body.context_links,
    idempotencyKey,
    contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
    policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
    capabilityId: body.capability_id,
    snapshotId,
    baseVersionId,
  }));
}

export async function postAgt002RetryApi(database, body, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_USE);
  exactBody(body, RETRY_KEYS);
  return mapped(() => retryAgt002WorkbenchJob(database, {
    opportunityId: uuid(body.opportunity_id, 'opportunity_id'),
    actorId,
    jobId: uuid(body.job_id, 'job_id'),
  }));
}

export async function postAgt002LearningReviewApi(database, body, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_CUSTODY);
  exactBody(body, REVIEW_KEYS);
  if (!['approved', 'rejected'].includes(body.decision)) {
    throw apiError('decision no es válida.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  return mapped(() => reviewAgt002LearningProposal(database, {
    opportunityId: uuid(body.opportunity_id, 'opportunity_id'),
    actorId,
    proposalId: uuid(body.proposal_id, 'proposal_id'),
    decision: body.decision,
    scope: body.scope,
    comment: body.comment,
  }));
}

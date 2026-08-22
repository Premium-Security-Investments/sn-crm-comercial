import { ACTIONS, requireAction } from './access-control.js';
import {
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
} from './agt002-workbench-contract.js';
import { buildAgt002WorkbenchInitialReference } from './agt002-workbench-context.js';
import {
  appendAgt002HumanMessage,
  computeAgt002WorkbenchIdempotencyKey,
  getAgt002Workbench,
  getLatestCanonicalAgt002AnalysisRun,
  getOrCreateAgt002WorkbenchThread,
  retryAgt002WorkbenchJob,
  reviewAgt002LearningProposal,
} from './agt002-workbench-persistence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * Closed message body, preserved key-for-key for compatibility with clients already in
 * production. `snapshot_id` and `context_links` remain accepted and are still validated as
 * well-formed, but they are NOT authoritative: the server re-derives the canonical
 * reference on every POST and overwrites both before persisting or hashing anything.
 */
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
  // An error this module already shaped (gate, bad request, missing canonical analysis)
  // is already public and mapped; re-mapping it would flatten it into a generic 503.
  if (typeof error?.code === 'string' && error.code.startsWith('AGT002_WORKBENCH_')) return error;
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

/**
 * Server-derived canonical reference for an opportunity — the single admissible provenance
 * of everything a Mesa freezes, used identically by the GET (initial reference) and by every
 * POST (persisted snapshot + context links). Fails closed: an opportunity with no completed
 * canonical Vig-IA run has no admissible starting point for a Mesa, and the alternative —
 * inventing a snapshot id so the composer looks usable — would queue work against a case that
 * was never analysed. The run's own `opportunity_id` is re-checked here (the loader already
 * filters by it) so no reference can ever carry another dossier's provenance. The mapped
 * error carries no identifiers.
 */
async function resolveCanonicalReference(database, opportunityId) {
  const run = await getLatestCanonicalAgt002AnalysisRun(database, { opportunityId });
  if (!run) {
    throw apiError(
      'La Mesa Vig-IA requiere un análisis canónico Vig-IA completado de esta oportunidad.',
      409, 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS',
    );
  }
  if (typeof run.opportunity_id !== 'string' || run.opportunity_id.toLowerCase() !== opportunityId) {
    throw apiError(
      'El análisis canónico Vig-IA leído no pertenece a esta oportunidad.',
      409, 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS',
    );
  }
  try {
    return buildAgt002WorkbenchInitialReference(run);
  } catch {
    throw apiError(
      'El análisis canónico Vig-IA de esta oportunidad no ofrece una referencia inicial válida para la Mesa.',
      409, 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS',
    );
  }
}

/**
 * Job event types the append-only log admits (migration 045) mapped to the status the human
 * surface may act on. `released` is a re-queue (retry or expired-lease sweep), so it reads as
 * queued again. `failed` is the only retryable status, and it is the only one the composer
 * offers a retry for, because `psi_retry_agt002_workbench_job` accepts exactly that event.
 *
 * `stale` is terminal but deliberately NOT mapped to `failed`: both of its emitters (045)
 * raise it when the dossier artifact moved past the job's frozen `base_version_id`, and the
 * job row is append-only, so re-queueing it would re-run against the same stale base version
 * and go stale again on every attempt. Offering a retry there would promise a recovery the
 * system cannot deliver; the real recovery is a new message over the current version, which
 * the composer already supports. So it gets its own visible terminal status instead.
 */
const JOB_EVENT_STATUS = Object.freeze({
  queued: 'queued',
  released: 'queued',
  claimed: 'in_progress',
  completed: 'completed',
  failed: 'failed',
  stale: 'obsolete',
});

/**
 * Truthful job status from the job's latest event, which migration 070 projects into the read
 * RPC as `latest_event_type` (ordered created_at desc, id desc — the same ordering the claim and
 * lease sweep already use). Fails conservatively: an unknown or missing event type is never
 * reported as `completed` (that would assert a terminal result nobody persisted) and never as
 * `failed` (that would offer a retry the database would refuse); it degrades to `in_progress`.
 *
 * Every projected status is server-owned: `status` is assigned after the spread, so a stored
 * column of the same name could never override it.
 */
function projectJobStatus(workbench) {
  const jobs = Array.isArray(workbench?.jobs) ? workbench.jobs : [];
  return jobs.map(job => {
    const latest = typeof job?.latest_event_type === 'string' ? job.latest_event_type : null;
    return {
      ...job,
      // Normalizados a null cuando la lectura no los trae (base sin 070 aplicada), para que
      // el contrato servido sea el mismo en ambos casos y el cliente no reciba `undefined`.
      latest_event_type: latest,
      latest_event_at: typeof job?.latest_event_at === 'string' ? job.latest_event_at : null,
      status: (latest !== null && Object.hasOwn(JOB_EVENT_STATUS, latest))
        ? JOB_EVENT_STATUS[latest]
        : 'in_progress',
    };
  });
}

export async function getAgt002WorkbenchApi(database, opportunityId, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_USE);
  const id = uuid(opportunityId, 'opportunity_id');
  return mapped(async () => {
    // The thread is bootstrapped first and idempotently: the RPC re-asserts the actor's
    // permission and the recorded GO decision in the database, so a pre-GO or unauthorised
    // case never reaches the Mesa read below, and a fresh case is never left thread-less.
    const thread = await getOrCreateAgt002WorkbenchThread(database, { opportunityId: id, actorId });
    const threadId = uuid(thread?.id, 'thread_id');
    const workbench = await getAgt002Workbench(database, { opportunityId: id, actorId });
    const reference = await resolveCanonicalReference(database, id);
    // Server-owned fields are assigned after the spread on purpose: neither the stored
    // workbench payload nor anything a client could influence may override the gate, the
    // bootstrapped thread, the projected job status or the canonical reference.
    return {
      ...(workbench || {}),
      enabled: true,
      thread_id: threadId,
      jobs: projectJobStatus(workbench),
      reference,
    };
  });
}

/**
 * Queues one human message. The provenance the job freezes — `snapshot_id` and
 * `context_links` — is derived server-side on EVERY post, from the same canonical loader and
 * context builder the GET uses, and it overwrites whatever the body carried: a client that
 * replays a stale reference, or forges one pointing at another dossier, cannot move the job
 * off the case's current canonical analysis, nor fork its idempotency key (which is hashed
 * over the derived snapshot, never the body's). The body keys stay accepted for compatibility
 * and are still rejected when malformed, so an obviously broken client fails loudly instead of
 * silently having its input ignored.
 *
 * The reference is resolved exactly once per request, so if the canonical analysis was promoted
 * between the GET the operator saw and this POST, the job is frozen on ONE internally coherent
 * current reference — snapshot, canonical run and links all from the same run — never a mix.
 */
export async function postAgt002MessageApi(database, body, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_USE);
  exactBody(body, MESSAGE_KEYS);
  const opportunityId = uuid(body.opportunity_id, 'opportunity_id');
  const threadId = uuid(body.thread_id, 'thread_id');
  const messageId = uuid(body.client_message_id, 'client_message_id');
  // Validated for shape, then discarded: the server-derived reference replaces it below.
  uuid(body.snapshot_id, 'snapshot_id');
  const baseVersionId = uuid(body.base_version_id, 'base_version_id', true);
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 12000 || !Array.isArray(body.context_links)) {
    throw apiError('content o context_links no es válido.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  return mapped(async () => {
    const reference = await resolveCanonicalReference(database, opportunityId);
    const idempotencyKey = computeAgt002WorkbenchIdempotencyKey({
      threadId,
      originMessageId: messageId,
      snapshotId: reference.snapshot_id,
      capabilityId: body.capability_id,
      contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
      policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
      baseVersionId,
    });
    return appendAgt002HumanMessage(database, {
      opportunityId,
      actorId,
      threadId,
      messageId,
      content: body.content.trim(),
      contextLinks: reference.context_links,
      idempotencyKey,
      contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
      policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
      capabilityId: body.capability_id,
      snapshotId: reference.snapshot_id,
      baseVersionId,
    });
  });
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

import { validateAgt002WorkbenchJobInput, validateAgt002WorkbenchResult } from './agt002-workbench-contract.js';

const JOB_INPUT_KEYS = Object.freeze([
  'job_id', 'thread_id', 'origin_message_id', 'opportunity_id', 'tender_id',
  'snapshot_id', 'base_version_id', 'capability_id', 'contract_version',
  'policy_version', 'context_links', 'message',
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function freezeJobInput(jobRow) {
  const input = {};
  for (const key of JOB_INPUT_KEYS) {
    input[key] = key === 'job_id' ? jobRow.id : jobRow[key];
  }
  return deepFreeze(structuredClone(input));
}

function respondedNotConfiguredError() {
  return Object.assign(
    new Error('El respondedor de la Mesa Vig-IA no está configurado.'),
    { code: 'AGT002_RESPONDER_NOT_CONFIGURED' },
  );
}

async function appendFailedEvent(persistence, { jobId, claimId, code, message, now }) {
  await persistence.appendAgt002WorkbenchJobEvent({
    jobId,
    claimId,
    eventType: 'failed',
    metadata: { code, message: message ?? code, occurred_at: now().toISOString() },
  });
  return { status: 'failed', job_id: jobId };
}

async function respondWithTimeout(responder, input, timeoutMs) {
  const delay = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error('Tiempo de espera del respondedor agotado.'),
      { code: 'AGT002_RESPONDER_TIMEOUT' },
    )), delay);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => responder.respond(input)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runAgt002WorkbenchWorker({
  persistence, responder, now = () => new Date(), limits,
}) {
  if (!responder || typeof responder.respond !== 'function') {
    throw respondedNotConfiguredError();
  }

  const claim = await persistence.claimAgt002WorkbenchJob({
    workerId: limits.workerId,
    dailyMaxJobs: limits.dailyMaxJobs,
    maxConcurrent: limits.maxConcurrent,
    leaseSeconds: limits.leaseSeconds,
  });

  if (claim.status === 'empty') return { status: 'idle' };
  if (claim.status === 'quota') return { status: 'quota' };
  if (claim.status === 'saturated') return { status: 'saturated' };

  const { claim_id: claimId, job: jobRow } = claim;
  const jobId = jobRow.id;

  let input;
  try {
    input = validateAgt002WorkbenchJobInput(freezeJobInput(jobRow));
  } catch (error) {
    return appendFailedEvent(persistence, { jobId, claimId, code: 'AGT002_INVALID_JOB_INPUT', message: error.message, now });
  }

  let result;
  try {
    result = await respondWithTimeout(responder, input, limits.responderTimeoutMs);
  } catch (error) {
    return appendFailedEvent(persistence, {
      jobId, claimId, code: error.code || 'AGT002_RESPONDER_FAILED', message: error.message, now,
    });
  }

  try {
    validateAgt002WorkbenchResult(result, { input });
  } catch (error) {
    return appendFailedEvent(persistence, { jobId, claimId, code: 'AGT002_INVALID_RESULT', message: error.message, now });
  }

  let resultOutcome;
  try {
    resultOutcome = await persistence.completeAgt002WorkbenchJob({
      jobId, claimId, agentId: limits.agentId, input, result,
    });
  } catch (error) {
    return appendFailedEvent(persistence, { jobId, claimId, code: error.code || 'AGT002_RESULT_PERSIST_FAILED', message: error.message, now });
  }

  if (resultOutcome.status === 'existing') {
    return { status: 'existing', job_id: jobId };
  }
  if (resultOutcome.status === 'stale') {
    return { status: 'stale', job_id: jobId };
  }
  if (resultOutcome.status === 'completed') {
    return { status: 'completed', job_id: jobId };
  }
  return appendFailedEvent(persistence, {
    jobId,
    claimId,
    code: 'AGT002_INVALID_PERSISTENCE_OUTCOME',
    message: 'La persistencia terminal devolvió un estado no permitido.',
    now,
  });
}

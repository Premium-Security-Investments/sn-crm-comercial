import { AGT002_WORKBENCH_CAPABILITIES, validateAgt002WorkbenchJobInput, validateAgt002WorkbenchResult } from './agt002-workbench-contract.js';

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

// Lo que la persona lee cuando un pedido falla (Juan, 2026-11-04: el del 20:35Z falló y nadie vio nada en 16
// minutos). El código técnico va sólo al registro de eventos; aquí, el motivo en palabras simples.
const FAILURE_REASONS = Object.freeze({
  AGT002_INVALID_JOB_INPUT: 'el pedido llegó con datos del expediente que no pude leer',
  AGT002_RESPONDER_TIMEOUT: 'se me acabó el tiempo mientras lo preparaba',
  AGT002_RESPONDER_KILL_SWITCH_ENGAGED: 'la Mesa está apagada en este momento',
  AGT002_RESPONDER_NOT_CONFIGURED: 'la Mesa no está configurada en este momento',
  AGT002_RESPONDER_INVALID_JSON: 'lo que preparé no pasó las verificaciones',
  AGT002_RESPONDER_INVALID_RESULT: 'lo que preparé no pasó las verificaciones',
  AGT002_INVALID_RESULT: 'lo que preparé no pasó las verificaciones',
  AGT002_RESPONDER_FORGED_SOURCE: 'lo que preparé citaba una fuente que no era del expediente',
  AGT002_RESPONDER_MISSING_ARTIFACT_CONTEXT: 'no encontré el documento del expediente que había que escribir',
});
export function agt002WorkbenchFailureNoticeText(code) {
  const reason = FAILURE_REASONS[code] || 'hubo un error técnico';
  return `No pude preparar esto: ${reason}. Vuelva a pedirlo o avise a soporte.`;
}

async function appendFailedEvent(persistence, { jobId, claimId, code, message, now, agentId }) {
  await persistence.appendAgt002WorkbenchJobEvent({
    jobId,
    claimId,
    eventType: 'failed',
    metadata: { code, message: message ?? code, occurred_at: now().toISOString() },
  });
  // El aviso es un extra: si no se puede publicar (p. ej. la migración 176 aún no corrió), el fallo ya quedó
  // registrado y el trabajador no se cae por eso.
  if (agentId && typeof persistence.postAgt002WorkbenchFailureNotice === 'function') {
    try {
      await persistence.postAgt002WorkbenchFailureNotice({ jobId, agentId, content: agt002WorkbenchFailureNoticeText(code) });
    } catch {
      console.warn('agt002_workbench_failure_notice_unposted', { event: 'agt002_workbench_failure_notice_unposted', job_id: jobId });
    }
  }
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
    return appendFailedEvent(persistence, { agentId: limits.agentId, jobId, claimId, code: 'AGT002_INVALID_JOB_INPUT', message: error.message, now });
  }

  let result;
  try {
    // Un borrador arma además el Word: tiene su propio tope (mejora 5).
    const timeoutMs = input.capability_id === AGT002_WORKBENCH_CAPABILITIES.draft && limits.draftResponderTimeoutMs
      ? limits.draftResponderTimeoutMs : limits.responderTimeoutMs;
    result = await respondWithTimeout(responder, input, timeoutMs);
  } catch (error) {
    return appendFailedEvent(persistence, { agentId: limits.agentId,
      jobId, claimId, code: error.code || 'AGT002_RESPONDER_FAILED', message: error.message, now,
    });
  }

  try {
    validateAgt002WorkbenchResult(result, { input });
  } catch (error) {
    return appendFailedEvent(persistence, { agentId: limits.agentId, jobId, claimId, code: 'AGT002_INVALID_RESULT', message: error.message, now });
  }

  let resultOutcome;
  try {
    resultOutcome = await persistence.completeAgt002WorkbenchJob({
      jobId, claimId, agentId: limits.agentId, input, result,
    });
  } catch (error) {
    return appendFailedEvent(persistence, { agentId: limits.agentId, jobId, claimId, code: error.code || 'AGT002_RESULT_PERSIST_FAILED', message: error.message, now });
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
  return appendFailedEvent(persistence, { agentId: limits.agentId,
    jobId,
    claimId,
    code: 'AGT002_INVALID_PERSISTENCE_OUTCOME',
    message: 'La persistencia terminal devolvió un estado no permitido.',
    now,
  });
}

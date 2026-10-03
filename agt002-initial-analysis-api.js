/**
 * HTTP-orchestration half of the initial-analysis slice: request validation + kill-switch
 * gating, layered on top of ./agt002-initial-analysis-jobs.js. Both admission and claim fail
 * closed unless both kill switches read exactly the string 'true'.
 */
import {
  admitAgt002InitialAnalysisJob as admitJob,
  claimAgt002InitialAnalysisJob as claimJob,
  AGT002_INITIAL_ANALYSIS_WORKER_ID,
} from './agt002-initial-analysis-jobs.js';

const ADMIT_BODY_KEYS = Object.freeze([
  'authorization_id', 'workflow_instance_id', 'opportunity_id', 'tender_id', 'package_version_id',
  'package_hash', 'g1_scope', 'policy_version', 'idempotency_key', 'payload', 'requested_by',
]);
const ADMIT_REQUIRED_STRING_FIELDS = Object.freeze(ADMIT_BODY_KEYS.filter(key => key !== 'payload'));
const ADMIT_BODY_KEY_SET = new Set(ADMIT_BODY_KEYS);

function assertKillSwitchesEnabled(environment) {
  const env = environment || {};
  if (env.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED !== 'true' || env.AGT002_MODEL_CALLS_ENABLED !== 'true') {
    throw new Error('AGT-002 initial-analysis está deshabilitado (kill switch).');
  }
}

export async function admitAgt002InitialAnalysisJob(database, body, environment) {
  assertKillSwitchesEnabled(environment);

  const keys = Object.keys(body || {});
  if (keys.length !== ADMIT_BODY_KEYS.length || keys.some(key => !ADMIT_BODY_KEY_SET.has(key))) {
    throw new Error('El cuerpo de la solicitud de admisión AGT-002 initial-analysis tiene una forma no permitida.');
  }
  for (const field of ADMIT_REQUIRED_STRING_FIELDS) {
    if (typeof body[field] !== 'string' || body[field].trim() === '') {
      throw new Error(`El campo ${field} es obligatorio.`);
    }
  }

  return admitJob(database, {
    authorizationId: body.authorization_id,
    workflowInstanceId: body.workflow_instance_id,
    opportunityId: body.opportunity_id,
    tenderId: body.tender_id,
    packageVersionId: body.package_version_id,
    packageHash: body.package_hash,
    g1Scope: body.g1_scope,
    policyVersion: body.policy_version,
    idempotencyKey: body.idempotency_key,
    payload: body.payload,
    requestedBy: body.requested_by,
  });
}

export async function claimAgt002InitialAnalysisJob(database, { leaseSeconds } = {}, environment) {
  assertKillSwitchesEnabled(environment);
  return claimJob(database, { workerId: AGT002_INITIAL_ANALYSIS_WORKER_ID, leaseSeconds });
}

const PERSISTENCE_ERROR_CODE_MAX_LENGTH=40;
const PERSISTENCE_ERROR_MESSAGE_MAX_LENGTH=500;
function boundedString(value,maxLength){if(typeof value!=='string')return null;const trimmed=value.trim();if(!trimmed)return null;return trimmed.length>maxLength?trimmed.slice(0,maxLength):trimmed;}
function persistenceError(error) {
  const sourceCode=boundedString(error?.code,PERSISTENCE_ERROR_CODE_MAX_LENGTH);
  const sourceMessage=boundedString(error?.message,PERSISTENCE_ERROR_MESSAGE_MAX_LENGTH);
  const wrapped=error instanceof Error?error:new Error(sourceMessage||'AGT-002 Radar queue persistence failed.');
  wrapped.runtime_boundary_code='AGT002_RADAR_PERSISTENCE_FAILURE';
  if(sourceCode)wrapped.database_code=sourceCode;
  return wrapped;
}
async function rpc(database,name,args){
  if(!database||typeof database.rpc!=='function') throw persistenceError(new Error('AGT-002 Radar database client required.'));
  let response; try{response=await database.rpc(name,args);}catch(error){throw persistenceError(error);} if(response?.error) throw persistenceError(response.error); return response?.data??null;
}
export function enqueueAgt002RadarPreanalysisJob(database,value){return rpc(database,'psi_enqueue_agt002_radar_preanalysis_job',{p_tender_id:value.tenderId,p_gate_evaluation_id:value.gateEvaluationId,p_attempt_key:value.attemptKey,p_idempotency_key:value.idempotencyKey,p_policy_version:value.policyVersion,p_context_version:value.contextVersion,p_source_row_hash:value.sourceRowHash});}
export async function claimAgt002RadarPreanalysisJob(database,{leaseSeconds=600}={}){
  const data=await rpc(database,'psi_claim_agt002_radar_preanalysis_job',{p_lease_seconds:leaseSeconds}); if(!data||data.status==='empty')return null;
  if(data.status!=='claimed')throw persistenceError(new Error('AGT-002 Radar claim returned invalid state.'));
  return{jobId:data.job_id,leaseId:data.lease_id,leaseExpiresAt:data.lease_expires_at,tenderId:data.tender_id,gateEvaluationId:data.gate_evaluation_id,attemptKey:data.attempt_key,policyVersion:data.policy_version,contextVersion:data.context_version,sourceRowHash:data.source_row_hash};
}
export function completeAgt002RadarPreanalysisJob(database,value){return rpc(database,'psi_complete_agt002_radar_preanalysis_job',{p_job_id:value.jobId,p_lease_id:value.leaseId,p_preanalysis_run_id:value.preanalysisRunId});}
export function failAgt002RadarPreanalysisJob(database,value){return rpc(database,'psi_fail_agt002_radar_preanalysis_job',{p_job_id:value.jobId,p_lease_id:value.leaseId,p_error_code:value.errorCode});}

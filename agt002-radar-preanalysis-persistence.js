import { createHash } from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function persistenceError(error) {
  const wrapped = error instanceof Error ? error : new Error('AGT-002 Radar persistence failed.');
  wrapped.runtime_boundary_code = 'AGT002_RADAR_PERSISTENCE_FAILURE'; return wrapped;
}
async function rpc(database, name, args) {
  if (!database || typeof database.rpc !== 'function') throw persistenceError(new Error('AGT-002 Radar database client required.'));
  let response;
  try { response = await database.rpc(name, args); } catch (error) { throw persistenceError(error); }
  if (response?.error) throw persistenceError(response.error);
  return response?.data ?? null;
}

export function computeAgt002RadarPreanalysisIdempotencyKey(parts) {
  return createHash('sha256').update(JSON.stringify(stable(parts))).digest('hex');
}
export function recordAgt002RadarGateEvaluation(database, value) {
  return rpc(database,'psi_record_agt002_radar_gate_evaluation',{
    p_tender_id:value.tenderId,p_stable_key:value.stableKey,p_verdict:value.verdict,p_rule_ids:value.ruleIds,p_reasons:value.reasons,
    p_data_gaps:value.dataGaps,p_policy_version:value.policyVersion,p_context_version:value.contextVersion,p_source_row_hash:value.sourceRowHash,
    p_idempotency_key:value.idempotencyKey,p_evaluated_at:value.evaluatedAt,
  });
}
export function recordAgt002RadarPreanalysisRun(database, value) {
  return rpc(database,'psi_record_agt002_radar_preanalysis_run',{
    p_tender_id:value.tenderId,p_gate_evaluation_id:value.gateEvaluationId,p_visibility_verdict:value.visibilityVerdict,p_status:value.status,
    p_result:value.result,p_evidence:value.evidence,p_policy_version:value.policyVersion,p_context_version:value.contextVersion,
    p_learning_signals_version:value.learningSignalsVersion,p_learning_signals_count:value.learningSignalsCount,p_model:value.model,
    p_usage:value.usage,p_idempotency_key:value.idempotencyKey,
  });
}
export function appendAgt002RadarPreanalysisAttempt(database, value) {
  return rpc(database,'psi_append_agt002_radar_preanalysis_attempt',{
    p_event_key:value.eventKey,p_job_id:value.jobId,p_tender_id:value.tenderId,p_attempt_key:value.attemptKey,p_status:value.status,
    p_preanalysis_run_id:value.preanalysisRunId ?? null,p_error_code:value.errorCode ?? null,
  });
}
export async function readAgt002RadarCanonicalPreanalysis(database, tenderIds) {
  if (!database || typeof database.from !== 'function') throw persistenceError(new Error('AGT-002 Radar database client required.'));
  const ids=[...new Set((tenderIds||[]).filter(value=>typeof value==='string'&&value))]; const rows=[];
  try {
    for(let index=0;index<ids.length;index+=250){
      const response=await database.from('psi_agt002_radar_preanalysis_runs')
        .select('id,tender_id,gate_evaluation_id,status,visibility_verdict,result,evidence,policy_version,context_version,source_row_hash,learning_signals_version,learning_signals_count,canonical,created_at,completed_at')
        .eq('canonical',true).in('tender_id',ids.slice(index,index+250));
      if(response?.error) throw response.error; rows.push(...(response?.data||[]));
    }
  } catch(error){throw persistenceError(error);}
  return rows;
}

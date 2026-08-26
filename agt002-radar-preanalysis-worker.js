import { claimAgt002RadarPreanalysisJob,completeAgt002RadarPreanalysisJob,failAgt002RadarPreanalysisJob } from './agt002-radar-preanalysis-jobs.js';
export const AGT002_RADAR_QUEUE_ERROR_CODES=Object.freeze(['timeout','provider_error','invalid_output','persistence_failure','lease_lost','capacity_unavailable','stale_input']);
const CODES=new Set(AGT002_RADAR_QUEUE_ERROR_CODES);
export function classifyAgt002RadarPreanalysisError(error){const code=String(error?.runtime_boundary_code||error?.code||'').toUpperCase();if(code.includes('STALE'))return'stale_input';if(code.includes('TIMEOUT'))return'timeout';if(code.includes('PERSIST'))return'persistence_failure';if(code.includes('LEASE'))return'lease_lost';if(code.includes('CAPACITY')||code.includes('SATURAT')||code.includes('QUOTA'))return'capacity_unavailable';if(code.includes('INVALID')||code.includes('VALIDATION')||code.includes('JSON')||code.includes('CONTENT')||code.includes('ENVELOPE'))return'invalid_output';return'provider_error';}
export function createAgt002RadarPreanalysisWorker({database,executeJob,leaseSeconds=600,claimJob=claimAgt002RadarPreanalysisJob,completeJob=completeAgt002RadarPreanalysisJob,failJob=failAgt002RadarPreanalysisJob}={}){
  if(!database||typeof executeJob!=='function')throw new Error('AGT-002 Radar worker requires database and executeJob.');
  if(!Number.isInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>600)throw new Error('AGT-002 Radar worker leaseSeconds must be between 30 and 600.');
  return Object.freeze({async runOnce(){
    const job=await claimJob(database,{leaseSeconds});if(!job)return{status:'empty'};
    let outcome;try{outcome=await executeJob(database,job);}catch(error){const errorCode=classifyAgt002RadarPreanalysisError(error);await failJob(database,{jobId:job.jobId,leaseId:job.leaseId,errorCode});return{status:'unavailable',jobId:job.jobId,errorCode};}
    const preanalysisRunId=typeof outcome?.preanalysis_run_id==='string'&&outcome.preanalysis_run_id.trim()?outcome.preanalysis_run_id.trim():null;
    if(preanalysisRunId){try{await completeJob(database,{jobId:job.jobId,leaseId:job.leaseId,preanalysisRunId});return{status:'completed',jobId:job.jobId,preanalysisRunId};}catch{await failJob(database,{jobId:job.jobId,leaseId:job.leaseId,errorCode:'persistence_failure'});return{status:'unavailable',jobId:job.jobId,errorCode:'persistence_failure'};}}
    const errorCode=outcome?.status==='unavailable'&&CODES.has(outcome?.error_code)?outcome.error_code:'invalid_output';await failJob(database,{jobId:job.jobId,leaseId:job.leaseId,errorCode});return{status:'unavailable',jobId:job.jobId,errorCode};
  }});
}

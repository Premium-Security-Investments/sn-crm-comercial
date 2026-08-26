import assert from 'node:assert/strict';
import { computeAgt002RadarPreanalysisIdempotencyKey, readAgt002RadarCanonicalPreanalysis, recordAgt002RadarGateEvaluation, recordAgt002RadarPreanalysisRun } from '../agt002-radar-preanalysis-persistence.js';
import { claimAgt002RadarPreanalysisJob, completeAgt002RadarPreanalysisJob, enqueueAgt002RadarPreanalysisJob, failAgt002RadarPreanalysisJob } from '../agt002-radar-preanalysis-jobs.js';

const calls=[];
const database={rpc:async(name,args)=>{calls.push([name,args]); if(name.includes('claim')) return{data:{status:'claimed',job_id:'j',lease_id:'l',lease_expires_at:'x',tender_id:'t',gate_evaluation_id:'g',attempt_key:'a',policy_version:'p',context_version:'c',source_row_hash:'h'},error:null}; return{data:{status:'ok'},error:null};}};
await recordAgt002RadarGateEvaluation(database,{tenderId:'t',stableKey:'k',verdict:'sobreviviente',ruleIds:[],reasons:[],dataGaps:[],policyVersion:'p',contextVersion:'c',sourceRowHash:'h',idempotencyKey:'i',evaluatedAt:'now'});
await recordAgt002RadarPreanalysisRun(database,{tenderId:'t',gateEvaluationId:'g',visibilityVerdict:'mostrar_en_radar',status:'completed',result:{},evidence:[],policyVersion:'p',contextVersion:'c',learningSignalsVersion:null,learningSignalsCount:0,model:'m',usage:{},idempotencyKey:'i'});
await enqueueAgt002RadarPreanalysisJob(database,{tenderId:'t',gateEvaluationId:'g',attemptKey:'a',idempotencyKey:'i',policyVersion:'p',contextVersion:'c',sourceRowHash:'h'});
assert.deepEqual(await claimAgt002RadarPreanalysisJob(database,{leaseSeconds:60}),{jobId:'j',leaseId:'l',leaseExpiresAt:'x',tenderId:'t',gateEvaluationId:'g',attemptKey:'a',policyVersion:'p',contextVersion:'c',sourceRowHash:'h'});
await completeAgt002RadarPreanalysisJob(database,{jobId:'j',leaseId:'l',preanalysisRunId:'r'}); await failAgt002RadarPreanalysisJob(database,{jobId:'j',leaseId:'l',errorCode:'timeout'});
assert.deepEqual(calls.map(call=>call[0]),['psi_record_agt002_radar_gate_evaluation','psi_record_agt002_radar_preanalysis_run','psi_enqueue_agt002_radar_preanalysis_job','psi_claim_agt002_radar_preanalysis_job','psi_complete_agt002_radar_preanalysis_job','psi_fail_agt002_radar_preanalysis_job']);
const key1=computeAgt002RadarPreanalysisIdempotencyKey({b:2,a:1}),key2=computeAgt002RadarPreanalysisIdempotencyKey({a:1,b:2}); assert.equal(key1,key2); assert.match(key1,/^[0-9a-f]{64}$/);
const queryCalls=[];
const dbRead={from:table=>{queryCalls.push(['from',table]);return{select(fields){queryCalls.push(['select',fields]);return this;},eq(field,value){queryCalls.push(['eq',field,value]);return this;},in(field,values){queryCalls.push(['in',field,values]);return Promise.resolve({data:values.map(tender_id=>({tender_id,canonical:true})),error:null});}};}};
const ids=Array.from({length:251},(_,i)=>`t${i}`); const rows=await readAgt002RadarCanonicalPreanalysis(dbRead,ids); assert.equal(rows.length,251); assert.equal(queryCalls.filter(c=>c[0]==='from').length,2); assert.ok(queryCalls.some(c=>c[0]==='eq'&&c[1]==='canonical'&&c[2]===true)); assert.ok(queryCalls.some(c=>c[0]==='select'&&c[1].includes('visibility_verdict')&&c[1].includes('source_row_hash')));
const bad={rpc:async()=>({data:null,error:new Error('db')})}; await assert.rejects(()=>claimAgt002RadarPreanalysisJob(bad,{leaseSeconds:60}),error=>error.runtime_boundary_code==='AGT002_RADAR_PERSISTENCE_FAILURE');
console.log('AGT-002 Radar RPC-only persistence and queue clients passed');

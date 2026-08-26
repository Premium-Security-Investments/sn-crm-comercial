import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_QUEUE_ERROR_CODES, classifyAgt002RadarPreanalysisError, createAgt002RadarPreanalysisWorker } from '../agt002-radar-preanalysis-worker.js';
for (const [code,expected] of [['AGT002_RADAR_PREANALYSIS_TIMEOUT','timeout'],['AGT002_RADAR_PREANALYSIS_INVALID_OUTPUT','invalid_output'],['AGT002_RADAR_PERSISTENCE_FAILURE','persistence_failure'],['AGT002_RADAR_LEASE_LOST','lease_lost'],['AGT002_RADAR_CAPACITY_UNAVAILABLE','capacity_unavailable'],['AGT002_RADAR_STALE_INPUT','stale_input']]) assert.equal(classifyAgt002RadarPreanalysisError({runtime_boundary_code:code}),expected);
assert.equal(classifyAgt002RadarPreanalysisError(new Error('boom')),'provider_error');
// El conjunto de codigos terminales es acotado y explicito: la migracion 072 debe aceptar los mismos.
assert.deepEqual([...AGT002_RADAR_QUEUE_ERROR_CODES].sort(),['capacity_unavailable','invalid_output','lease_lost','persistence_failure','provider_error','stale_input','timeout']);
const migration072=readFileSync(new URL('../supabase/migrations/072_agt002_radar_preanalysis_ledger.sql',import.meta.url),'utf8');
for (const code of AGT002_RADAR_QUEUE_ERROR_CODES) {
  assert.ok(migration072.includes(`'${code}'`),`072 debe declarar el codigo terminal ${code}`);
  assert.ok(new RegExp(`when '${code}' then`).test(migration072),`072 debe mapear un mensaje acotado para ${code}`);
}
const job={jobId:'j1',leaseId:'l1',tenderId:'t1',gateEvaluationId:'g1',attemptKey:'a1'};
const calls=[];
const failed=createAgt002RadarPreanalysisWorker({database:{},leaseSeconds:120,claimJob:async()=>{calls.push('claim');return job;},executeJob:async()=>{calls.push('exec');throw new Error('boom');},completeJob:async()=>calls.push('complete'),failJob:async(_db,{errorCode})=>calls.push(`fail:${errorCode}`)});
assert.deepEqual(await failed.runOnce(),{status:'unavailable',jobId:'j1',errorCode:'provider_error'}); assert.deepEqual(calls,['claim','exec','fail:provider_error']);
const okCalls=[];
const ok=createAgt002RadarPreanalysisWorker({database:{},claimJob:async()=>job,executeJob:async()=>{okCalls.push('exec');return{preanalysis_run_id:'r1'};},completeJob:async(_db,args)=>okCalls.push(`complete:${args.preanalysisRunId}`),failJob:async()=>okCalls.push('fail')});
assert.deepEqual(await ok.runOnce(),{status:'completed',jobId:'j1',preanalysisRunId:'r1'}); assert.deepEqual(okCalls,['exec','complete:r1']);
const brokenCalls=[];
const broken=createAgt002RadarPreanalysisWorker({database:{},claimJob:async()=>job,executeJob:async()=>({preanalysis_run_id:'r1'}),completeJob:async()=>{throw new Error('broken');},failJob:async(_db,args)=>brokenCalls.push(args.errorCode)});
assert.deepEqual(await broken.runOnce(),{status:'unavailable',jobId:'j1',errorCode:'persistence_failure'}); assert.deepEqual(brokenCalls,['persistence_failure']);
const empty=createAgt002RadarPreanalysisWorker({database:{},claimJob:async()=>null,executeJob:async()=>{throw new Error('never');},completeJob:async()=>{},failJob:async()=>{}}); assert.deepEqual(await empty.runOnce(),{status:'empty'});
assert.throws(()=>createAgt002RadarPreanalysisWorker({database:{},executeJob:async()=>{},claimJob:async()=>null,completeJob:async()=>{},failJob:async()=>{},leaseSeconds:5}),/leaseSeconds/);
console.log('AGT-002 Radar durable worker one-terminal-transition contract passed');

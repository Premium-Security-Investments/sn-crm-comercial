import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_PIPELINE_STAGES,createAgt002RadarPipeline } from '../agt002-radar-pipeline.js';
const NOW='2026-08-25T15:00:00.000Z',TENDER={id:'22222222-2222-4222-8222-222222222222',stable_key:'k-1',title:'Vigilancia',description:'Armada',source:'SECOP II',entity:'E',city:'Bogotá',dept:'Cundinamarca',category:'Licitación'};
const hostileDatabase=new Proxy({},{get(){throw new Error('database must not be touched');}}),hostile=()=>{throw new Error('must not run');};
for(const environment of [{},{AGT002_RADAR_GATE:'false'},{AGT002_RADAR_GATE:'yes'},{AGT002_RADAR_GATE:''}]){const disabled=createAgt002RadarPipeline({database:hostileDatabase,environment,now:()=>NOW,fetchTenderPage:hostile,evaluateGate:hostile,recordGateEvaluation:hostile,enqueueJob:hostile,claimJob:hostile,completeJob:hostile,failJob:hostile,projectLearningObservations:hostile,buildLearningSignals:hostile,runPreanalysis:hostile,recordPreanalysisRun:hostile});assert.deepEqual(await disabled.runOnce(),{status:'disabled',stages:[],code:'AGT002_RADAR_PIPELINE_DISABLED'});}
const calls=[];let nowCalls=0;const gateClockValues=[];const track=(name,value)=>(...args)=>{calls.push(name);return typeof value==='function'?value(...args):value;};
const enabled=createAgt002RadarPipeline({database:{},environment:{AGT002_RADAR_GATE:'true'},now:()=>{nowCalls+=1;return NOW;},
 fetchTenderPage:track('fetch',[TENDER,{id:'33333333-3333-4333-8333-333333333333',stable_key:'k-2'}]),
 evaluateGate:track('gate',(row,{nowIso})=>{gateClockValues.push(nowIso);return row.stable_key==='k-1'?{verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],tender_id:row.id,source_row_hash:'a'.repeat(64),policy_version:'p',context_version:'c'}:{verdict:'eliminada',rule_ids:['estado_terminal'],reasons:[{rule_id:'estado_terminal'}],data_gaps:[],tender_id:row.id,source_row_hash:'b'.repeat(64),policy_version:'p',context_version:'c'};}),
 recordGateEvaluation:track('ledger',value=>({id:value.tenderId===TENDER.id?'gate-1':'gate-2'})),enqueueJob:track('enqueue',{status:'created',job_id:'j1'}),claimJob:track('claim',{jobId:'j1',leaseId:'l1',tenderId:TENDER.id,gateEvaluationId:'gate-1',attemptKey:'a1',sourceRowHash:'a'.repeat(64),policyVersion:'p',contextVersion:'c'}),projectLearningObservations:track('learning',{precedents:[]}),buildLearningSignals:track('signals',({candidate,maxSignals})=>{assert.equal(candidate.tender_id,TENDER.id);assert.equal(maxSignals,10);return{version:'agt002-radar-learning-v1',candidate_id:TENDER.id,max_signals:10,considered:0,signals:[]};}),runPreanalysis:track('agt',{status:'completed',visibility_verdict:'mostrar_en_radar',evidence:[{evidence_id:'e'}],usage:{},policy_version:'p',context_version:'c'}),recordPreanalysisRun:track('persist',{id:'r1',canonical:true}),completeJob:track('complete',{status:'completed'}),failJob:hostile});
const result=await enabled.runOnce();assert.equal(result.status,'completed');assert.equal(result.job_id,'j1');assert.equal(result.preanalysis_run_id,'r1');assert.equal(result.evaluated,2);assert.equal(result.survivors,1);assert.equal(result.eliminated,1);assert.deepEqual([...new Set(calls)],['fetch','gate','ledger','enqueue','claim','learning','signals','agt','persist','complete']);assert.deepEqual(result.stages,AGT002_RADAR_PIPELINE_STAGES);assert.equal(calls.filter(x=>x==='ledger').length,2);assert.equal(calls.filter(x=>x==='enqueue').length,1);assert.equal(calls.filter(x=>x==='claim').length,1);assert.equal(calls.filter(x=>x==='agt').length,1);assert.equal(nowCalls,1);assert.deepEqual(gateClockValues,[NOW,NOW]);
const empty=createAgt002RadarPipeline({database:{},environment:{AGT002_RADAR_GATE:'1'},now:()=>NOW,fetchTenderPage:async()=>[],evaluateGate:hostile,recordGateEvaluation:hostile,enqueueJob:hostile,claimJob:async()=>null,completeJob:hostile,failJob:hostile,projectLearningObservations:hostile,buildLearningSignals:hostile,runPreanalysis:hostile,recordPreanalysisRun:hostile});assert.equal((await empty.runOnce()).status,'empty');
let failedCode;const learningBroken=createAgt002RadarPipeline({database:{},environment:{AGT002_RADAR_GATE:'true'},now:()=>NOW,fetchTenderPage:async()=>[TENDER],evaluateGate:()=>({verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],tender_id:TENDER.id,source_row_hash:'a'.repeat(64),policy_version:'p',context_version:'c'}),recordGateEvaluation:async()=>({id:'gate-1'}),enqueueJob:async()=>({status:'created',job_id:'j1'}),claimJob:async()=>({jobId:'j1',leaseId:'l1',tenderId:TENDER.id,gateEvaluationId:'gate-1',attemptKey:'a1',sourceRowHash:'a'.repeat(64),policyVersion:'p',contextVersion:'c'}),projectLearningObservations:async()=>{const error=new Error('down');error.runtime_boundary_code='AGT002_RADAR_LEARNING_SIGNALS_INVALID';throw error;},buildLearningSignals:hostile,runPreanalysis:hostile,recordPreanalysisRun:hostile,completeJob:hostile,failJob:async(_db,{errorCode})=>{failedCode=errorCode;}});assert.deepEqual(await learningBroken.runOnce(),{status:'unavailable',stages:['fetch','gate','ledger','claim','learning'],job_id:'j1',error_code:'invalid_output'});assert.equal(failedCode,'invalid_output');
let enqueueCalled=false;const ledgerBroken=createAgt002RadarPipeline({database:{},environment:{AGT002_RADAR_GATE:'true'},now:()=>NOW,fetchTenderPage:async()=>[TENDER],evaluateGate:()=>({verdict:'sobreviviente',tender_id:TENDER.id,source_row_hash:'a'.repeat(64),policy_version:'p',context_version:'c'}),recordGateEvaluation:async()=>{throw new Error('down');},enqueueJob:()=>{enqueueCalled=true;},claimJob:hostile,projectLearningObservations:hostile,buildLearningSignals:hostile,runPreanalysis:hostile,recordPreanalysisRun:hostile,completeJob:hostile,failJob:hostile});assert.equal((await ledgerBroken.runOnce()).status,'unavailable');assert.equal(enqueueCalled,false);

// Una falla terminal debe poder reencolarse en una corrida posterior. Cada corrida tiene
// una identidad de intento distinta, mientras que repetir la misma corrida sigue siendo idempotente.
const retryEnqueues=[];const retryGateWrites=[];const retryTimes=[NOW,'2026-08-25T15:01:00.000Z','2026-08-26T15:00:00.000Z'];
const retryable=createAgt002RadarPipeline({database:{},environment:{AGT002_RADAR_GATE:'true'},now:()=>retryTimes.shift(),fetchTenderPage:async()=>[TENDER],evaluateGate:()=>({verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],tender_id:TENDER.id,source_row_hash:'a'.repeat(64),policy_version:'p',context_version:'c'}),recordGateEvaluation:async(_db,value)=>{retryGateWrites.push(value);return{id:'gate-1'};},enqueueJob:async(_db,value)=>{retryEnqueues.push(value);return{status:'created',job_id:`j${retryEnqueues.length}`};},claimJob:async()=>null,completeJob:hostile,failJob:hostile,projectLearningObservations:hostile,buildLearningSignals:hostile,runPreanalysis:hostile,recordPreanalysisRun:hostile});
assert.equal((await retryable.runOnce()).status,'empty');assert.equal((await retryable.runOnce()).status,'empty');
assert.equal(retryEnqueues.length,2);assert.notEqual(retryEnqueues[0].attemptKey,retryEnqueues[1].attemptKey);assert.notEqual(retryEnqueues[0].idempotencyKey,retryEnqueues[1].idempotencyKey);
// Forma exacta que el ledger de gate recibe en produccion y que el RPC 071 debe tolerar:
// misma clave deterministica sobre una fila sin cambios, con un `evaluated_at` distinto por corrida.
assert.equal(retryGateWrites.length,2);
assert.equal(retryGateWrites[0].idempotencyKey,retryGateWrites[1].idempotencyKey);
assert.notEqual(retryGateWrites[0].evaluatedAt,retryGateWrites[1].evaluatedAt);
// BLOCKER A: al cambiar el dia calendario de Bogota la clave persistida del gate estrena identidad,
// porque el veredicto `fecha_vencida` depende de ese dia. Mismo dia = misma clave (arriba).
assert.equal((await retryable.runOnce()).status,'empty');
assert.equal(retryGateWrites.length,3);
assert.notEqual(retryGateWrites[2].idempotencyKey,retryGateWrites[1].idempotencyKey);
assert.equal(retryGateWrites[2].sourceRowHash,retryGateWrites[1].sourceRowHash,'la identidad diaria no toca el hash de ingesta');

// BLOCKER B2: un job encolado puede sobrevivir a la fila que lo justifico. Si la evaluacion vigente
// ya no es superviviente, el job se falla como `stale_input` sin invocar a AGT-002 ni persistir.
for (const [label,evaluation] of [
 ['eliminada',{verdict:'eliminada',rule_ids:['fecha_vencida'],reasons:[{rule_id:'fecha_vencida'}],data_gaps:[],tender_id:TENDER.id,source_row_hash:'a'.repeat(64),policy_version:'p',context_version:'c'}],
 ['hash cambiado',{verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],tender_id:TENDER.id,source_row_hash:'e'.repeat(64),policy_version:'p',context_version:'c'}],
 ['policy cambiada',{verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],tender_id:TENDER.id,source_row_hash:'a'.repeat(64),policy_version:'p2',context_version:'c'}],
 ['context cambiado',{verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],tender_id:TENDER.id,source_row_hash:'a'.repeat(64),policy_version:'p',context_version:'c2'}],
]){
 let staleCode;const staleCalls=[];
 const staleJob=createAgt002RadarPipeline({database:{},environment:{AGT002_RADAR_GATE:'true'},now:()=>NOW,fetchTenderPage:async()=>[TENDER],
  evaluateGate:()=>evaluation,recordGateEvaluation:async()=>({id:'gate-1'}),
  enqueueJob:async()=>({status:'created',job_id:'j1'}),
  claimJob:async()=>({jobId:'j1',leaseId:'l1',tenderId:TENDER.id,gateEvaluationId:'gate-old',attemptKey:'a1',sourceRowHash:'a'.repeat(64),policyVersion:'p',contextVersion:'c'}),
  projectLearningObservations:async()=>{staleCalls.push('learning');return{precedents:[]};},buildLearningSignals:()=>{staleCalls.push('signals');return{signals:[]};},
  runPreanalysis:async()=>{staleCalls.push('agt');return{};},recordPreanalysisRun:async()=>{staleCalls.push('persist');return{id:'r1'};},
  completeJob:async()=>{staleCalls.push('complete');},failJob:async(_db,{errorCode})=>{staleCode=errorCode;}});
 const staleResult=await staleJob.runOnce();
 assert.equal(staleResult.status,'unavailable',label);
 assert.equal(staleResult.error_code,'stale_input',label);
 assert.equal(staleCode,'stale_input',label);
 assert.deepEqual(staleCalls,[],`${label}: ni AGT-002 ni el ledger canonico deben tocarse`);
 assert.deepEqual(staleResult.stages,['fetch','gate','ledger','claim'],label);
}
// Un job reclamado cuya licitacion ya no esta en la pagina tampoco es verificable: mismo cierre.
let absentCode;
const absent=createAgt002RadarPipeline({database:{},environment:{AGT002_RADAR_GATE:'true'},now:()=>NOW,fetchTenderPage:async()=>[TENDER],
 evaluateGate:()=>({verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],tender_id:TENDER.id,source_row_hash:'a'.repeat(64),policy_version:'p',context_version:'c'}),
 recordGateEvaluation:async()=>({id:'gate-1'}),enqueueJob:async()=>({status:'created',job_id:'j1'}),
 claimJob:async()=>({jobId:'j9',leaseId:'l9',tenderId:'44444444-4444-4444-8444-444444444444',gateEvaluationId:'gate-9',attemptKey:'a9',sourceRowHash:'a'.repeat(64),policyVersion:'p',contextVersion:'c'}),
 projectLearningObservations:hostile,buildLearningSignals:hostile,runPreanalysis:hostile,recordPreanalysisRun:hostile,completeJob:hostile,
 failJob:async(_db,{errorCode})=>{absentCode=errorCode;}});
assert.equal((await absent.runOnce()).error_code,'stale_input');
assert.equal(absentCode,'stale_input');

// Bloqueo permanente adyacente: la cola sigue siendo fail-closed por licitacion, pero un rechazo de
// una fila no puede abortar el lote. Si aborta, `claim` no corre, el job activo nunca drena y el
// temporizador queda congelado para siempre por una sola fila en conflicto.
const OTHER={...TENDER,id:'55555555-5555-4555-8555-555555555555',stable_key:'k-other'};
let claimAttempts=0;const conflictEnqueues=[];
const conflicting=createAgt002RadarPipeline({database:{},environment:{AGT002_RADAR_GATE:'true'},now:()=>NOW,fetchTenderPage:async()=>[TENDER,OTHER],
 evaluateGate:row=>({verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],tender_id:row.id,source_row_hash:'a'.repeat(64),policy_version:'p',context_version:'c'}),
 recordGateEvaluation:async(_db,value)=>({id:`gate-${value.tenderId}`}),
 enqueueJob:async(_db,value)=>{conflictEnqueues.push(value.tenderId);if(value.tenderId===TENDER.id){const error=new Error('AGT-002 Radar tender already has a different active job');error.runtime_boundary_code='AGT002_RADAR_PERSISTENCE_FAILURE';throw error;}return{status:'created',job_id:'j2'};},
 claimJob:async()=>{claimAttempts+=1;return null;},
 projectLearningObservations:hostile,buildLearningSignals:hostile,runPreanalysis:hostile,recordPreanalysisRun:hostile,completeJob:hostile,failJob:hostile});
const conflicted=await conflicting.runOnce();
assert.equal(conflicted.status,'empty');
assert.deepEqual(conflictEnqueues,[TENDER.id,OTHER.id],'un rechazo no debe cortar el resto del lote');
assert.equal(conflicted.rejected,1);
assert.equal(conflicted.enqueued,1);
assert.equal(claimAttempts,1,'la corrida debe llegar a claim pese al conflicto de una fila');

const source=readFileSync(new URL('../agt002-radar-pipeline.js',import.meta.url),'utf8');assert.doesNotMatch(source,/Date\.now\(\)|new Date\(\)/);assert.doesNotMatch(source,/learning-proposals/);
console.log('AGT-002 real ordered pipeline and default-off no-op passed');

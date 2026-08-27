import { agt002RadarEvaluationDate,evaluateAgt002RadarGate } from './agt002-radar-gate.js';
import { recordAgt002RadarGateEvaluation,recordAgt002RadarPreanalysisRun,computeAgt002RadarPreanalysisIdempotencyKey } from './agt002-radar-preanalysis-persistence.js';
import { enqueueAgt002RadarPreanalysisJob,claimAgt002RadarPreanalysisJob,completeAgt002RadarPreanalysisJob,failAgt002RadarPreanalysisJob } from './agt002-radar-preanalysis-jobs.js';
import { projectAgt002RadarLearningObservations } from './agt002-radar-learning-projection.js';
import { buildAgt002RadarLearningSignals } from './agt002-radar-learning-retrieval.js';
import { createAgt002RadarPreanalysisRuntime } from './agt002-radar-preanalysis-runtime.js';
import { classifyAgt002RadarPreanalysisError } from './agt002-radar-preanalysis-worker.js';
import { buildAgt002AnalysisConfig } from './agt002-analysis-config.js';
import { extractTenderCoreServiceTerms } from './tender-relevance-terms.js';
import { ESU_DIRECT_REFRESH_SOURCE } from './esu-direct-refresh.js';

export const AGT002_RADAR_PIPELINE_STAGES=Object.freeze(['esu_refresh','fetch','gate','ledger','claim','learning','agt','persist']);
function enabled(environment){return buildAgt002AnalysisConfig(environment).AGT002_RADAR_GATE;}
async function defaultFetch(database,{limit}){const response=await database.from('psi_public_tenders').select('*').order('last_seen_at',{ascending:false}).order('id',{ascending:true}).limit(limit);if(response?.error)throw response.error;return response?.data||[];}
function normalize(value){return typeof value==='string'?value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim():null;}
function candidate(row){return{tender_id:row.id,service_terms:extractTenderCoreServiceTerms(`${row.title||''} ${row.description||row.desc||''}`),entity_key:normalize(row.entity_nit||row.entity),modality_key:normalize(row.category||row.modality),source_key:normalize(row.source),territory_key:{city:normalize(row.city),dept:normalize(row.dept)}};}
async function defaultRunPreanalysis(_database,{environment,tenderRow,gateEvaluation,learningSignals,idempotencyKey}){return createAgt002RadarPreanalysisRuntime({environment}).runOnce({tenderRow,gateEvaluation,learningSignals,idempotencyKey});}
// Safe no-op: touches neither database nor network. The real ESU direct-refresher (backed by
// createEsuDirectRefresher in esu-direct-refresh.js) is wired in by the caller via `refreshEsuDirect`.
async function defaultRefreshEsuDirect(){return{status:'skipped_fresh',source:ESU_DIRECT_REFRESH_SOURCE};}
export function createAgt002RadarPipeline({
 database,environment=process.env,now,fetchTenderPage=defaultFetch,evaluateGate=evaluateAgt002RadarGate,
 recordGateEvaluation=recordAgt002RadarGateEvaluation,enqueueJob=enqueueAgt002RadarPreanalysisJob,claimJob=claimAgt002RadarPreanalysisJob,
 completeJob=completeAgt002RadarPreanalysisJob,failJob=failAgt002RadarPreanalysisJob,projectLearningObservations=projectAgt002RadarLearningObservations,
 buildLearningSignals=buildAgt002RadarLearningSignals,runPreanalysis=defaultRunPreanalysis,recordPreanalysisRun=recordAgt002RadarPreanalysisRun,
 refreshEsuDirect=defaultRefreshEsuDirect,
 leaseSeconds=600,maxTendersPerRun=250,maxLearningSignals=10,
}={}){
 if(!Number.isInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>600||!Number.isInteger(maxTendersPerRun)||maxTendersPerRun<1||maxTendersPerRun>1000||!Number.isInteger(maxLearningSignals)||maxLearningSignals<1||maxLearningSignals>25)throw new Error('AGT002_RADAR_PIPELINE_CONFIG_INVALID');
 return Object.freeze({async runOnce(){
  if(!enabled(environment))return{status:'disabled',stages:[],code:'AGT002_RADAR_PIPELINE_DISABLED'};
  const stages=[];
  let nowIso,evaluationDate;
  try{nowIso=now();if(typeof nowIso!=='string'||!Number.isFinite(Date.parse(nowIso)))throw new Error('invalid injected time');evaluationDate=agt002RadarEvaluationDate(nowIso);}
  catch{return{status:'unavailable',stages,error_code:'provider_error'};}
  // ESU direct-refresh runs before candidate fetch/gate but never blocks them: a failed or
  // unavailable refresh still lets the pipeline continue against whatever was already persisted
  // in psi_public_tenders. No synthetic deadline/status is ever fabricated and the gate below
  // evaluates exactly the persisted rows, so ESU availability can never relax the gate.
  stages.push('esu_refresh');
  let esuRefresh;
  try{const result=await refreshEsuDirect(database,{environment,now:nowIso});esuRefresh=result&&typeof result==='object'?result:{status:'unavailable',source:ESU_DIRECT_REFRESH_SOURCE};}
  catch{esuRefresh={status:'unavailable',source:ESU_DIRECT_REFRESH_SOURCE};}
  let rows;try{stages.push('fetch');rows=await fetchTenderPage(database,{limit:maxTendersPerRun});if(!Array.isArray(rows))throw new Error('fetch did not return rows');}catch{return{status:'unavailable',stages,esu_refresh:esuRefresh,error_code:'provider_error'};}
  const evaluated=[];try{stages.push('gate');for(const row of rows)evaluated.push({row,evaluation:evaluateGate(row,{nowIso})});stages.push('ledger');for(const item of evaluated){const key=computeAgt002RadarPreanalysisIdempotencyKey({kind:'gate',tender_id:item.row.id,source_row_hash:item.evaluation.source_row_hash,policy_version:item.evaluation.policy_version,context_version:item.evaluation.context_version,evaluation_date:item.evaluation.evaluation_date||evaluationDate});const stored=await recordGateEvaluation(database,{tenderId:item.row.id,stableKey:item.row.stable_key||item.row.stableKey,verdict:item.evaluation.verdict,ruleIds:item.evaluation.rule_ids||[],reasons:item.evaluation.reasons||[],dataGaps:item.evaluation.data_gaps||[],policyVersion:item.evaluation.policy_version,contextVersion:item.evaluation.context_version,sourceRowHash:item.evaluation.source_row_hash,idempotencyKey:key,evaluatedAt:nowIso});item.gateEvaluation={...item.evaluation,id:stored?.id,tender_id:item.row.id};}}catch{return{status:'unavailable',stages,esu_refresh:esuRefresh,evaluated:evaluated.length,error_code:'persistence_failure'};}
  const survivors=evaluated.filter(item=>item.evaluation.verdict==='sobreviviente'),eliminated=evaluated.length-survivors.length;let enqueued=0,satisfied=0,rejected=0,job;
  // El encolado es por licitación y la cola sigue siendo fail-closed: una entrada materialmente
  // distinta con un job activo sigue siendo conflicto y no se encola. Pero ese rechazo es de esa
  // fila, no de la corrida: abortar el lote entero dejaba el `claim` sin ejecutar y el job activo
  // sin drenar, de modo que una sola fila en conflicto congelaba el temporizador para siempre.
  try{stages.push('claim');for(const item of survivors){const attemptKey=computeAgt002RadarPreanalysisIdempotencyKey({kind:'attempt',tender_id:item.row.id,gate_evaluation_id:item.gateEvaluation.id,requested_at:nowIso});let outcome;try{outcome=await enqueueJob(database,{tenderId:item.row.id,gateEvaluationId:item.gateEvaluation.id,attemptKey,idempotencyKey:computeAgt002RadarPreanalysisIdempotencyKey({kind:'job',attempt_key:attemptKey}),policyVersion:item.evaluation.policy_version,contextVersion:item.evaluation.context_version,sourceRowHash:item.evaluation.source_row_hash});}catch{rejected+=1;continue;}if(outcome?.status==='satisfied')satisfied+=1;else if(outcome?.status==='created'||outcome?.status==='existing')enqueued+=1;else rejected+=1;}job=await claimJob(database,{leaseSeconds});}catch{return{status:'unavailable',stages,esu_refresh:esuRefresh,evaluated:evaluated.length,survivors:survivors.length,eliminated,enqueued,satisfied,rejected,error_code:'persistence_failure'};}
  const base={esu_refresh:esuRefresh,evaluated:evaluated.length,survivors:survivors.length,eliminated,enqueued,satisfied,rejected};if(!job)return{status:'empty',stages,...base};
  try{
   // Un job encolado puede sobrevivir a la fila que lo justificó: la cola es durable y el gate se
   // reevalúa cada disparo. Antes de llamar a AGT-002 se exige que la evaluación vigente de esta
   // corrida siga siendo superviviente y coincida con la entrada semántica del job. Si no, el job
   // se falla como `stale_input` sin invocar al agente ni persistir una corrida: nunca se produce
   // un canónico positivo para una fila que el gate vigente ya eliminó.
   const matched=evaluated.find(item=>item.row.id===job.tenderId);
   if(!matched||matched.evaluation.verdict!=='sobreviviente'||matched.evaluation.source_row_hash!==job.sourceRowHash
    ||matched.evaluation.policy_version!==job.policyVersion||matched.evaluation.context_version!==job.contextVersion)
    throw Object.assign(new Error('claimed job no longer matches a current survivor'),{runtime_boundary_code:'AGT002_RADAR_STALE_INPUT'});
   stages.push('learning');const observations=await projectLearningObservations(database,{limit:1000});const derived=buildLearningSignals({candidate:candidate(matched.row),observations,maxSignals:maxLearningSignals});const learningSignals=derived.signals.length?derived:null;
   stages.push('agt');const output=await runPreanalysis(database,{environment,tenderRow:matched.row,gateEvaluation:matched.gateEvaluation,learningSignals,idempotencyKey:job.attemptKey});
   stages.push('persist');const persisted=await recordPreanalysisRun(database,{tenderId:job.tenderId,gateEvaluationId:job.gateEvaluationId,visibilityVerdict:output.visibility_verdict,status:output.status,result:output,evidence:output.evidence,policyVersion:matched.evaluation.policy_version,contextVersion:matched.evaluation.context_version,learningSignalsVersion:learningSignals?.version||null,learningSignalsCount:learningSignals?.signals.length||0,model:output.usage?.model||environment.AGT002_RADAR_PREANALYSIS_MODEL||null,usage:output.usage||{},idempotencyKey:computeAgt002RadarPreanalysisIdempotencyKey({kind:'run',attempt_key:job.attemptKey})});await completeJob(database,{jobId:job.jobId,leaseId:job.leaseId,preanalysisRunId:persisted.id});return{status:'completed',stages,...base,job_id:job.jobId,preanalysis_run_id:persisted.id};
  }catch(error){const errorCode=classifyAgt002RadarPreanalysisError(error);try{await failJob(database,{jobId:job.jobId,leaseId:job.leaseId,errorCode});}catch{return{status:'unavailable',stages,...base,job_id:job.jobId,error_code:'persistence_failure'};}return{status:'unavailable',stages,esu_refresh:esuRefresh,job_id:job.jobId,error_code:errorCode};}
 }});
}

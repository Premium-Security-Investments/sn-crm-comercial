import { evaluateAgt002RadarGate } from './agt002-radar-gate.js';
import { recordAgt002RadarGateEvaluation, recordAgt002RadarPreanalysisRun, computeAgt002RadarPreanalysisIdempotencyKey, readAgt002RadarCanonicalPreanalysis } from './agt002-radar-preanalysis-persistence.js';
import { hasAgt002RadarDerivedDayShape, isAgt002RadarDerivedDayOnlyChurn } from './agt002-radar-derived-day-churn.js';
import { claimAgt002RadarPreanalysisJob, completeAgt002RadarPreanalysisJob, failAgt002RadarPreanalysisJob } from './agt002-radar-preanalysis-jobs.js';
import { projectAgt002RadarLearningObservations } from './agt002-radar-learning-projection.js';
import { buildAgt002RadarLearningSignals } from './agt002-radar-learning-retrieval.js';
import { createAgt002RadarPreanalysisRuntime } from './agt002-radar-preanalysis-runtime.js';
import { assertAgt002RadarPreanalysisMeasuredUsage } from './agt002-radar-preanalysis-usage.js';
import { classifyAgt002RadarPreanalysisError } from './agt002-radar-preanalysis-worker.js';
import { buildAgt002AnalysisConfig } from './agt002-analysis-config.js';
import { extractTenderCoreServiceTerms } from './tender-relevance-terms.js';

export const AGT002_RADAR_WORKER_STAGES=Object.freeze(['claim','fetch_row','gate','ledger','learning','agt','persist']);
function enabled(environment){return buildAgt002AnalysisConfig(environment).AGT002_RADAR_GATE;}
function normalize(value){
 if(typeof value!=='string')return null;
 let out='';
 for(const ch of value.normalize('NFD')){const code=ch.codePointAt(0);if(code>=0x0300&&code<=0x036f)continue;out+=ch;}
 return out.toLowerCase().trim();
}
function candidate(row){return{tender_id:row.id,service_terms:extractTenderCoreServiceTerms(`${row.title||''} ${row.description||row.desc||''}`),entity_key:normalize(row.entity_nit||row.entity),modality_key:normalize(row.category||row.modality),source_key:normalize(row.source),territory_key:{city:normalize(row.city),dept:normalize(row.dept)}};}
async function defaultRunPreanalysis(_database,{environment,tenderRow,gateEvaluation,learningSignals,idempotencyKey}){return createAgt002RadarPreanalysisRuntime({environment}).runOnce({tenderRow,gateEvaluation,learningSignals,idempotencyKey});}
function persistenceError(error){const wrapped=error instanceof Error?error:new Error('AGT-002 Radar queue persistence failed.');wrapped.runtime_boundary_code='AGT002_RADAR_PERSISTENCE_FAILURE';return wrapped;}
async function defaultFetchTenderRow(database,{id}){
 let response;
 try{response=await database.from('psi_public_tenders').select('*').eq('id',id).limit(1);}catch(error){throw persistenceError(error);}
 if(response?.error)throw persistenceError(response.error);
 return response?.data?.[0]??null;
}

export function createAgt002RadarWorker({
 database,environment=process.env,now,claimJob=claimAgt002RadarPreanalysisJob,fetchTenderRow=defaultFetchTenderRow,
 evaluateGate=evaluateAgt002RadarGate,recordGateEvaluation=recordAgt002RadarGateEvaluation,
 readCanonicalPreanalysis=readAgt002RadarCanonicalPreanalysis,
 completeJob=completeAgt002RadarPreanalysisJob,failJob=failAgt002RadarPreanalysisJob,
 projectLearningObservations=projectAgt002RadarLearningObservations,buildLearningSignals=buildAgt002RadarLearningSignals,
 runPreanalysis=defaultRunPreanalysis,recordPreanalysisRun=recordAgt002RadarPreanalysisRun,
 leaseSeconds=600,maxLearningSignals=10,
}={}){
 if(!Number.isInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>600||!Number.isInteger(maxLearningSignals)||maxLearningSignals<1||maxLearningSignals>25)throw new Error('AGT002_RADAR_WORKER_CONFIG_INVALID');
 return Object.freeze({async runOnce(){
  if(!enabled(environment))return{status:'disabled',stages:[],code:'AGT002_RADAR_WORKER_DISABLED'};
  const stages=[];
  let nowIso;
  // El reloj se valida ANTES de reclamar: es una función pura inyectada, sin I/O, así que
  // validarla aquí no rompe el invariante "si la cola está vacía, la única operación contra la
  // base es la reclamación". Validarla después dejaría un job reclamado con lease vivo y sin
  // cierre ante un reloj inválido.
  try{nowIso=now();if(typeof nowIso!=='string'||!Number.isFinite(Date.parse(nowIso)))throw new Error('invalid injected time');}
  catch{return{status:'unavailable',stages,error_code:'provider_error'};}
  stages.push('claim');
  let job;
  try{job=await claimJob(database,{leaseSeconds});}catch{return{status:'unavailable',stages,error_code:'persistence_failure'};}
  if(!job)return{status:'empty',stages};
  try{
   stages.push('fetch_row');
   const row=await fetchTenderRow(database,{id:job.tenderId});
   if(!row)throw Object.assign(new Error('claimed job tender row no longer present'),{runtime_boundary_code:'AGT002_RADAR_STALE_INPUT'});

   stages.push('gate');
   const evaluation=evaluateGate(row,{nowIso});

   stages.push('ledger');
   const key=computeAgt002RadarPreanalysisIdempotencyKey({kind:'gate',tender_id:row.id,source_row_hash:evaluation.source_row_hash,policy_version:evaluation.policy_version,context_version:evaluation.context_version,evaluation_date:evaluation.evaluation_date});
   const stored=await recordGateEvaluation(database,{tenderId:row.id,stableKey:row.stable_key||row.stableKey,verdict:evaluation.verdict,ruleIds:evaluation.rule_ids||[],reasons:evaluation.reasons||[],dataGaps:evaluation.data_gaps||[],policyVersion:evaluation.policy_version,contextVersion:evaluation.context_version,sourceRowHash:evaluation.source_row_hash,idempotencyKey:key,evaluatedAt:nowIso});
   const gateEvaluation={...evaluation,id:stored?.id,tender_id:row.id};

   // Un job encolado puede sobrevivir a la fila que lo justificó: la cola es durable y el gate se
   // reevalúa en cada disparo. El gate se recomputa sobre la fila vigente y se compara contra la
   // entrada semántica congelada en el job; si no coincide, el job se falla como `stale_input` sin
   // invocar al agente ni persistir una corrida.
   if(evaluation.verdict!=='sobreviviente'||evaluation.source_row_hash!==job.sourceRowHash
    ||evaluation.policy_version!==job.policyVersion||evaluation.context_version!==job.contextVersion)
    throw Object.assign(new Error('claimed job no longer matches a current survivor'),{runtime_boundary_code:'AGT002_RADAR_STALE_INPUT'});

   // Drenaje gobernado de jobs legacy encolados antes de agt002-radar-derived-day-churn.js: un job
   // puede coincidir exactamente con la fila vigente (chequeo de arriba) y aun así no ser más que el
   // mismo churn de raw.days/raw.window que el scan ya filtra al encolar. Se consulta el canónico
   // sólo si la fila trae la forma derivada exacta (un job por tick: la consulta bulk lleva un único
   // id, nunca N+1) y sólo se clasifica si vuelve exactamente un canónico cuyo tender_id coincide;
   // cualquier forma ausente/duplicada/extraña sigue al modelo. Un fallo técnico de esta lectura se
   // propaga tal cual: ya viene envuelto en AGT002_RADAR_PERSISTENCE_FAILURE y el catch de abajo lo
   // clasifica como persistence_failure, sin encolar ni fallar sobre evidencia que no se pudo leer.
   if(hasAgt002RadarDerivedDayShape(row)){
    const canonicalRows=await readCanonicalPreanalysis(database,[job.tenderId]);
    if(Array.isArray(canonicalRows)&&canonicalRows.length===1&&canonicalRows[0]?.tender_id===job.tenderId
     &&isAgt002RadarDerivedDayOnlyChurn(row,canonicalRows[0],{policyVersion:evaluation.policy_version,contextVersion:evaluation.context_version}))
     throw Object.assign(new Error('claimed job is derived-day-only raw.days/raw.window churn already covered by a canonical run'),{runtime_boundary_code:'AGT002_RADAR_STALE_INPUT'});
   }

   stages.push('learning');
   const observations=await projectLearningObservations(database,{limit:1000});
   const derived=buildLearningSignals({candidate:candidate(row),observations,maxSignals:maxLearningSignals});
   const learningSignals=derived.signals.length?derived:null;

   stages.push('agt');
   const output=await runPreanalysis(database,{environment,tenderRow:row,gateEvaluation,learningSignals,idempotencyKey:job.attemptKey});

   // Issue #136: mismo cierre que el pipeline. `usage` es la medición del puente que el runtime
   // fijó en el envelope; el worker no la reconstruye desde el entorno ni completa una declaración
   // incompleta. Sin medición confiable no se persiste. 0/0 es una medición válida.
   const usage=assertAgt002RadarPreanalysisMeasuredUsage(output?.usage);

   stages.push('persist');
   const persisted=await recordPreanalysisRun(database,{tenderId:job.tenderId,gateEvaluationId:job.gateEvaluationId,visibilityVerdict:output.visibility_verdict,status:output.status,result:output,evidence:output.evidence,policyVersion:evaluation.policy_version,contextVersion:evaluation.context_version,learningSignalsVersion:learningSignals?.version||null,learningSignalsCount:learningSignals?.signals.length||0,model:usage.model,usage,idempotencyKey:computeAgt002RadarPreanalysisIdempotencyKey({kind:'run',attempt_key:job.attemptKey})});

   await completeJob(database,{jobId:job.jobId,leaseId:job.leaseId,preanalysisRunId:persisted.id});
   return{status:'completed',stages,job_id:job.jobId,preanalysis_run_id:persisted.id};
  }catch(error){
   const errorCode=classifyAgt002RadarPreanalysisError(error);
   try{await failJob(database,{jobId:job.jobId,leaseId:job.leaseId,errorCode});}
   catch{return{status:'unavailable',stages,job_id:job.jobId,error_code:'persistence_failure'};}
   return{status:'unavailable',stages,job_id:job.jobId,error_code:errorCode};
  }
 }});
}

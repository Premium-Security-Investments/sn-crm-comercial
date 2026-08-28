import { agt002RadarEvaluationDate, evaluateAgt002RadarGate } from './agt002-radar-gate.js';
import { recordAgt002RadarGateEvaluation, computeAgt002RadarPreanalysisIdempotencyKey, readAgt002RadarCanonicalPreanalysis } from './agt002-radar-preanalysis-persistence.js';
import { enqueueAgt002RadarPreanalysisJob } from './agt002-radar-preanalysis-jobs.js';
import { hasAgt002RadarDerivedDayShape, isAgt002RadarDerivedDayOnlyChurn } from './agt002-radar-derived-day-churn.js';
import { buildAgt002AnalysisConfig } from './agt002-analysis-config.js';
import { ESU_DIRECT_REFRESH_SOURCE } from './esu-direct-refresh.js';

export const AGT002_RADAR_SCAN_STAGES=Object.freeze(['esu_refresh','fetch','gate','ledger','enqueue']);
const AGT002_RADAR_EXPECTED_ACTIVE_JOB_CONFLICT_CODE='55000';
const AGT002_RADAR_EXPECTED_ACTIVE_JOB_CONFLICT_MESSAGE='AGT-002 Radar tender already has a different active job';
// Sólo este conflicto exacto (SQLSTATE 55000 + mensaje fijo de psi_enqueue_agt002_radar_preanalysis_job)
// es un rechazo esperado de ESA fila. Cualquier otro fallo de encolado (fuera de línea, timeout,
// error genérico de Supabase) debe propagarse: contarlo como `rejected` disfrazaría una caída real
// de infraestructura como una corrida exitosa.
function isAgt002RadarExpectedActiveJobConflict(error){
 if(!error||typeof error!=='object')return false;
 const code=error.database_code??error.code;
 return code===AGT002_RADAR_EXPECTED_ACTIVE_JOB_CONFLICT_CODE&&error.message===AGT002_RADAR_EXPECTED_ACTIVE_JOB_CONFLICT_MESSAGE;
}
function enabled(environment){return buildAgt002AnalysisConfig(environment).AGT002_RADAR_GATE;}
// Una sola forma de derivar la clave de licitación, para que el id con el que se pide el canónico y
// el `tender_id` con el que vuelve se comparen exactamente igual.
function agt002RadarTenderKey(value){return String(value??'').trim();}
// Índice canónico por licitación para el lote. 072 declara un único canónico por `tender_id`
// (`psi_agt002_radar_preanalysis_one_canonical_idx`); si aun así llegaran dos, la entrada se
// envenena a `null` y esa licitación se encola: una forma extraña no se clasifica como churn.
function indexCanonicalRunsByTender(canonicalRows){
 const index=new Map();
 for(const canonicalRow of canonicalRows){
  const tenderId=agt002RadarTenderKey(canonicalRow?.tender_id);
  if(!tenderId)continue;
  index.set(tenderId,index.has(tenderId)?null:canonicalRow);
 }
 return index;
}
async function defaultFetch(database,{limit}){const response=await database.from('psi_public_tenders').select('*').order('last_seen_at',{ascending:false}).order('id',{ascending:true}).limit(limit);if(response?.error)throw response.error;return response?.data||[];}
// Safe no-op: touches neither database nor network. The real ESU direct-refresher (backed by
// createEsuDirectRefresher in esu-direct-refresh.js) is wired in by the caller via `refreshEsuDirect`.
async function defaultRefreshEsuDirect(){return{status:'skipped_fresh',source:ESU_DIRECT_REFRESH_SOURCE};}

export function createAgt002RadarScan({
 database,environment=process.env,now,fetchTenderPage=defaultFetch,evaluateGate=evaluateAgt002RadarGate,
 recordGateEvaluation=recordAgt002RadarGateEvaluation,enqueueJob=enqueueAgt002RadarPreanalysisJob,
 readCanonicalPreanalysis=readAgt002RadarCanonicalPreanalysis,
 refreshEsuDirect=defaultRefreshEsuDirect,maxTendersPerRun=250,
}={}){
 if(!Number.isInteger(maxTendersPerRun)||maxTendersPerRun<1||maxTendersPerRun>1000)throw new Error('AGT002_RADAR_SCAN_CONFIG_INVALID');
 return Object.freeze({async runOnce(){
  if(!enabled(environment))return{status:'disabled',stages:[],code:'AGT002_RADAR_SCAN_DISABLED'};
  const stages=[];
  let nowIso,evaluationDate;
  try{nowIso=now();if(typeof nowIso!=='string'||!Number.isFinite(Date.parse(nowIso)))throw new Error('invalid injected time');evaluationDate=agt002RadarEvaluationDate(nowIso);}
  catch{return{status:'unavailable',stages,error_code:'provider_error'};}
  // ESU direct-refresh runs before candidate fetch/gate but never blocks them: a failed or
  // unavailable refresh still lets the scan continue against whatever was already persisted
  // in psi_public_tenders. No synthetic deadline/status is ever fabricated and the gate below
  // evaluates exactly the persisted rows, so ESU availability can never relax the gate.
  stages.push('esu_refresh');
  let esuRefresh;
  try{const result=await refreshEsuDirect(database,{environment,now:nowIso});esuRefresh=result&&typeof result==='object'?result:{status:'unavailable',source:ESU_DIRECT_REFRESH_SOURCE};}
  catch{esuRefresh={status:'unavailable',source:ESU_DIRECT_REFRESH_SOURCE};}
  let rows;try{stages.push('fetch');rows=await fetchTenderPage(database,{limit:maxTendersPerRun});if(!Array.isArray(rows))throw new Error('fetch did not return rows');}catch{return{status:'unavailable',stages,esu_refresh:esuRefresh,error_code:'provider_error'};}
  const evaluated=[];try{stages.push('gate');for(const row of rows)evaluated.push({row,evaluation:evaluateGate(row,{nowIso})});stages.push('ledger');for(const item of evaluated){const key=computeAgt002RadarPreanalysisIdempotencyKey({kind:'gate',tender_id:item.row.id,source_row_hash:item.evaluation.source_row_hash,policy_version:item.evaluation.policy_version,context_version:item.evaluation.context_version,evaluation_date:item.evaluation.evaluation_date||evaluationDate});const stored=await recordGateEvaluation(database,{tenderId:item.row.id,stableKey:item.row.stable_key||item.row.stableKey,verdict:item.evaluation.verdict,ruleIds:item.evaluation.rule_ids||[],reasons:item.evaluation.reasons||[],dataGaps:item.evaluation.data_gaps||[],policyVersion:item.evaluation.policy_version,contextVersion:item.evaluation.context_version,sourceRowHash:item.evaluation.source_row_hash,idempotencyKey:key,evaluatedAt:nowIso});item.gateEvaluation={...item.evaluation,id:stored?.id,tender_id:item.row.id};}}catch{return{status:'unavailable',stages,esu_refresh:esuRefresh,evaluated:evaluated.length,error_code:'persistence_failure'};}
  const survivors=evaluated.filter(item=>item.evaluation.verdict==='sobreviviente'),eliminated=evaluated.length-survivors.length;
  let enqueued=0,satisfied=0,rejected=0,satisfiedDerivedOnly=0;
  // El encolado es por licitación y la cola sigue siendo fail-closed: una entrada materialmente
  // distinta con un job activo sigue siendo conflicto y no se encola. Pero ese rechazo es de esa
  // fila, no de la corrida: una sola fila en conflicto no debe congelar el resto del lote.
  //
  // Antes de encolar se filtra el churn puramente derivado de raw.days/raw.window
  // (agt002-radar-derived-day-churn.js). Los canónicos se cargan **en bloque, una sola vez por
  // corrida** con el lector ya existente —que a su vez trocea de a 250 ids—, nunca fila por fila:
  // el scan diario procesa hasta 250 licitaciones y un N+1 aquí serían 250 viajes de red extra.
  // La consulta sólo se paga si alguna superviviente trae la forma derivada exacta; una fila sin
  // ella jamás podría clasificarse y por tanto no necesita su canónico. Un fallo de esa lectura es
  // técnico, no un rechazo de negocio: cae al `catch` de abajo y hace fallar la corrida entera, sin
  // encolar sobre evidencia que no se pudo leer.
  try{stages.push('enqueue');
   const derivedCandidates=survivors.filter(item=>hasAgt002RadarDerivedDayShape(item.row));
   let canonicalByTender=new Map();
   if(derivedCandidates.length){
    const canonicalRows=await readCanonicalPreanalysis(database,derivedCandidates.map(item=>agt002RadarTenderKey(item.row.id)));
    if(!Array.isArray(canonicalRows))throw new Error('canonical preanalysis lookup did not return rows');
    canonicalByTender=indexCanonicalRunsByTender(canonicalRows);
   }
   for(const item of survivors){const canonicalRun=canonicalByTender.get(agt002RadarTenderKey(item.row.id))||null;if(canonicalRun&&isAgt002RadarDerivedDayOnlyChurn(item.row,canonicalRun,{policyVersion:item.evaluation.policy_version,contextVersion:item.evaluation.context_version})){satisfiedDerivedOnly+=1;continue;}const attemptKey=computeAgt002RadarPreanalysisIdempotencyKey({kind:'attempt',tender_id:item.row.id,gate_evaluation_id:item.gateEvaluation.id,requested_at:nowIso});let outcome;try{outcome=await enqueueJob(database,{tenderId:item.row.id,gateEvaluationId:item.gateEvaluation.id,attemptKey,idempotencyKey:computeAgt002RadarPreanalysisIdempotencyKey({kind:'job',attempt_key:attemptKey}),policyVersion:item.evaluation.policy_version,contextVersion:item.evaluation.context_version,sourceRowHash:item.evaluation.source_row_hash});}catch(error){if(isAgt002RadarExpectedActiveJobConflict(error)){rejected+=1;continue;}throw error;}if(outcome?.status==='satisfied')satisfied+=1;else if(outcome?.status==='created'||outcome?.status==='existing')enqueued+=1;else rejected+=1;}}
  catch{return{status:'unavailable',stages,esu_refresh:esuRefresh,evaluated:evaluated.length,survivors:survivors.length,eliminated,enqueued,satisfied,rejected,satisfied_derived_only:satisfiedDerivedOnly,error_code:'persistence_failure'};}
  // `satisfied` sigue siendo exactamente el corto circuito del RPC; `satisfied_derived_only` es el
  // contador propio de este hotfix, separado a propósito para poder medirlo y retirarlo.
  return{status:'completed',stages,esu_refresh:esuRefresh,evaluated:evaluated.length,survivors:survivors.length,eliminated,enqueued,satisfied,rejected,satisfied_derived_only:satisfiedDerivedOnly};
 }});
}

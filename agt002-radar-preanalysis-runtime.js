import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';
import { buildAgt002AnalysisConfig } from './agt002-analysis-config.js';
import { AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA, AGT002_RADAR_PREANALYSIS_POLICY_VERSION, validateAgt002RadarPreanalysis } from './agt002-radar-preanalysis-contract.js';
import { buildAgt002RadarPreanalysisInput } from './agt002-radar-preanalysis-input.js';

const REQUIRED=['AGT002_RADAR_PREANALYSIS_MODEL','AGT002_HETZNER_BRIDGE_URL','AGT002_HETZNER_BRIDGE_HMAC_SECRET'];
const DEFAULT_TIMEOUT_MS=30_000;
const MIN_TIMEOUT_MS=1_000;
// El pipeline reclama el job con leaseSeconds=600. Un timeout de proveedor igual al lease no deja
// margen para aprendizaje, validación de entrada ni persistencia: una respuesta exitosa llegaría con
// la reserva ya vencida. El techo de 5 min garantiza >=300 s de holgura bajo el lease de producción.
const MAX_TIMEOUT_MS=300_000;
const POLICY=`Produce únicamente un preanálisis de visibilidad del proceso, basado en evidencia citada, con revisión humana obligatoria.
Devuelve exactamente el JSON solicitado por el schema, sin texto adicional.
Copia tender_id exactamente de input.tender.tender_id, gate_evaluation_id exactamente de input.gate.gate_evaluation_id y context_version exactamente de input.gate.context_version. Usa policy_version agt002-radar-preanalysis-policy-v1 y human_review_required=true.
Asigna a cada elemento de evidence un evidence_id único. Cada valor de signals[].evidence_refs debe copiar exactamente uno de los evidence[].evidence_id definidos en tu misma respuesta; nunca uses allí referencias a campos, reglas ni señales de aprendizaje.
Cuando evidence_type sea learning_signal, evidence.reference debe copiar exactamente un signal_id disponible en input.learning_signals.signals[].signal_id. Si no existe una señal de aprendizaje aplicable, no inventes una referencia: usa evidencia propia tender_field o gate_rule, o abstente con status=abstained y visibility_verdict=no_concluyente.
No emitas determinaciones comerciales, conversiones, recomendaciones ni decisiones; sólo visibilidad preliminar para revisión humana.`;
function nonempty(value){return typeof value==='string'&&value.trim().length>0;}
function boundary(error,code,message='AGT-002 Radar preanalysis unavailable.') { const wrapped=error instanceof Error?error:new Error(message); wrapped.runtime_boundary_code=code; return wrapped; }
export function isAgt002RadarPreanalysisConfigured(environment=process.env){let gateEnabled=false;try{gateEnabled=buildAgt002AnalysisConfig(environment).AGT002_RADAR_GATE;}catch{return false;}return gateEnabled&&REQUIRED.every(key=>nonempty(environment[key]));}
export function getAgt002RadarPreanalysisRuntimeConfig(environment=process.env){
  if(!isAgt002RadarPreanalysisConfigured(environment)){const error=new Error('AGT002_RADAR_RUNTIME_CONFIG_INVALID: runtime is off or incomplete');error.code='AGT002_RADAR_RUNTIME_CONFIG_INVALID';throw error;}
  const timeoutMs=nonempty(environment.AGT002_RADAR_PREANALYSIS_TIMEOUT_MS)?Number(environment.AGT002_RADAR_PREANALYSIS_TIMEOUT_MS):DEFAULT_TIMEOUT_MS;
  if(!Number.isInteger(timeoutMs)||timeoutMs<MIN_TIMEOUT_MS||timeoutMs>MAX_TIMEOUT_MS){const error=new Error('AGT002_RADAR_RUNTIME_CONFIG_INVALID: timeout');error.code='AGT002_RADAR_RUNTIME_CONFIG_INVALID';throw error;}
  return Object.freeze({model:environment.AGT002_RADAR_PREANALYSIS_MODEL.trim(),timeoutMs,bridgeUrl:environment.AGT002_HETZNER_BRIDGE_URL.trim(),hmacSecret:environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET});
}
export function createAgt002RadarPreanalysisRuntime({environment=process.env,createClient=createAgt002HetznerBridgeClient}={}){
  let config,client; try{config=getAgt002RadarPreanalysisRuntimeConfig(environment);client=createClient({url:config.bridgeUrl,hmacSecret:config.hmacSecret});}catch(error){throw boundary(error,'AGT002_RADAR_RUNTIME_CONFIG_INVALID');}
  return Object.freeze({
    config,
    async runOnce({tenderRow,gateEvaluation,learningSignals=null,idempotencyKey,signal}={}){
      let input; try{input=buildAgt002RadarPreanalysisInput({tenderRow,gateEvaluation,learningSignals});}catch(error){throw boundary(error,'AGT002_RADAR_PREANALYSIS_INPUT_INVALID');}
      let response; try{response=await client.run({model:config.model,policy:POLICY,input,outputSchema:AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA,timeoutMs:config.timeoutMs,idempotencyKey,signal});}
      catch(error){const raw=String(error?.code||'').toUpperCase();throw boundary(error,raw.includes('TIMEOUT')?'AGT002_RADAR_PREANALYSIS_TIMEOUT':'AGT002_RADAR_PREANALYSIS_PROVIDER_ERROR');}
      try{
        const output=response?.output??JSON.parse(response?.content);
        const expectedLearningSignalIds=learningSignals?.signals?.map(item=>item.signal_id)||[];
        validateAgt002RadarPreanalysis(output,{expectedLearningSignalIds});
        if(output.tender_id!==tenderRow.id||output.gate_evaluation_id!==gateEvaluation.id||output.policy_version!==AGT002_RADAR_PREANALYSIS_POLICY_VERSION||output.context_version!==gateEvaluation.context_version) throw new Error('output provenance mismatch');
        return output;
      }catch(error){throw boundary(error,'AGT002_RADAR_PREANALYSIS_INVALID_OUTPUT');}
    },
  });
}

import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';
import { AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA, validateAgt002RadarPreanalysis } from './agt002-radar-preanalysis-contract.js';
import { buildAgt002RadarPreanalysisInput } from './agt002-radar-preanalysis-input.js';

const REQUIRED=['AGT002_RADAR_PREANALYSIS_MODEL','AGT002_HETZNER_BRIDGE_URL','AGT002_HETZNER_BRIDGE_HMAC_SECRET'];
const POLICY='Produce únicamente un preanálisis de visibilidad del proceso, basado en evidencia citada, con revisión humana obligatoria.';
function nonempty(value){return typeof value==='string'&&value.trim().length>0;}
function boundary(error,code,message='AGT-002 Radar preanalysis unavailable.') { const wrapped=error instanceof Error?error:new Error(message); wrapped.runtime_boundary_code=code; return wrapped; }
export function isAgt002RadarPreanalysisConfigured(environment=process.env){return environment?.AGT002_RADAR_GATE==='true'&&REQUIRED.every(key=>nonempty(environment[key]));}
export function getAgt002RadarPreanalysisRuntimeConfig(environment=process.env){
  if(!isAgt002RadarPreanalysisConfigured(environment)){const error=new Error('AGT002_RADAR_RUNTIME_CONFIG_INVALID: runtime is off or incomplete');error.code='AGT002_RADAR_RUNTIME_CONFIG_INVALID';throw error;}
  const timeoutMs=nonempty(environment.AGT002_RADAR_PREANALYSIS_TIMEOUT_MS)?Number(environment.AGT002_RADAR_PREANALYSIS_TIMEOUT_MS):30_000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600_000){const error=new Error('AGT002_RADAR_RUNTIME_CONFIG_INVALID: timeout');error.code='AGT002_RADAR_RUNTIME_CONFIG_INVALID';throw error;}
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
        if(output.tender_id!==tenderRow.id||output.gate_evaluation_id!==gateEvaluation.id||output.policy_version!==gateEvaluation.policy_version||output.context_version!==gateEvaluation.context_version) throw new Error('output provenance mismatch');
        return output;
      }catch(error){throw boundary(error,'AGT002_RADAR_PREANALYSIS_INVALID_OUTPUT');}
    },
  });
}

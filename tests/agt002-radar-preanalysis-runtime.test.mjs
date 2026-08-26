import assert from 'node:assert/strict';
import { createAgt002RadarPreanalysisRuntime, getAgt002RadarPreanalysisRuntimeConfig, isAgt002RadarPreanalysisConfigured } from '../agt002-radar-preanalysis-runtime.js';

const env = { AGT002_RADAR_GATE:'true', AGT002_RADAR_PREANALYSIS_MODEL:'m1', AGT002_HETZNER_BRIDGE_URL:'https://bridge.example.test/run', AGT002_HETZNER_BRIDGE_HMAC_SECRET:'x'.repeat(48) };
assert.equal(isAgt002RadarPreanalysisConfigured(env), true);
assert.equal(isAgt002RadarPreanalysisConfigured({...env,AGT002_RADAR_GATE:' 1 '}), true);
assert.equal(isAgt002RadarPreanalysisConfigured({...env,AGT002_RADAR_GATE:'TRUE'}), true);
assert.equal(isAgt002RadarPreanalysisConfigured({...env,AGT002_RADAR_GATE:'false'}), false);
assert.equal(isAgt002RadarPreanalysisConfigured({...env,AGT002_RADAR_PREANALYSIS_MODEL:''}), false);
assert.equal(isAgt002RadarPreanalysisConfigured({}), false);
assert.equal(getAgt002RadarPreanalysisRuntimeConfig(env).model, 'm1');
assert.throws(() => getAgt002RadarPreanalysisRuntimeConfig({...env,AGT002_RADAR_PREANALYSIS_TIMEOUT_MS:'abc'}), /AGT002_RADAR_RUNTIME_CONFIG_INVALID/);
assert.throws(() => createAgt002RadarPreanalysisRuntime({environment:{}}), /AGT002_RADAR_RUNTIME_CONFIG_INVALID/);

const tenderRow = { id:'22222222-2222-4222-8222-222222222222', stable_key:'k1', title:'Vigilancia', description:'Armada', status:'abierto', deadline_at:'2026-12-31' };
const gateEvaluation = { id:'33333333-3333-4333-8333-333333333333',tender_id:tenderRow.id,verdict:'sobreviviente',rule_ids:[],reasons:[],data_gaps:[],policy_version:'p1',context_version:'c1',source_row_hash:'a'.repeat(64) };
const invalid = createAgt002RadarPreanalysisRuntime({ environment:env, createClient:() => ({run:async () => ({output:{agent_id:'AGT-003'}})}) });
await assert.rejects(() => invalid.runOnce({tenderRow,gateEvaluation,learningSignals:null}), error => error.runtime_boundary_code === 'AGT002_RADAR_PREANALYSIS_INVALID_OUTPUT');

let request;
const validOutput = { schema_version:'agt002-radar-preanalysis-v1',agent_id:'AGT-002',run_id:'run1',policy_version:'p1',context_version:'c1',tender_id:tenderRow.id,gate_evaluation_id:gateEvaluation.id,status:'completed',visibility_verdict:'mostrar_en_radar',summary:'Vigilancia verificable.',signals:[{signal_id:'s1',text:'Compatible.',evidence_refs:['e1']}],evidence:[{evidence_id:'e1',evidence_type:'tender_field',reference:'title',observed_value:'Vigilancia',policy_version:'p1',context_version:'c1'}],data_gaps:[],human_review_required:true,usage:{provider:'hetzner_bridge',model:'m1',input_tokens:1,output_tokens:1,cost_usd:0} };
const runtime = createAgt002RadarPreanalysisRuntime({environment:env,createClient:()=>({run:async value => {request=value; return {content:JSON.stringify(validOutput),usage:{input_tokens:1,output_tokens:1}};}})});
assert.deepEqual(await runtime.runOnce({tenderRow,gateEvaluation,learningSignals:null,idempotencyKey:'idem'}),validOutput);
assert.equal(request.model,'m1'); assert.equal(request.idempotencyKey,'idem'); assert.equal(request.input.learning_signals,null);
console.log('AGT-002 Radar runtime fail-closed validation passed');

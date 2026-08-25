import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAgt002RadarLearningProposals } from '../agt002-radar-learning-proposals.js';
import { buildAgt002RadarPreanalysisInput } from '../agt002-radar-preanalysis-input.js';
import { evaluateAgt002RadarGate } from '../agt002-radar-gate.js';
const observations={schema_version:'agt002-radar-learning-observations-v1',precedents:[{observation_id:'p1',signal_polarity:'favorable',evidence:[{record_id:'r1',evidence_type:'human_decision'}],service_terms:['vigilancia']},{observation_id:'p2',signal_polarity:'desfavorable',evidence:[{record_id:'r2',evidence_type:'offer_outcome'}],service_terms:['vigilancia']}]};
const draft=buildAgt002RadarLearningProposals({observations,generatedAt:'2026-08-25T00:00:00.000Z'});assert.equal(draft.status,'DRAFT');assert.equal(draft.human_approval_required,true);assert.equal(draft.generated_at,'2026-08-25T00:00:00.000Z');assert.equal(draft.aggregates.total_observations,2);assert.deepEqual(draft.evidence_record_ids,['r1','r2']);assert.equal('candidate_id' in draft,false);assert.equal('signals' in draft,false);
assert.throws(()=>buildAgt002RadarPreanalysisInput({tenderRow:{id:'x'},gateEvaluation:{verdict:'sobreviviente'},learningSignals:draft}),/INVALID/);assert.throws(()=>evaluateAgt002RadarGate(draft,{nowIso:'2026-08-25T00:00:00Z'}),/input/i);
const pipelinePath=new URL('../agt002-radar-pipeline.js',import.meta.url);try{const source=readFileSync(pipelinePath,'utf8');assert.doesNotMatch(source,/agt002-radar-learning-proposals|buildAgt002RadarLearningProposals/);}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('AGT-002 aggregate learning stays isolated in human DRAFT proposals');

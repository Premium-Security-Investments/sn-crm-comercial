import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_LEARNING_MAX_SCORE, AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT, buildAgt002RadarLearningSignals } from '../agt002-radar-learning-retrieval.js';
import { projectAgt002RadarLearningObservations } from '../agt002-radar-learning-projection.js';
const candidate={tender_id:'candidate-1',service_terms:['vigilancia','armada'],entity_key:'entidad-a',modality_key:'licitacion-publica',source_key:'secop-ii',territory_key:{city:'bogota',dept:'cundinamarca'}};
const observations={precedents:[
{observation_id:'p3',tender_id:'t3',service_terms:['aseo'],entity_key:'otra',modality_key:'minima-cuantia',source_key:'secop-i',territory_key:{city:'cali',dept:'valle'},decided_at:'2026-08-03T00:00:00.000Z',signal_polarity:'desfavorable',evidence:[{record_id:'r3',evidence_type:'offer_outcome'}]},
{observation_id:'p2',tender_id:'t2',service_terms:['vigilancia'],entity_key:'otra',modality_key:'licitacion-publica',source_key:'secop-ii',territory_key:{city:'medellin',dept:'antioquia'},decided_at:'2026-08-02T00:00:00.000Z',signal_polarity:'desfavorable',evidence:[{record_id:'r2',evidence_type:'human_decision'}]},
{observation_id:'p1',tender_id:'t1',service_terms:['vigilancia','armada'],entity_key:'entidad-a',modality_key:'licitacion-publica',source_key:'secop-ii',territory_key:{city:'bogota',dept:'cundinamarca'},decided_at:'2026-08-01T00:00:00.000Z',signal_polarity:'favorable',evidence:[{record_id:'r1',evidence_type:'converted_tender'}]},
]};
const top1=buildAgt002RadarLearningSignals({candidate,observations,maxSignals:1});
assert.equal(top1.candidate_id,candidate.tender_id);assert.equal(top1.max_signals,1);assert.deepEqual(top1.signals.map(s=>s.observation_id),['p1']);assert.equal(top1.considered,2);assert.ok(top1.signals[0].candidate_match.length>=1);assert.equal(top1.signals[0].score,16);assert.equal(top1.signals[0].max_score,AGT002_RADAR_LEARNING_MAX_SCORE);assert.equal(top1.signals[0].effect,'raise_relative_priority');assert.deepEqual(top1.signals[0].evidence,[{record_id:'r1',evidence_type:'converted_tender'}]);
assert.ok(top1.signals[0].candidate_match.every(m=>['servicio_objeto','entidad','modalidad','fuente','territorio'].includes(m.dimension)&&Number.isInteger(m.weight)&&m.weight>0));
const other={...candidate,tender_id:'candidate-2',service_terms:['aseo'],entity_key:'otra',modality_key:'minima-cuantia',source_key:'secop-i',territory_key:{city:'cali',dept:'valle'}};assert.deepEqual(buildAgt002RadarLearningSignals({candidate:other,observations,maxSignals:1}).signals.map(s=>s.observation_id),['p3']);
assert.equal(JSON.stringify(buildAgt002RadarLearningSignals({candidate,observations,maxSignals:2})),JSON.stringify(buildAgt002RadarLearningSignals({candidate,observations:{precedents:[...observations.precedents].reverse()},maxSignals:2})));
assert.throws(()=>buildAgt002RadarLearningSignals({candidate,observations}),/AGT002_RADAR_LEARNING_SIGNALS_INVALID/);assert.throws(()=>buildAgt002RadarLearningSignals({candidate,observations,maxSignals:AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT+1}),/AGT002_RADAR_LEARNING_SIGNALS_INVALID/);
assert.deepEqual(buildAgt002RadarLearningSignals({candidate:{...candidate,tender_id:'candidate-3',service_terms:['helicoptero'],entity_key:'sin-par',modality_key:null,source_key:'esu',territory_key:{city:'tunja',dept:'boyaca'}},observations,maxSignals:5}).signals,[]);
assert.equal(top1.signals.some(s=>s.effect==='exclude'),false);assert.equal(buildAgt002RadarLearningSignals({candidate,observations,maxSignals:2}).signals.find(s=>s.observation_id==='p2').effect,'lower_relative_priority');
const missingModality=buildAgt002RadarLearningSignals({candidate:{...candidate,modality_key:null},observations,maxSignals:1});assert.ok(missingModality.data_gaps.some(g=>g.gap_id==='modalidad_no_reportada'));

const source=readFileSync(new URL('../agt002-radar-learning-projection.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\.(insert|update|upsert|delete)\s*\(/);
const readCalls=[];const fake={from:table=>{readCalls.push(table);return{select(){return this;},limit(){return Promise.resolve({data:[],error:null});}};}};assert.deepEqual(await projectAgt002RadarLearningObservations(fake,{limit:10}),{schema_version:'agt002-radar-learning-observations-v1',precedents:[]});assert.equal(readCalls.length,4);
console.log('AGT-002 candidate-specific deterministic learning retrieval passed');

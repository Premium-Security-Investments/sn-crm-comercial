import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_LEARNING_MAX_SCORE, AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT, buildAgt002RadarLearningSignals } from '../agt002-radar-learning-retrieval.js';
import { projectAgt002RadarLearningObservations } from '../agt002-radar-learning-projection.js';
import { extractTenderCoreServiceTerms } from '../tender-relevance-terms.js';
const candidate={tender_id:'candidate-1',service_terms:['servicio de vigilancia','vigilancia armada'],entity_key:'entidad-a',modality_key:'licitacion-publica',source_key:'secop-ii',territory_key:{city:'bogota',dept:'cundinamarca'}};
const observations={precedents:[
{observation_id:'p3',tender_id:'t3',service_terms:[],entity_key:'otra',modality_key:'minima-cuantia',source_key:'secop-i',territory_key:{city:'cali',dept:'valle'},decided_at:'2026-08-03T00:00:00.000Z',signal_polarity:'desfavorable',evidence:[{record_id:'r3',evidence_type:'offer_outcome'}]},
{observation_id:'p2',tender_id:'t2',service_terms:['servicio de vigilancia'],entity_key:'otra',modality_key:'licitacion-publica',source_key:'secop-ii',territory_key:{city:'medellin',dept:'antioquia'},decided_at:'2026-08-02T00:00:00.000Z',signal_polarity:'desfavorable',evidence:[{record_id:'r2',evidence_type:'human_decision'}]},
{observation_id:'p1',tender_id:'t1',service_terms:['servicio de vigilancia','vigilancia armada'],entity_key:'entidad-a',modality_key:'licitacion-publica',source_key:'secop-ii',territory_key:{city:'bogota',dept:'cundinamarca'},decided_at:'2026-08-01T00:00:00.000Z',signal_polarity:'favorable',evidence:[{record_id:'r1',evidence_type:'converted_tender'}]},
]};
const top1=buildAgt002RadarLearningSignals({candidate,observations,maxSignals:1});
assert.equal(top1.candidate_id,candidate.tender_id);assert.equal(top1.max_signals,1);assert.deepEqual(top1.signals.map(s=>s.observation_id),['p1']);assert.equal(top1.considered,2);assert.ok(top1.signals[0].candidate_match.length>=1);assert.equal(top1.signals[0].score,16);assert.equal(top1.signals[0].max_score,AGT002_RADAR_LEARNING_MAX_SCORE);assert.equal(top1.signals[0].effect,'raise_relative_priority');assert.deepEqual(top1.signals[0].evidence,[{record_id:'r1',evidence_type:'converted_tender'}]);
assert.ok(top1.signals[0].candidate_match.every(m=>['servicio_objeto','entidad','modalidad','fuente','territorio'].includes(m.dimension)&&Number.isInteger(m.weight)&&m.weight>0));
const other={...candidate,tender_id:'candidate-2',service_terms:[],entity_key:'otra',modality_key:'minima-cuantia',source_key:'secop-i',territory_key:{city:'cali',dept:'valle'}};assert.deepEqual(buildAgt002RadarLearningSignals({candidate:other,observations,maxSignals:1}).signals.map(s=>s.observation_id),['p3']);
assert.equal(JSON.stringify(buildAgt002RadarLearningSignals({candidate,observations,maxSignals:2})),JSON.stringify(buildAgt002RadarLearningSignals({candidate,observations:{precedents:[...observations.precedents].reverse()},maxSignals:2})));
assert.throws(()=>buildAgt002RadarLearningSignals({candidate,observations}),/AGT002_RADAR_LEARNING_SIGNALS_INVALID/);assert.throws(()=>buildAgt002RadarLearningSignals({candidate,observations,maxSignals:AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT+1}),/AGT002_RADAR_LEARNING_SIGNALS_INVALID/);
assert.deepEqual(buildAgt002RadarLearningSignals({candidate:{...candidate,tender_id:'candidate-3',service_terms:[],entity_key:'sin-par',modality_key:null,source_key:'esu',territory_key:{city:'tunja',dept:'boyaca'}},observations,maxSignals:5}).signals,[]);
assert.deepEqual(extractTenderCoreServiceTerms('Servicio de aseo para proceso contractual'),[]);
assert.deepEqual(extractTenderCoreServiceTerms('Servicio de vigilancia armada con CCTV'),['cctv','servicio de vigilancia','vigilancia armada']);
const genericCandidate={tender_id:'generic-candidate',service_terms:extractTenderCoreServiceTerms('Servicio de aseo'),entity_key:'a',modality_key:null,source_key:null,territory_key:{city:null,dept:null}};
const securityObservation={observation_id:'security',tender_id:'security-tender',service_terms:extractTenderCoreServiceTerms('Servicio de vigilancia'),entity_key:'b',modality_key:null,source_key:null,territory_key:{city:null,dept:null},decided_at:'2026-08-01T00:00:00.000Z',signal_polarity:'favorable',evidence:[{record_id:'security-record',evidence_type:'converted_tender'}]};
assert.deepEqual(buildAgt002RadarLearningSignals({candidate:genericCandidate,observations:{precedents:[securityObservation]},maxSignals:1}).signals,[],'el token genérico servicio no hace comparables objetos distintos');
assert.equal(top1.signals.some(s=>s.effect==='exclude'),false);assert.equal(buildAgt002RadarLearningSignals({candidate,observations,maxSignals:2}).signals.find(s=>s.observation_id==='p2').effect,'lower_relative_priority');
const missingModality=buildAgt002RadarLearningSignals({candidate:{...candidate,modality_key:null},observations,maxSignals:1});assert.ok(missingModality.data_gaps.some(g=>g.gap_id==='modalidad_no_reportada'));

const source=readFileSync(new URL('../agt002-radar-learning-projection.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\.(insert|update|upsert|delete)\s*\(/);
const readCalls=[];const queryCalls=[];
const tender={id:'t-projection',title:'Servicio de vigilancia armada',description:'Guardas',entity:'Entidad',city:'Bogotá',dept:'Cundinamarca',source:'SECOP II',category:'Licitación'};
const fake={from:table=>{readCalls.push(table);const tableCalls=[];const track=(method,column,value)=>{const call={table,method,column,value};tableCalls.push(call);queryCalls.push(call);return query;};const query={
 select(fields){return track('select','fields',fields);},
 eq(column,value){return track('eq',column,value);},
 in(column,value){return track('in',column,value);},
 is(column,value){return track('is',column,value);},
 order(column,value){return track('order',column,value);},
 limit(value){
  track('limit','limit',value);
  const filteredStatuses=tableCalls.some(call=>call.method==='in'&&call.column==='to_status'&&call.value.join(',')==='presentada,adjudicada,no_adjudicada');
  const supersessionEdgeLookup=tableCalls.some(call=>call.method==='in'&&call.column==='supersedes_decision_id');
  if(table==='psi_tender_offer_status_transitions'&&filteredStatuses)return Promise.resolve({data:[{id:'transition-relevant',tender_id:tender.id,to_status:'adjudicada',changed_at:'2026-08-03T00:00:00Z',psi_public_tenders:tender}],error:null});
  if(table==='psi_tender_go_no_go_decisions')return Promise.resolve({data:supersessionEdgeLookup?[]:[{id:'decision-current',tender_id:tender.id,decision:'no_go',decided_at:'2026-08-02T00:00:00Z',supersedes_decision_id:null,psi_public_tenders:tender}],error:null});
  return Promise.resolve({data:[],error:null});
 },
};return query;}};
const projected=await projectAgt002RadarLearningObservations(fake,{limit:10});
assert.deepEqual(projected.precedents.map(item=>item.observation_id),['human_decision:decision-current','offer_outcome:transition-relevant']);
assert.equal(readCalls.length,5,'cuatro fuentes más la resolución acotada de la arista inversa de supersesión');
assert.ok(queryCalls.some(call=>call.table==='psi_public_tenders'&&call.method==='eq'&&call.column==='internal_status'&&call.value==='convertida_oportunidad'),'sólo las conversiones manuales pueden originar converted_tender');
assert.ok(queryCalls.some(call=>call.table==='psi_tender_analysis_runs'&&call.method==='eq'&&call.column==='canonical'&&call.value===true),'sólo el análisis canónico puede originar canonical_analysis');
assert.ok(queryCalls.some(call=>call.table==='psi_tender_analysis_runs'&&call.method==='eq'&&call.column==='status'&&call.value==='completed'),'un análisis no completado no puede ser precedente');
assert.ok(queryCalls.some(call=>call.table==='psi_tender_go_no_go_decisions'&&call.method==='select'&&call.value.includes('supersedes_decision_id')),'la vigencia GO/NO-GO se resuelve por la columna plana existente');
assert.ok(queryCalls.some(call=>call.table==='psi_tender_go_no_go_decisions'&&call.method==='in'&&call.column==='supersedes_decision_id'&&call.value.includes('decision-current')),'la arista inversa se consulta acotada a las decisiones aún candidatas a vigentes');
assert.equal(queryCalls.some(call=>call.method==='select'&&/superseded_by:|!left\(|_fkey/.test(call.value)),false,'ninguna lectura depende de una relación PostgREST autorreferente');
assert.equal(queryCalls.some(call=>call.method==='is'),false,'no se filtra por un embed inexistente en el schema cache');
assert.ok(queryCalls.some(call=>call.table==='psi_tender_offer_status_transitions'&&call.method==='in'&&call.column==='to_status'),'estados irrelevantes se filtran antes del límite');
for(const table of readCalls){
 const calls=queryCalls.filter(call=>call.table===table);const limitIndex=calls.findIndex(call=>call.method==='limit');
 assert.ok(calls.some((call,index)=>call.method==='order'&&index<limitIndex),`${table} ordena determinísticamente antes de limit`);
}
console.log('AGT-002 candidate-specific deterministic learning retrieval passed');

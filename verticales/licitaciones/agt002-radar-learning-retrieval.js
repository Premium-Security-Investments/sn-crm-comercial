import { isTenderCoreServiceTerm } from './tender-relevance-terms.js';

export const AGT002_RADAR_LEARNING_SIGNALS_VERSION='agt002-radar-learning-v1';
export const AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT=25;
export const AGT002_RADAR_LEARNING_DIMENSIONS=Object.freeze(['servicio_objeto','entidad','modalidad','fuente','territorio']);
export const AGT002_RADAR_LEARNING_MAX_SCORE=19;
function invalid(message){const error=new Error(`AGT002_RADAR_LEARNING_SIGNALS_INVALID: ${message}`);error.code='AGT002_RADAR_LEARNING_SIGNALS_INVALID';throw error;}
function key(value){return typeof value==='string'&&value.trim()?value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase():null;}
function validCandidate(value){return value&&typeof value==='object'&&key(value.tender_id)&&Array.isArray(value.service_terms)&&value.service_terms.every(item=>isTenderCoreServiceTerm(item))&&value.territory_key&&typeof value.territory_key==='object';}
function exactMatch(dimension,candidateValue,observedValue,weight){const left=key(candidateValue),right=key(observedValue);return left&&right&&left===right?{dimension,candidate_value:left,observation_value:right,matched_value:left,weight}:null;}
function score(candidate,observation){
 const matches=[];const cTerms=[...new Set(candidate.service_terms.map(key).filter(Boolean))],oTerms=new Set((observation.service_terms||[]).map(key).filter(Boolean));const shared=cTerms.filter(term=>oTerms.has(term)).sort().slice(0,3);if(shared.length)matches.push({dimension:'servicio_objeto',candidate_value:cTerms,observation_value:[...oTerms].sort(),matched_value:shared,weight:shared.length*3});
 for(const item of [exactMatch('entidad',candidate.entity_key,observation.entity_key,4),exactMatch('modalidad',candidate.modality_key,observation.modality_key,3),exactMatch('fuente',candidate.source_key,observation.source_key,1)])if(item)matches.push(item);
 const city=exactMatch('territorio',candidate.territory_key?.city,observation.territory_key?.city,2);const dept=exactMatch('territorio',candidate.territory_key?.dept,observation.territory_key?.dept,1);if(city)matches.push(city);else if(dept)matches.push(dept);
 return{matches,score:matches.reduce((sum,item)=>sum+item.weight,0)};
}
export function buildAgt002RadarLearningSignals({candidate,observations,maxSignals}={}){
 if(!validCandidate(candidate)||!observations||!Array.isArray(observations.precedents)||!Number.isInteger(maxSignals)||maxSignals<1||maxSignals>AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT)invalid('closed candidate, observations and maxSignals required');
 const seen=new Set();const comparable=[];const dataGaps=[];if(!key(candidate.modality_key))dataGaps.push({gap_id:'modalidad_no_reportada',subject:'candidate',candidate_id:candidate.tender_id});
 for(const observation of observations.precedents){
  if(!observation||!key(observation.observation_id)||seen.has(observation.observation_id)||!Array.isArray(observation.service_terms)||!observation.service_terms.every(item=>isTenderCoreServiceTerm(item))||!Array.isArray(observation.evidence)||!observation.evidence.length||!['favorable','desfavorable','neutra'].includes(observation.signal_polarity))invalid('invalid or duplicate observation');seen.add(observation.observation_id);
  if(observation.tender_id===candidate.tender_id)continue;const result=score(candidate,observation);if(!result.score)continue;
  if(!key(observation.modality_key))dataGaps.push({gap_id:'modalidad_no_reportada',subject:'observation',observation_id:observation.observation_id});
  comparable.push({signal_id:`${AGT002_RADAR_LEARNING_SIGNALS_VERSION}:${candidate.tender_id}:${observation.observation_id}`,observation_id:observation.observation_id,signal_polarity:observation.signal_polarity,effect:observation.signal_polarity==='favorable'?'raise_relative_priority':observation.signal_polarity==='desfavorable'?'lower_relative_priority':'context_only',candidate_match:result.matches,score:result.score,max_score:AGT002_RADAR_LEARNING_MAX_SCORE,evidence:observation.evidence.map(item=>({...item})),decided_at:key(observation.decided_at)?new Date(observation.decided_at).toISOString():''});
 }
 comparable.sort((a,b)=>b.score-a.score||b.candidate_match.length-a.candidate_match.length||b.decided_at.localeCompare(a.decided_at)||a.observation_id.localeCompare(b.observation_id));
 return{version:AGT002_RADAR_LEARNING_SIGNALS_VERSION,candidate_id:candidate.tender_id,max_signals:maxSignals,considered:comparable.length,signals:comparable.slice(0,maxSignals),data_gaps:dataGaps.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
}

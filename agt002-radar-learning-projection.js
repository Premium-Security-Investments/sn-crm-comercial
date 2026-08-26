function normalize(value){return typeof value==='string'&&value.trim()?value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):null;}
function terms(value){return [...new Set(String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/[^a-z0-9]+/).filter(token=>token.length>3))].sort();}
function iso(value){const parsed=Date.parse(value);return Number.isFinite(parsed)?new Date(parsed).toISOString():null;}
function tenderShape(row){const tender=row.tender||row.psi_public_tenders||row;return{tender_id:String(tender.id||row.tender_id||''),service_terms:Array.isArray(tender.service_terms)?tender.service_terms.map(normalize).filter(Boolean):terms(`${tender.title||''} ${tender.description||tender.desc||''}`),entity_key:normalize(tender.entity_nit||tender.entity),modality_key:normalize(tender.category||tender.modality),source_key:normalize(tender.source),territory_key:{city:normalize(tender.city),dept:normalize(tender.dept)}};}
function observation(row,type,polarity,dateField){const shape=tenderShape(row);const id=String(row.id||'');if(!id||!shape.tender_id)return null;return{observation_id:`${type}:${id}`,tender_id:shape.tender_id,service_terms:shape.service_terms,entity_key:shape.entity_key,modality_key:shape.modality_key,source_key:shape.source_key,territory_key:shape.territory_key,decided_at:iso(row[dateField]||row.updated_at||row.created_at)||'1970-01-01T00:00:00.000Z',signal_polarity:polarity,evidence:[{record_id:id,evidence_type:type}]};}
async function read(database,table,fields,limit,filters=[]){let query=database.from(table).select(fields);for(const [column,value] of filters)query=query.eq(column,value);const response=await query.limit(limit);if(response?.error)throw response.error;return response?.data||[];}
export async function projectAgt002RadarLearningObservations(database,{limit=1000}={}){
 if(!database||typeof database.from!=='function'||!Number.isInteger(limit)||limit<1||limit>5000){const error=new Error('AGT002_RADAR_LEARNING_SIGNALS_INVALID: projection input');error.code='AGT002_RADAR_LEARNING_SIGNALS_INVALID';throw error;}
 let groups;try{groups=await Promise.all([
  read(database,'psi_public_tenders','id,title,description,entity,city,dept,source,category,updated_at',limit,[['internal_status','convertida_oportunidad']]),
  read(database,'psi_tender_analysis_runs','id,tender_id,status,completed_at,result,psi_public_tenders(id,title,description,entity,city,dept,source,category)',limit,[['canonical',true],['status','completed']]),
  read(database,'psi_tender_go_no_go_decisions','id,tender_id,decision,decided_at,psi_public_tenders(id,title,description,entity,city,dept,source,category)',limit),
  read(database,'psi_tender_offer_status_transitions','id,tender_id,to_status,changed_at,psi_public_tenders(id,title,description,entity,city,dept,source,category)',limit),
 ]);}catch(error){error.runtime_boundary_code='AGT002_RADAR_LEARNING_SIGNALS_INVALID';throw error;}
 const precedents=[];
 for(const row of groups[0]){const item=observation(row,'converted_tender','favorable','updated_at');if(item)precedents.push(item);}
 for(const row of groups[1]){const item=observation(row,'canonical_analysis','neutra','completed_at');if(item)precedents.push(item);}
 for(const row of groups[2]){const decision=normalize(row.decision);const item=observation(row,'human_decision',decision==='go'?'favorable':decision==='no-go'||decision==='nogo'?'desfavorable':'neutra','decided_at');if(item)precedents.push(item);}
 for(const row of groups[3]){const status=normalize(row.to_status);const item=observation(row,'offer_outcome',status==='adjudicada'?'favorable':status==='no-adjudicada'?'desfavorable':'neutra','changed_at');if(item)precedents.push(item);}
 precedents.sort((a,b)=>a.observation_id.localeCompare(b.observation_id));return{schema_version:'agt002-radar-learning-observations-v1',precedents};
}

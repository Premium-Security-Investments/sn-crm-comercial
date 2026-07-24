import { createHash } from 'node:crypto';

const RULES_PRODUCER = 'siio_rules_v1';
const RULES_METHOD = 'rules';
const RULES_SCHEMA_VERSION = 'siio-tender-analysis-rules-v1';
const RULES_POLICY_VERSION = 'siio-rules-v1';
const ZERO_USAGE = Object.freeze({ input_tokens: 0, output_tokens: 0, cost_usd: 0 });

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function requireId(value, label) {
  if (!value || typeof value !== 'string') throw new Error(`${label} es obligatorio para registrar el preanálisis.`);
  return value;
}

function unwrapRpc(response) {
  if (response?.error) throw new Error(response.error.message || String(response.error));
  if (!response || response.data == null) throw new Error('La RPC de análisis no devolvió un resultado.');
  return response.data;
}

function countCriticalOpenQuestions(result) {
  return Array.isArray(result?.questions)
    ? result.questions.filter(question => question?.critical === true).length
    : 0;
}

export function buildTenderSnapshotInput(records, companyProfile) {
  const documents = [...(records || [])]
    .sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || '')))
    .map(({ extracted_text, signed_url, ...document }) => stable(document));
  const profile = stable(companyProfile || {});
  return {
    documents,
    document_hash: sha256(documents),
    company_profile: profile,
    profile_hash: sha256(profile),
  };
}

export async function registerSiioRulesAnalysis(database, context) {
  const opportunityId = requireId(context?.opportunity_id, 'La oportunidad');
  const tenderId = requireId(context?.tender_id, 'La licitación');
  const actorId = requireId(context?.actor_id, 'El actor');
  const result = context?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('El preanálisis por reglas requiere su resultado estructurado real.');
  }

  const snapshot = buildTenderSnapshotInput(context.documents, context.company_profile);
  const snapshotRecord = unwrapRpc(await database.rpc('psi_record_tender_document_snapshot', {
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_document_hash: snapshot.document_hash,
    p_profile_hash: snapshot.profile_hash,
    p_document_manifest: { documents: snapshot.documents },
    p_profile_snapshot: snapshot.company_profile,
    p_actor_id: actorId,
  }));
  const snapshotId = requireId(snapshotRecord.id, 'El snapshot documental');
  const runRecord = unwrapRpc(await database.rpc('psi_record_tender_analysis_run', {
    p_snapshot_id: snapshotId,
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_producer: RULES_PRODUCER,
    p_method: RULES_METHOD,
    p_status: 'completed',
    p_result: result,
    p_critical_open_count: countCriticalOpenQuestions(result),
    p_idempotency_key: sha256({ opportunity_id: opportunityId, snapshot_id: snapshotId, policy_version: RULES_POLICY_VERSION }),
    p_schema_version: RULES_SCHEMA_VERSION,
    p_policy_version: RULES_POLICY_VERSION,
    p_model: null,
    p_usage: { ...ZERO_USAGE },
  }));
  const runId = requireId(runRecord.id, 'La ejecución de análisis');
  return {
    run_id: runId,
    snapshot_id: snapshotId,
    producer: RULES_PRODUCER,
    method: RULES_METHOD,
    status: runRecord.status || 'completed',
    current: true,
    result,
    critical_open_count: runRecord.critical_open_count ?? countCriticalOpenQuestions(result),
  };
}

export async function getCurrentTenderAnalysis(database, opportunityId) {
  const normalizedOpportunityId = requireId(opportunityId, 'La oportunidad');
  const latestSnapshotResponse = await database.from('psi_tender_document_snapshots')
    .select('id')
    .eq('opportunity_id', normalizedOpportunityId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (latestSnapshotResponse?.error) throw new Error(latestSnapshotResponse.error.message || String(latestSnapshotResponse.error));
  const latestSnapshot = Array.isArray(latestSnapshotResponse?.data) ? latestSnapshotResponse.data[0] : latestSnapshotResponse?.data;
  const response = await database.from('psi_tender_analysis_runs')
    .select('id,snapshot_id,producer,method,status,result,critical_open_count,created_at,completed_at')
    .eq('opportunity_id', normalizedOpportunityId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (response?.error) throw new Error(response.error.message || String(response.error));
  const run = Array.isArray(response?.data) ? response.data[0] : response?.data;
  if (!run) return null;
  return {
    run_id: run.id,
    snapshot_id: run.snapshot_id,
    producer: run.producer,
    method: run.method,
    status: run.status,
    current: run.snapshot_id === latestSnapshot?.id,
    result: run.result,
    critical_open_count: run.critical_open_count ?? 0,
    created_at: run.created_at || null,
    completed_at: run.completed_at || null,
  };
}

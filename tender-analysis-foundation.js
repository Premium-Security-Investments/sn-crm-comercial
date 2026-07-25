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

function contentSha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function normalizeDocumentContent(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function stableDocumentId(document, content) {
  const explicitId = [document?.id, document?.source_document_id]
    .find(value => value != null && String(value).trim());
  if (explicitId != null) return String(explicitId).trim();
  return sha256({
    name: String(document?.name ?? ''),
    document_type: String(document?.document_type ?? ''),
    content,
  });
}

function canonicalDocument(document) {
  const content = normalizeDocumentContent(document?.content ?? document?.extracted_text);
  return {
    document_id: stableDocumentId(document, content),
    name: String(document?.name ?? ''),
    document_type: String(document?.document_type ?? ''),
    content,
    content_sha256: contentSha256(content),
    current: document?.current !== false,
  };
}

function canonicalRulesResult(result) {
  return stable(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'generated_at')));
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
  const documentsById = new Map();
  for (const record of records || []) {
    const document = canonicalDocument(record);
    documentsById.set(document.document_id, document);
  }
  const documents = [...documentsById.values()]
    .sort((left, right) => left.document_id.localeCompare(right.document_id));
  const profile = stable(companyProfile || {});
  return {
    documents,
    document_hash: sha256(documents),
    company_profile: profile,
    profile_hash: sha256(profile),
  };
}

export async function registerTenderDocumentSnapshot(database, context) {
  const opportunityId = requireId(context?.opportunity_id, 'La oportunidad');
  const tenderId = requireId(context?.tender_id, 'La licitación');
  const actorId = requireId(context?.actor_id, 'El actor');
  const refreshToken = requireId(context?.refresh_token, 'El token de actualización documental');
  const snapshot = buildTenderSnapshotInput(context.documents, context.company_profile);
  const record = unwrapRpc(await database.rpc('psi_record_tender_document_snapshot', {
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_document_hash: snapshot.document_hash,
    p_profile_hash: snapshot.profile_hash,
    p_document_manifest: { documents: snapshot.documents },
    p_profile_snapshot: snapshot.company_profile,
    p_actor_id: actorId,
    p_refresh_token: refreshToken,
  }));
  return { ...snapshot, ...record, id: requireId(record.id, 'El snapshot documental') };
}

export async function registerSiioRulesAnalysis(database, context) {
  const opportunityId = requireId(context?.opportunity_id, 'La oportunidad');
  const tenderId = requireId(context?.tender_id, 'La licitación');
  const actorId = requireId(context?.actor_id, 'El actor');
  const result = context?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('El preanálisis por reglas requiere su resultado estructurado real.');
  }
  const canonicalResult = canonicalRulesResult(result);

  const expectedSnapshot = buildTenderSnapshotInput(context.documents, context.company_profile);
  let snapshotRecord;
  if (context?.snapshot_record) {
    const providedSnapshotId = requireId(context.snapshot_record.id, 'El snapshot documental');
    if (context.snapshot_record.document_hash !== expectedSnapshot.document_hash
      || context.snapshot_record.profile_hash !== expectedSnapshot.profile_hash) {
      throw new Error('El snapshot documental gobernado no coincide con los documentos y perfil analizados.');
    }
    snapshotRecord = { ...expectedSnapshot, ...context.snapshot_record, id: providedSnapshotId };
  } else {
    snapshotRecord = await registerTenderDocumentSnapshot(database, context);
  }
  const snapshotId = requireId(snapshotRecord.id, 'El snapshot documental');
  const criticalOpenCount = countCriticalOpenQuestions(canonicalResult);
  const runRecord = unwrapRpc(await database.rpc('psi_record_tender_analysis_run', {
    p_snapshot_id: snapshotId,
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_producer: RULES_PRODUCER,
    p_method: RULES_METHOD,
    p_status: 'completed',
    p_result: canonicalResult,
    p_critical_open_count: criticalOpenCount,
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
    result: canonicalResult,
    critical_open_count: runRecord.critical_open_count ?? criticalOpenCount,
  };
}

export async function getCurrentTenderAnalysis(database, opportunityId, currentDocuments = null) {
  const normalizedOpportunityId = requireId(opportunityId, 'La oportunidad');
  const stateResponse = await database.from('psi_tender_document_state')
    .select('current_snapshot_id,refresh_in_progress')
    .eq('opportunity_id', normalizedOpportunityId)
    .maybeSingle();
  if (stateResponse?.error) throw new Error(stateResponse.error.message || String(stateResponse.error));
  const state = stateResponse?.data;
  if (!state?.current_snapshot_id) return null;
  const snapshotResponse = await database.from('psi_tender_document_snapshots')
    .select('id,document_hash')
    .eq('id', state.current_snapshot_id)
    .maybeSingle();
  if (snapshotResponse?.error) throw new Error(snapshotResponse.error.message || String(snapshotResponse.error));
  const latestSnapshot = snapshotResponse?.data;
  if (!latestSnapshot?.id) return null;

  const selectLatestRun = async (snapshotId = null) => {
    let query = database.from('psi_tender_analysis_runs')
      .select('id,snapshot_id,producer,method,status,result,critical_open_count,created_at,completed_at')
      .eq('opportunity_id', normalizedOpportunityId);
    if (snapshotId) query = query.eq('snapshot_id', snapshotId);
    const response = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1);
    if (response?.error) throw new Error(response.error.message || String(response.error));
    return Array.isArray(response?.data) ? response.data[0] : response?.data;
  };

  const run = await selectLatestRun(latestSnapshot.id) || await selectLatestRun();
  if (!run) return null;
  const documentsMatchSnapshot = !Array.isArray(currentDocuments)
    || buildTenderSnapshotInput(currentDocuments, {}).document_hash === latestSnapshot.document_hash;
  return {
    run_id: run.id,
    snapshot_id: run.snapshot_id,
    producer: run.producer,
    method: run.method,
    status: run.status,
    current: !state.refresh_in_progress && run.snapshot_id === latestSnapshot.id && documentsMatchSnapshot,
    result: run.result,
    critical_open_count: run.critical_open_count ?? 0,
    created_at: run.created_at || null,
    completed_at: run.completed_at || null,
  };
}

/** Produces the document-API analysis payload without allowing result JSON to forge typed-run authority. */
export function presentCurrentTenderAnalysis(currentAnalysis) {
  if (!currentAnalysis) return null;
  const result = currentAnalysis.result && typeof currentAnalysis.result === 'object' && !Array.isArray(currentAnalysis.result)
    ? currentAnalysis.result
    : {};
  return {
    ...result,
    run_id: currentAnalysis.run_id,
    snapshot_id: currentAnalysis.snapshot_id,
    producer: currentAnalysis.producer,
    method: currentAnalysis.method,
    status: currentAnalysis.status,
    current: currentAnalysis.current,
    critical_open_count: currentAnalysis.critical_open_count,
    created_at: currentAnalysis.created_at || null,
    completed_at: currentAnalysis.completed_at || null,
  };
}

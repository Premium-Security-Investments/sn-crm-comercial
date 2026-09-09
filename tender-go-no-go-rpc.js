import { ACTIONS, requireAction } from './access-control.js';
import { buildTenderSnapshotInput, getCurrentTenderAnalysis } from './tender-analysis-foundation.js';
import { buildTenderOfferPreparation } from './tender-offer-preparation.js';
import { mergeTenderDocumentRecords } from './tender-document-versioning.js';
import { deriveAgt002DossierHandoff, evidenceCoverageStrictlyAbsent } from './server/agt002-dossier-handoff.js';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from './agt002-integral-analysis-v3.js';
import { AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION } from './agt002-preview-contract.js';
import { AGT002_INTEGRAL_V3_POLICY_VERSION } from './agt002-preview-runtime.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function goNoGoError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Attaches a stable stage/code pair to an existing goNoGoError without altering its
// status/message: callers that need to branch on `error.code` (tests, clients) get a stable
// contract while every existing status/message assertion keeps working unchanged.
function withStageCode(error, stage, code) {
  error.stage = stage;
  error.code = code;
  return error;
}

function requireUuid(value, label) {
  const id = String(value || '').trim();
  if (!UUID_PATTERN.test(id)) throw goNoGoError(`Debe indicar ${label}.`);
  return id;
}


function nullableUuid(value, label) {
  if (value === null || value === undefined) return null;
  return requireUuid(value, label);
}

function nullableText(value, max = 1200) {
  return String(value || '').trim().slice(0, max) || null;
}

function requiredText(value, label, max = 1200) {
  const text = nullableText(value, max);
  if (!text) throw goNoGoError(`Debe indicar ${label}.`);
  return text;
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function parseInteractionJson(notes) {
  if (!notes) return null;
  if (typeof notes === 'object') return notes;
  try { return JSON.parse(notes); } catch { return null; }
}

async function resolveTenderContext(database, opportunityId) {
  const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select('*').eq('id', opportunityId).single());
  if (!opportunity || opportunity.service_type_code !== 'licitacion_publica') throw goNoGoError('La oportunidad no corresponde a una licitación pública.');
  const tender = await must(database.from('psi_public_tenders').select('id,converted_opportunity_id').eq('converted_opportunity_id', opportunityId).maybeSingle());
  if (!tender?.id || tender.converted_opportunity_id !== opportunityId) throw goNoGoError('No existe una licitación vinculada a la oportunidad.', 404);
  return { opportunity, tender };
}

function currentPreparation(preparations) {
  return [...preparations].sort((left, right) => {
    const occurredAt = String(right.occurred_at || '').localeCompare(String(left.occurred_at || ''));
    return occurredAt || String(right.interaction_id).localeCompare(String(left.interaction_id));
  })[0] || null;
}

async function getTenderDocumentsAndAnalysis(database, opportunityId) {
  const [interactions, typedDocuments] = await Promise.all([
    must(database.from('psi_sales_interactions').select('id,notes,created_at,occurred_at').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento').order('created_at', { ascending: true })),
    must(database.from('psi_tender_document_versions').select('id,opportunity_id,tender_id,source,source_document_id,version,supersedes_version_id,name,content_hash,storage_path,mime_type,size_bytes,document_type,extracted_text,source_url,current,actor_id,created_at').eq('opportunity_id', opportunityId).order('created_at', { ascending: true })),
  ]);
  const documents = [];
  const analyses = [];
  const preparations = [];
  for (const row of interactions || []) {
    const payload = parseInteractionJson(row.notes);
    if (payload?.kind === 'tender_document_upload') documents.push(...(payload.documents || []).map(document => ({ ...document, interaction_id: row.id })));
    if (payload?.kind === 'tender_document_analysis') analyses.push({ ...payload, interaction_id: row.id, created_at: row.created_at || row.occurred_at || null });
    if (payload?.kind === 'tender_offer_preparation') preparations.push({
      ...payload,
      interaction_id: row.id,
      created_at: row.created_at || row.occurred_at || null,
      occurred_at: row.occurred_at || null,
    });
  }
  return {
    documents: mergeTenderDocumentRecords(typedDocuments || [], documents).filter(document => document.current !== false),
    analyses,
    preparations,
    analysis: analyses.at(-1) || null,
    preparation: currentPreparation(preparations),
  };
}

async function rpc(database, name, args) {
  const { data, error } = await database.rpc(name, args);
  if (error) throw error;
  return data;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Sólo un resultado con el sobre V3 estructurado (contract_version + analysis_units) es candidato
// al traspaso AGT-002 -> expediente post-GO. Un análisis legado (reglas) o cualquier otro sobre
// nunca invoca al selector: eso es simple incompatibilidad, nunca un caso "malformado".
function hasEligibleAgt002IntegralAnalysis(result) {
  const integralAnalysis = isRecord(result) ? result.integral_analysis : null;
  return isRecord(integralAnalysis)
    && integralAnalysis.contract_version === AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION
    && Array.isArray(integralAnalysis.analysis_units);
}

// Mapea exactamente el lote cerrado de deriveAgt002DossierHandoff (presentation/source anidados)
// al shape plano y cerrado que exige psi_sync_agt002_post_go_checklist (082/§4). Nunca reenvía
// origin/item_type: esos son fijos del lado SQL y nunca viajan en el lote server->RPC.
function mapAgt002DossierHandoffItemToSqlShape(item) {
  return {
    item_key: item.item_key,
    required: item.required,
    status: item.status,
    title: item.presentation.title,
    instruction: item.presentation.instruction,
    source_kind: item.source.source_kind,
    source_id: item.source.source_id,
    requirement_id: item.source.requirement_id,
    source_hash: item.source.source_hash,
  };
}

/**
 * Server-owned, fail-closed: sólo una decisión GO cuyo análisis exacto (mismo run que la decisión
 * ancla: canónico, completado, vigente) trae el sobre V3 estructurado puede producir un lote. NO-GO
 * y cualquier análisis no elegible/no listo devuelven null explícito (compatibilidad intencional,
 * nunca un error). Nunca atrapa el error del selector (deriveAgt002DossierHandoff): una unión
 * ambigua o inválida debe abortar el registro completo de la decisión, no degradar en silencio
 * hacia null.
 *
 * `canonicalAnalysis` DEBE venir de una lectura canónica real (getCurrentTenderAnalysis con
 * `canonicalOnly: true`), la única que expone la columna `canonical` de la corrida. Aquí se exige
 * `canonical === true` como cualquier otro campo verificado: nunca se sintetiza. La síntesis
 * anterior descansaba en un invariante de escritura ("sólo el registro canónico escribe el sobre
 * V3") para afirmar un hecho de lectura, de modo que cualquier corrida no canónica que llegara a
 * llevar ese sobre —por backfill, importación o regresión del escritor— se habría traspasado al
 * expediente como si fuera canónica.
 *
 * Aquí NUNCA se pasa `humanGoGranted`: el bypass legado del issue #187 (corrida V3 sin
 * `result.evidence_coverage`) queda reservado a `syncTenderDossierFromAgt002`, donde el GO ya está
 * persistido y vigente. Al REGISTRAR la decisión el GO todavía no existe, así que un lote legado
 * sólo podría hacer daño: una unión inválida lanzaría y abortaría el registro de una decisión
 * empresarial que la persona sí tomó. Un GO nuevo sobre una corrida legada se registra igual, con
 * `p_agt002_items: null`; el traspaso se obtiene después por la ruta de recovery, que deriva el lote
 * o falla 409 explícitamente.
 */
function deriveAgt002ItemsForGoDecision(decision, canonicalAnalysis, anchoredAnalysisRunId) {
  if (decision !== 'go') return null;
  const isExactCurrentCanonicalRun = canonicalAnalysis?.run_id === anchoredAnalysisRunId
    && canonicalAnalysis.status === 'completed'
    && canonicalAnalysis.current === true
    && canonicalAnalysis.canonical === true;
  if (!isExactCurrentCanonicalRun || !hasEligibleAgt002IntegralAnalysis(canonicalAnalysis.result)) return null;

  const handoff = deriveAgt002DossierHandoff({
    currentAnalysis: canonicalAnalysis,
    result: canonicalAnalysis.result,
    questionResponses: [],
  });
  return handoff.ready ? handoff.items.map(mapAgt002DossierHandoffItemToSqlShape) : null;
}

/** Authoritative, RPC-mediated tender decision path. Authorization precedes every database access. */
export async function callTenderGoNoGoDecision(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  const decision = String(input?.decision || '').trim();
  if (!new Set(['go', 'no_go']).has(decision)) throw goNoGoError('La decisión debe ser go o no_go.');
  const analysisRunId = nullableUuid(input?.analysis_run_id, 'un análisis válido')?.toLowerCase() || null;
  const justification = nullableText(input?.justification);
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);

  const { opportunity, tender } = await resolveTenderContext(database, opportunityId);
  const records = await getTenderDocumentsAndAnalysis(database, opportunityId);
  const documentHash = buildTenderSnapshotInput(records.documents, {}).document_hash;
  const availableAnalysis = await getCurrentTenderAnalysis(database, opportunityId, records.documents);
  const effectiveAnalysis = availableAnalysis?.run_id === analysisRunId && availableAnalysis.status === 'completed' && availableAnalysis.current === true
    ? { ...(availableAnalysis.result || {}), ...availableAnalysis }
    : null;
  const effectiveAnalysisRunId = effectiveAnalysis ? analysisRunId : null;
  const preparation = decision === 'go'
    ? buildTenderOfferPreparation(opportunity, records.documents, effectiveAnalysis, currentProfile)
    : null;
  // La preparación y el anclaje de la decisión siguen leyendo `availableAnalysis` exactamente como
  // antes (esa lectura no filtra por canonical y no cambia de comportamiento). El traspaso al
  // expediente, en cambio, exige una lectura canónica server-owned propia: es la única que trae la
  // columna `canonical` de la corrida, y sólo se hace para GO. La comparación es contra
  // `effectiveAnalysisRunId`, no contra el run enviado: así el lote sólo puede existir cuando la
  // decisión ANCLA exactamente ese mismo run, y nunca se envía un lote junto a un
  // p_analysis_run_id null. Si la lectura canónica no coincide (otro run, no vigente, no
  // completada o no canónica), el lote es null y la decisión se registra igual — compatible,
  // nunca un error.
  const canonicalAnalysis = decision === 'go'
    ? await getCurrentTenderAnalysis(database, opportunityId, records.documents, { canonicalOnly: true })
    : null;
  const agt002Items = deriveAgt002ItemsForGoDecision(decision, canonicalAnalysis, effectiveAnalysisRunId);
  const result = await rpc(database, 'psi_record_tender_go_no_go', {
    p_opportunity_id: opportunityId,
    p_tender_id: tender.id,
    p_actor_id: actorId,
    p_decision: decision,
    p_analysis_run_id: effectiveAnalysisRunId,
    p_justification: justification,
    p_preparation: preparation,
    p_document_hash: documentHash,
    p_agt002_items: agt002Items,
  });
  const persistedPreparation = result.preparation_created
    ? preparation
    : (records.preparations || []).find(candidate => candidate.interaction_id === result.preparation_id) || null;
  return { decision: result, preparation: persistedPreparation };
}

function currentDecisionFromHistory(history) {
  const rows = history || [];
  const supersededIds = new Set(rows.map(row => row.supersedes_decision_id).filter(Boolean));
  return rows.find(row => !supersededIds.has(row.id)) || rows[0] || null;
}

/** Read-side companion; preparation is visible only while the current supersession leaf is GO. */
export async function getTenderGoNoGoDecision(database, opportunityId, currentProfile) {
  const id = requireUuid(opportunityId, 'una oportunidad válida');
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  const { tender } = await resolveTenderContext(database, id);
  const [history, records] = await Promise.all([
    must(database.from('psi_tender_go_no_go_decisions').select('id,opportunity_id,tender_id,decision,analysis_interaction_id,analysis_run_id,justification,decided_by,decided_at,supersedes_decision_id,psi_sales_profiles(full_name)').eq('opportunity_id', id).eq('tender_id', tender.id).order('decided_at', { ascending: false }).order('id', { ascending: false })),
    getTenderDocumentsAndAnalysis(database, id),
  ]);
  const decision = currentDecisionFromHistory(history);
  // The opportunity detail loads this endpoint and /api/tender-documents concurrently for the
  // same opportunity, and both used to read the current run's whole `result` JSONB. That payload
  // is only ever rendered from the /api/tender-documents response (the decision panel receives
  // `analysis` as a prop, never from this payload), so this read takes the typed provenance only
  // and stops duplicating the single most expensive statement of the page. The GO path
  // (callTenderGoNoGoDecision) still reads the full result — it builds the offer preparation from
  // it — so no gate loses information.
  const analysis = await getCurrentTenderAnalysis(database, id, records.documents, { includeResult: false });
  return { decision, history: history || [], preparation: decision?.decision === 'go' ? records.preparation : null, analysis };
}

/** Shared gate for every preparation read/write path; NO_GO never reveals or mutates prior preparation. */
export async function requireTenderGoForPreparation(database, opportunityId, currentProfile) {
  const payload = await getTenderGoNoGoDecision(database, opportunityId, currentProfile);
  if (payload.decision?.decision !== 'go') throw goNoGoError('La preparación de oferta requiere una decisión GO vigente.', 409);
  return payload;
}

const AGT002_DOSSIER_SYNC_STAGE = 'agt002_dossier_sync';

// Fail-closed identity/completeness gate for the run the recovery is about to hand off: a run
// whose schema_version/policy_version do not self-identify as the V3 policy currently in force,
// or whose completed_at cannot be parsed into a real instant, can never sustain the traspaso —
// regardless of how valid the rest of the run otherwise looks. Returns the parsed completed_at
// (ms) so callers that also need the chronology check never re-parse it.
function requireAgt002V3RunIdentity(run) {
  if (run?.schema_version !== AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION) {
    throw withStageCode(goNoGoError('La corrida vigente no declara el schema_version V3 vigente.', 409), AGT002_DOSSIER_SYNC_STAGE, 'schema_version_mismatch');
  }
  if (run?.policy_version !== AGT002_INTEGRAL_V3_POLICY_VERSION) {
    throw withStageCode(goNoGoError('La corrida vigente no declara el policy_version vigente.', 409), AGT002_DOSSIER_SYNC_STAGE, 'policy_version_mismatch');
  }
  const completedAtMs = run?.completed_at ? Date.parse(run.completed_at) : NaN;
  if (!Number.isFinite(completedAtMs)) {
    throw withStageCode(goNoGoError('La corrida vigente no tiene un completed_at válido.', 409), AGT002_DOSSIER_SYNC_STAGE, 'completed_at_invalid');
  }
  return completedAtMs;
}

// Caso REAL de Cali (issue #187) sin anclaje: la cronología real es análisis -> GO, nunca al
// revés. Sin un `analysis_run_id` explícito el servidor elige la corrida canónica vigente por sí
// mismo, así que debe probar que esa corrida ya existía (completada) en el instante del GO; nunca
// puede atar una decisión humana pasada a un análisis que, de hecho, es posterior a ella.
function requireUnanchoredRunNotAfterGo(completedAtMs, decision) {
  const decidedAtMs = decision?.decided_at ? Date.parse(decision.decided_at) : NaN;
  if (!Number.isFinite(decidedAtMs)) {
    throw withStageCode(goNoGoError('La decisión GO vigente no tiene una fecha decided_at válida.', 409), AGT002_DOSSIER_SYNC_STAGE, 'decided_at_invalid');
  }
  if (completedAtMs > decidedAtMs) {
    throw withStageCode(goNoGoError('La corrida vigente sin anclaje se completó después de la decisión GO vigente.', 409), AGT002_DOSSIER_SYNC_STAGE, 'unanchored_run_completed_after_go');
  }
}

const AGT002_DOSSIER_SYNC_ALLOWED_KEYS = new Set(['opportunity_id']);

function requireClosedAgt002DossierSyncBody(input) {
  const extraKeys = Object.keys(input || {}).filter(key => !AGT002_DOSSIER_SYNC_ALLOWED_KEYS.has(key));
  if (extraKeys.length) throw goNoGoError('El cuerpo de la solicitud sólo puede incluir opportunity_id.');
}

/**
 * Recovery path for `psi_sync_agt002_post_go_checklist` (fase 3B): re-derives and re-submits the
 * AGT-002 handoff batch for an opportunity whose GO decision is already recorded, server-owned and
 * fail-closed just like the atomic 9-arg path. It never decides or records GO/NO-GO itself.
 *
 * Every input the client could otherwise forge (item/source/hash/title) is rejected before any
 * database access: the closed body accepts exactly `opportunity_id`, and the batch is always
 * re-derived here from the current, canonical, completed analysis run bound to the current
 * unsuperseded GO decision — never from anything the request body carries.
 *
 * Fail-closed, not a compatibility no-op: unlike `deriveAgt002ItemsForGoDecision` (which returns
 * null for an ineligible/not-ready analysis because NO-GO and "not yet ready" are legitimate
 * states while recording a decision), every one of those same states is an error here — a human
 * explicitly asked to sync an existing GO's checklist, so silently doing nothing would hide a real
 * problem instead of reporting it.
 *
 * Caso REAL de Cali (issue #187): el GO vigente puede haber quedado registrado con
 * `analysis_run_id` NULL. Un rechazo inmediato dejaba ese expediente sin traspaso posible para
 * siempre, así que la ausencia de anclaje se admite bajo un único caso legado ESTRICTO —la corrida
 * canónica/completada/vigente AGT-002 (agent_ai) trae el sobre V3 estructurado, no tiene la
 * propiedad propia `result.evidence_coverage`, y el selector server-owned produce un lote listo con
 * `humanGoGranted: true`— y usando SIEMPRE el `run_id` que este servidor acaba de leer. Con anclaje
 * presente la igualdad exacta se conserva sin cambios. En ningún caso se actualiza ni se reinserta
 * la decisión: el recovery sólo siembra el expediente.
 */
export async function syncTenderDossierFromAgt002(database, input, currentProfile) {
  requireClosedAgt002DossierSyncBody(input);
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);

  const { tender } = await resolveTenderContext(database, opportunityId);
  const history = await must(database.from('psi_tender_go_no_go_decisions')
    .select('id,decision,analysis_run_id,supersedes_decision_id,decided_at')
    .eq('opportunity_id', opportunityId).eq('tender_id', tender.id)
    .order('decided_at', { ascending: false }).order('id', { ascending: false }));
  const decision = currentDecisionFromHistory(history);
  if (decision?.decision !== 'go') throw goNoGoError('La oportunidad no tiene una decisión GO vigente.', 409);
  const anchoredAnalysisRunId = decision.analysis_run_id || null;

  const availableAnalysis = await getCurrentTenderAnalysis(database, opportunityId, null, { canonicalOnly: true });
  const isCurrentCanonicalCompletedRun = Boolean(availableAnalysis?.run_id)
    && availableAnalysis.status === 'completed'
    && availableAnalysis.current === true
    && availableAnalysis.canonical === true;

  if (anchoredAnalysisRunId) {
    // Decisión con anclaje explícito: la igualdad exacta con el análisis vigente sigue siendo la
    // única condición admitida, idéntica a la anterior. Un run distinto al anclado nunca sincroniza.
    const isExactCurrentCanonicalRun = isCurrentCanonicalCompletedRun && availableAnalysis.run_id === anchoredAnalysisRunId;
    if (!isExactCurrentCanonicalRun) throw goNoGoError('El análisis anclado a la decisión GO vigente ya no es el análisis vigente, canónico y completado.', 409);
  } else {
    // Caso REAL de Cali (issue #187): el GO vigente se registró SIN `analysis_run_id`, de modo que
    // no existe anclaje contra el que comparar. No se repara la decisión (nunca se actualiza ni se
    // reinserta): se admite un único caso legado ESTRICTO, en el que el run que sustenta el lote lo
    // elige el servidor —la corrida canónica vigente— y jamás el cuerpo de la solicitud.
    if (!isCurrentCanonicalCompletedRun) {
      throw goNoGoError('La decisión GO vigente no tiene un análisis anclado y no hay un análisis vigente, canónico y completado que pueda sustentar el traspaso legado.', 409);
    }
    if (availableAnalysis.producer !== 'AGT-002' || availableAnalysis.method !== 'agent_ai') {
      throw goNoGoError('La decisión GO vigente no tiene un análisis anclado y el análisis vigente no es una corrida AGT-002 (agent_ai).', 409);
    }
    // Misma regla de ausencia ESTRICTA que gobierna el bypass legado del selector: si la propiedad
    // `evidence_coverage` existe —aunque valga null, {}, false, 0 o un string— hay una lectura de
    // cobertura, la corrida NO es de las anteriores a ese bloque y este atajo no aplica.
    if (!evidenceCoverageStrictlyAbsent(availableAnalysis.result)) {
      throw goNoGoError('La decisión GO vigente no tiene un análisis anclado y el análisis vigente sí declara cobertura (evidence_coverage): sólo el caso legado estricto del issue #187 puede sincronizarse sin anclaje.', 409);
    }
  }
  if (!hasEligibleAgt002IntegralAnalysis(availableAnalysis.result)) throw goNoGoError('El análisis vigente no incluye un análisis integral V3 estructurado.', 409);
  // Identidad de versión y completitud de la corrida seleccionada: nunca se asumen, se verifican
  // antes de derivar cualquier lote o invocar la RPC, tanto para el caso anclado como el legado.
  const completedAtMs = requireAgt002V3RunIdentity(availableAnalysis);
  if (!anchoredAnalysisRunId) requireUnanchoredRunNotAfterGo(completedAtMs, decision);
  // Server-owned: el run del lote es el anclado por la decisión o, sólo en el caso legado estricto
  // anterior, el de la corrida canónica vigente que este mismo servidor acaba de leer.
  const analysisRunId = anchoredAnalysisRunId || availableAnalysis.run_id;

  // `availableAnalysis` ya viene de una lectura canonicalOnly y su `canonical === true` acaba de
  // verificarse arriba: se pasa tal cual, sin sintetizar ningún campo. `humanGoGranted` refleja la
  // decisión GO vigente y no superada que se acaba de leer, cuyo análisis anclado es exactamente
  // esta corrida canónica o —caso legado sin anclaje— cuya corrida canónica vigente ya superó todas
  // las condiciones estrictas de arriba: esta ruta re-siembra el expediente de un GO ya tomado,
  // nunca reescribe la decisión empresarial. Ésta es la ÚNICA ruta que declara ese hecho: el
  // registro de la decisión (deriveAgt002ItemsForGoDecision) nunca lo hace, porque allí el GO
  // todavía no está persistido. El bypass sigue siendo fail-closed dentro del selector —cobertura
  // estrictamente ausente, pausa exactamente por cobertura, sin omisiones materiales o con la única
  // omisión material autorizada (`lower_relevance`, sola en `omission_reasons`), y unión 1:1
  // exacta con la unidad V3—, y si no produce lote listo esta ruta responde 409 en lugar de sembrar
  // a ciegas. La clasificación material pre-GO no interviene: los requisitos de un pliego real
  // (`sreq:*`) no están en el catálogo global de requisitos gobernados de la empresa.
  const handoff = deriveAgt002DossierHandoff({
    currentAnalysis: availableAnalysis,
    result: availableAnalysis.result,
    questionResponses: [],
    humanGoGranted: true,
  });
  if (!handoff.ready) throw goNoGoError('El análisis vigente todavía no está listo para el traspaso al expediente.', 409);

  return rpc(database, 'psi_sync_agt002_post_go_checklist', {
    p_opportunity_id: opportunityId,
    p_actor_id: actorId,
    p_decision_id: decision.id,
    p_analysis_run_id: analysisRunId,
    p_items: handoff.items.map(mapAgt002DossierHandoffItemToSqlShape),
  });
}

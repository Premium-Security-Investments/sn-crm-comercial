import { createHash } from 'node:crypto';
import { resolveAgt002GovernedDocumentForExecution } from './agt002-governed-document-rehydration.js';
import { validatePreGoAnalysisV2 } from './agt002-pre-go-analysis-v2.js';
import {
  agt002InitialDiagnosticError, buildInitialAggregate, buildInitialMemberOutputSchema, buildInitialSynthesisModelSchema,
} from './agt002-initial-analysis-aggregate-builder.js';
import { loadAgt002CompanyProfileSnapshotForWorkflow } from './agt002-company-profile-snapshot.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

export function hashAgt002InitialAnalysisOutput(output) {
  return createHash('sha256').update(JSON.stringify(stable(output))).digest('hex');
}

function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function defaultLoadBindings(database, packageVersionId, memberIds) {
  const { data, error } = await database
    .from('psi_agt002_evidence_package_members')
    .select('document_version_id,extraction_id,extraction_text_hash,content_hash,source_classification,inclusion_reason')
    .eq('package_version_id', packageVersionId)
    .in('document_version_id', memberIds);
  if (error || !Array.isArray(data)) throw runtimeError('AGT002_ENGINE_MEMBER_HASH_MISMATCH', 'No fue posible resolver los miembros gobernados.');
  return data;
}

async function defaultLoadPackage(database, packageVersionId) {
  const versionResult = await database
    .from('psi_agt002_evidence_package_versions')
    .select('id,package_id,package_hash,document_manifest_hash,semantic_manifest_hash,member_count,batch_count,created_at')
    .eq('id', packageVersionId)
    .single();
  const membersResult = await database
    .from('psi_agt002_evidence_package_members')
    .select('id,document_version_id,batch_index,source_classification,inclusion_reason,content_hash,extraction_text_hash')
    .eq('package_version_id', packageVersionId)
    .order('batch_index')
    .order('document_version_id');
  if (versionResult?.error || !versionResult?.data || membersResult?.error || !Array.isArray(membersResult?.data)) {
    throw agt002InitialDiagnosticError('package_unavailable');
  }
  return { version: versionResult.data, members: membersResult.data };
}

// Official process data the CRM already holds (captured from SECOP by Radar). Supplementary: if it cannot be read the
// synthesis proceeds without it rather than failing the analysis.
async function defaultLoadOfficialContext(database, { tenderId }) {
  try {
    const { data } = await database
      .from('psi_public_tenders')
      .select('entity,ref,process_id,title,value,status,published_at,deadline_at,dept,city,source,url')
      .eq('id', tenderId)
      .maybeSingle();
    if (!data) return null;
    return {
      fuente: 'CRM (capturado de SECOP por Radar)',
      entidad: data.entity ?? null, referencia: data.ref ?? null, proceso_secop: data.process_id ?? null,
      objeto: data.title ?? null, presupuesto_cop: data.value ?? null, estado_secop: data.status ?? null,
      publicado: data.published_at ?? null, cierre_oficial: data.deadline_at ?? null,
      ubicacion: [data.city, data.dept].filter(Boolean).join(', ') || null, url: data.url ?? null,
    };
  } catch {
    return null;
  }
}

const OFFICIAL_CONTEXT_POLICY = ' Datos oficiales del CRM (official_crm_data, capturados de SECOP): úselos para entidad, referencia, presupuesto, estado y fecha de cierre. Si ningún documento lo contradice, registre el cierre oficial como plazo SUBMISSION con certeza CONFIRMED, apoyado en una afirmación marked_inference cuya inference_basis diga "dato oficial del CRM (SECOP)"; si un documento lo contradice, regístrelo como contradicción. En cada pendiente (open_items) indique owner_role (área responsable: Licitaciones, Jurídico, Financiero, Operaciones o Comercial) y due_at cuando la fecha se pueda derivar del cronograma o del cierre.';
const MEMBER_POLICY = 'Analice únicamente la evidencia suministrada. Cada nota debe indicar el documento del que sale (document_id) y dónde lo encontró (locator). No invente datos que el documento no contenga; separe lo hallado de lo pendiente. No decida GO/NO-GO ni ejecute acciones.';
// Writing rules for what a person reads (owner review 2026-10-06): every note must stand on its own, without opening
// the sources, and each topic is told once.
const WRITING_POLICY = ' Redacción (la lee quien decide, sin abrir las fuentes): cada hallazgo (findings.impact) dice en este orden, en frases cortas, qué exige el pliego con sus cifras (nunca "esa experiencia" o "ese requisito" sin decir cuál), cómo está la empresa frente a eso, qué pasa si no se cumple y qué hacer; no mezcle en un hallazgo cosas distintas (un requisito habilitante y un puntaje van en hallazgos separados). Explique cada sigla la primera vez que la use (por ejemplo "LPR (lectura de placas)"). No use códigos internos (CLM-..., REQ-..., nombres de campos) ni palabras en inglés en ningún texto visible, incluida inference_basis. Diga la incertidumbre en palabras simples ("por confirmar con el RUP original"), no con fórmulas como "no demuestra incumplimiento". Un tema se cuenta una sola vez: el hallazgo lo explica, el requisito lo cita y el pendiente sólo dice la tarea; no repita en un requisito el texto completo de otro: si un requisito tiene varios puntos a verificar, use un solo text_claim_id y diga en required_action qué punto revisa. La recomendación (recommendation.label) da el motivo en una o dos frases, sin repetir que la decisión es humana.';
const SYNTHESIS_COMPANY_POLICY = 'Produzca el análisis inicial usando sólo las notas de lote, el catálogo de evidencia y el perfil congelado de la empresa (company_profile). Cite fuentes de la licitación únicamente como {document_id, locator}. Para cada requisito evalúe a la empresa contra ese perfil (company_evaluation): VERIFIED sólo si el perfil lo demuestra; AVAILABLE si el perfil lo declara pero falta soporte; PENDING si falta información; BLOCKER si el perfil muestra que no cumple. Lo que afirme sobre la empresa va como marked_inference con inference_basis que diga qué dato del perfil lo respalda; el perfil es declarado y está pendiente de revisión humana: dígalo, no invente lo que no esté. Dé company_fit (APTO / PARTIAL_NOT_READY / NO_APTO) y una recomendación. No decida GO/NO-GO ni ejecute acciones.';
const SYNTHESIS_POLICY = 'Produzca el análisis inicial usando sólo las notas de lote y el catálogo de evidencia suministrados. Cite cada fuente únicamente como {document_id, locator} tomados de las notas; no cite nada que las notas no respalden. Cubra todos los bloques de cobertura y declare como pendiente o ausente lo que la evidencia no permita afirmar. No hay perfil de empresa autorizado: la recomendación sólo puede ser HOLD_RECOMMENDED, NO_GO_RECOMMENDED o INSUFFICIENT_INFORMATION. No decida GO/NO-GO ni ejecute acciones.';


/**
 * Member documents can exceed what one model call reads. Documents longer than the limit are split into ordered parts at
 * line boundaries (never silently truncated), and parts are grouped into calls that each stay under the limit.
 */
export function planAgt002InitialMemberCalls(members, maxChars) {
  const pieces = [];
  for (const member of members) {
    const text = typeof member.content === 'string' ? member.content : JSON.stringify(member.content ?? '');
    if (text.length <= maxChars) { pieces.push({ member, content: text, part: null }); continue; }
    const parts = [];
    let rest = text;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf('\n', maxChars);
      if (cut < maxChars * 0.5) cut = maxChars;
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest.length) parts.push(rest);
    parts.forEach((content, index) => pieces.push({ member, content, part: `${index + 1}/${parts.length}` }));
  }
  const calls = [];
  let current = []; let size = 0;
  for (const piece of pieces) {
    if (current.length && size + piece.content.length > maxChars) { calls.push(current); current = []; size = 0; }
    current.push(piece); size += piece.content.length;
  }
  if (current.length) calls.push(current);
  return calls;
}

/** Creates the real INITIAL rehydration/model boundaries. Dependencies stay injectable for E0. */
export function createAgt002InitialAnalysisRuntime({
  bridgeClient,
  loadBindings = defaultLoadBindings,
  resolveDocument = resolveAgt002GovernedDocumentForExecution,
  validateEnvelope = validatePreGoAnalysisV2,
  loadPackage = defaultLoadPackage,
  loadCompanyProfile = loadAgt002CompanyProfileSnapshotForWorkflow,
  memberCallMaxChars = Number(process.env.AGT002_INITIAL_ANALYSIS_MEMBER_CALL_MAX_CHARS) || 300_000,
  loadOfficialContext = defaultLoadOfficialContext,
  executorVersion = process.env.AGT002_DEPLOYED_VERSION || 'agt002-initial-analysis-worker',
  now = () => new Date(),
} = {}) {
  if (!bridgeClient || typeof bridgeClient.run !== 'function') throw new Error('El runtime INITIAL requiere un bridge client.');

  return Object.freeze({
    async rehydrateMembers(database, memberIds, { job }) {
      const packageVersionId = job?.payload?.persistence?.packageVersionId;
      if (typeof packageVersionId !== 'string' || !Array.isArray(memberIds) || memberIds.length === 0) {
        throw runtimeError('AGT002_ENGINE_MEMBER_HASH_MISMATCH', 'La identidad del paquete INITIAL no es válida.');
      }
      const bindings = await loadBindings(database, packageVersionId, memberIds);
      const byId = new Map(bindings.map(item => [item.document_version_id, item]));
      if (byId.size !== memberIds.length) throw runtimeError('AGT002_ENGINE_MEMBER_HASH_MISMATCH', 'El lote INITIAL está incompleto.');
      const members = [];
      for (const memberId of memberIds) {
        const binding = byId.get(memberId);
        if (!binding) throw runtimeError('AGT002_ENGINE_MEMBER_HASH_MISMATCH', 'El lote INITIAL está incompleto.');
        const document = await resolveDocument(database, {
          opportunityId: job.opportunityId,
          tenderId: job.tenderId,
          documentVersionId: memberId,
          member: binding,
        });
        if (document.extraction_text_hash !== binding.extraction_text_hash) {
          throw runtimeError('AGT002_ENGINE_MEMBER_HASH_MISMATCH', 'La extracción INITIAL no coincide con el paquete congelado.');
        }
        members.push({
          memberId,
          content: document.text,
          contentHash: binding.extraction_text_hash,
          hashKind: 'utf8_text',
          metadata: {
            documentVersionId: memberId,
            contentHash: binding.content_hash,
            extractionTextHash: binding.extraction_text_hash,
            sourceClassification: binding.source_classification,
            inclusionReason: binding.inclusion_reason,
          },
        });
      }
      return members;
    },

    async callModel({ job, batch, modelId, members, database, heartbeat }) {
      const execution = job?.payload?.execution;
      const budget = job?.payload?.budget;
      if (!execution || !budget) throw runtimeError('AGT002_ENGINE_MODEL_CALL_FAILED', 'La configuración de ejecución INITIAL no está disponible.');
      const synthesis = batch.phase === 'synthesis';
      const persistence = job.payload.persistence;

      let pkg = null;
      let company = null;
      let outputSchema;
      const extraInput = {};
      if (synthesis) {
        pkg = await loadPackage(database, persistence.packageVersionId);
        if (pkg?.version?.package_hash !== persistence.packageHash) throw agt002InitialDiagnosticError('package_hash_mismatch');
        if (persistence.g1Scope === 'A_PLUS_B') {
          try { company = await loadCompanyProfile(database, persistence.workflowInstanceId); }
          catch (error) { throw agt002InitialDiagnosticError(error?.diagnostic?.reason || 'company_profile_unavailable'); }
          extraInput.company_profile = company.snapshot;
        }
        outputSchema = buildInitialSynthesisModelSchema({ documentIds: pkg.members.map(member => member.document_version_id), scope: persistence.g1Scope });
        const officialContext = await loadOfficialContext(database, { opportunityId: job.opportunityId, tenderId: job.tenderId });
        if (officialContext) extraInput.official_crm_data = officialContext;
        extraInput.evidence_catalog = pkg.members.map(member => ({
          document_id: member.document_version_id,
          source_classification: member.source_classification,
          inclusion_reason: member.inclusion_reason,
        }));
      } else {
        outputSchema = buildInitialMemberOutputSchema({ memberIds: members.map(member => member.memberId) });
      }

      if (!synthesis) {
        // One durable member batch may need several model calls: split by size, renew the lease between calls.
        const memberIds = new Set(members.map(member => member.memberId));
        const calls = planAgt002InitialMemberCalls(members, memberCallMaxChars);
        const analysisNotes = []; const openItems = [];
        let inputTokens = 0; let outputTokens = 0;
        for (let index = 0; index < calls.length; index += 1) {
          if (index > 0 && typeof heartbeat === 'function') await heartbeat();
          const callResponse = await bridgeClient.run({
            model: modelId,
            policy: MEMBER_POLICY,
            input: {
              analysis_kind: 'INITIAL', phase: batch.phase,
              opportunity_id: job.opportunityId, tender_id: job.tenderId,
              package_version_id: persistence.packageVersionId,
              members: calls[index].map(piece => ({
                id: piece.member.memberId,
                metadata: { ...(piece.member.metadata ?? {}), ...(piece.part ? { part: piece.part } : {}) },
                content: piece.content,
              })),
            },
            outputSchema,
            timeoutMs: execution.timeoutMs,
            effort: execution.reasoningEffort,
            idempotencyKey: `${job.jobId}:${batch.phase}:${batch.batchIndex}:${batch.requestHash}${calls.length > 1 ? `:${index + 1}/${calls.length}` : ''}`,
          });
          let parsedCall;
          try { parsedCall = JSON.parse(callResponse.content); }
          catch { throw agt002InitialDiagnosticError('response_not_json'); }
          const notes = Array.isArray(parsedCall?.analysis_notes) ? parsedCall.analysis_notes : [];
          if (notes.some(note => !memberIds.has(note?.document_id))) throw agt002InitialDiagnosticError('member_note_unknown_document');
          analysisNotes.push(...notes);
          openItems.push(...(Array.isArray(parsedCall?.open_items) ? parsedCall.open_items : []));
          inputTokens += callResponse.usage.input_tokens; outputTokens += callResponse.usage.output_tokens;
        }
        const output = { analysis_notes: analysisNotes, open_items: openItems };
        const costUsd = (inputTokens * budget.inputCostPerMillionUsd + outputTokens * budget.outputCostPerMillionUsd) / 1_000_000;
        if (!Number.isFinite(costUsd)) throw runtimeError('AGT002_ENGINE_BUDGET_EXCEEDED', 'No fue posible comprobar el costo INITIAL.');
        return {
          output,
          outputSha256: hashAgt002InitialAnalysisOutput(output),
          usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd },
        };
      }

      const response = await bridgeClient.run({
        model: modelId,
        policy: (company ? SYNTHESIS_COMPANY_POLICY : SYNTHESIS_POLICY) + WRITING_POLICY + (extraInput.official_crm_data ? OFFICIAL_CONTEXT_POLICY : ''),
        input: {
          analysis_kind: 'INITIAL', phase: batch.phase,
          opportunity_id: job.opportunityId, tender_id: job.tenderId,
          package_version_id: persistence.packageVersionId,
          ...extraInput,
          members: members.map(member => ({ id: member.memberId, metadata: member.metadata ?? null, content: member.content })),
        },
        outputSchema,
        timeoutMs: execution.timeoutMs,
        effort: execution.reasoningEffort,
        idempotencyKey: `${job.jobId}:${batch.phase}:${batch.batchIndex}:${batch.requestHash}`,
      });
      let parsed;
      try { parsed = JSON.parse(response.content); }
      catch { throw agt002InitialDiagnosticError('response_not_json'); }

      let output = parsed;
      if (synthesis) {
        output = buildInitialAggregate({
          analysis: parsed,
          identity: {
            analysisRunId: persistence.analysisRunId,
            authorizationId: persistence.authorizationId,
            packageHash: persistence.packageHash,
            g1Scope: persistence.g1Scope,
            policyVersion: persistence.policyVersion,
            // REANALYSIS jobs (migration 108) carry their kind/version/source in the server-built persistence.
            analysisKind: persistence.analysisKind ?? 'INITIAL',
            analysisVersion: persistence.analysisVersion ?? 1,
            sourceAnalysisRunId: persistence.sourceAnalysisRunId ?? null,
            opportunityId: job.opportunityId,
            tenderId: job.tenderId,
            profileSnapshotId: company?.profileSnapshotId ?? null,
            profileSnapshotHash: company?.profileSnapshotHash ?? null,
          },
          pkg,
          now: now(),
          executor: { executorVersion, modelProfileId: modelId },
        });
        const validation = validateEnvelope(output);
        if (!validation.ok) {
          throw agt002InitialDiagnosticError('synthesis_validation_failed', {
            validation: validation.errors.slice(0, 25).map(({ path, code }) => ({ path, code })),
            total: validation.errors.length,
          });
        }
      } else {
        const memberIds = new Set(members.map(member => member.memberId));
        const notes = Array.isArray(parsed?.analysis_notes) ? parsed.analysis_notes : [];
        if (notes.some(note => !memberIds.has(note?.document_id))) throw agt002InitialDiagnosticError('member_note_unknown_document');
      }
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const costUsd = (inputTokens * budget.inputCostPerMillionUsd + outputTokens * budget.outputCostPerMillionUsd) / 1_000_000;
      if (!Number.isFinite(costUsd)) throw runtimeError('AGT002_ENGINE_BUDGET_EXCEEDED', 'No fue posible comprobar el costo INITIAL.');
      return {
        output,
        outputSha256: hashAgt002InitialAnalysisOutput(output),
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd },
      };
    },
  });
}

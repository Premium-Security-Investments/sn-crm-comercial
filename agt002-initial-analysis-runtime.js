import { createHash } from 'node:crypto';
import { resolveAgt002GovernedDocumentForExecution } from './agt002-governed-document-rehydration.js';
import { validatePreGoAnalysisV2, PRE_GO_SCHEMA_V2 } from './agt002-pre-go-analysis-v2.js';

const PRE_GO_SCHEMA = PRE_GO_SCHEMA_V2;
const MEMBER_OUTPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['analysis_notes', 'open_items'],
  properties: {
    analysis_notes: { type: 'array', items: { type: 'string' } },
    open_items: { type: 'array', items: { type: 'string' } },
  },
});

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

/** Creates the real INITIAL rehydration/model boundaries. Dependencies stay injectable for E0. */
export function createAgt002InitialAnalysisRuntime({
  bridgeClient,
  loadBindings = defaultLoadBindings,
  resolveDocument = resolveAgt002GovernedDocumentForExecution,
  validateEnvelope = validatePreGoAnalysisV2,
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

    async callModel({ job, batch, modelId, members }) {
      const execution = job?.payload?.execution;
      const budget = job?.payload?.budget;
      if (!execution || !budget) throw runtimeError('AGT002_ENGINE_MODEL_CALL_FAILED', 'La configuración de ejecución INITIAL no está disponible.');
      const synthesis = batch.phase === 'synthesis';
      const outputSchema = synthesis ? PRE_GO_SCHEMA : MEMBER_OUTPUT_SCHEMA;
      const policy = synthesis
        ? 'Produzca exactamente pre_go_analysis.v2 usando sólo los análisis de lote suministrados. No decida GO/NO-GO ni ejecute acciones.'
        : 'Analice únicamente la evidencia suministrada. Separe hallazgos y pendientes; no decida GO/NO-GO ni ejecute acciones.';
      const response = await bridgeClient.run({
        model: modelId,
        policy,
        input: {
          analysis_kind: 'INITIAL', phase: batch.phase,
          opportunity_id: job.opportunityId, tender_id: job.tenderId,
          package_version_id: job.payload.persistence.packageVersionId,
          members: members.map(member => ({ id: member.memberId, metadata: member.metadata ?? null, content: member.content })),
        },
        outputSchema,
        timeoutMs: execution.timeoutMs,
        effort: execution.reasoningEffort,
        idempotencyKey: `${job.jobId}:${batch.phase}:${batch.batchIndex}:${batch.requestHash}`,
      });
      let output;
      try { output = JSON.parse(response.content); }
      catch { throw runtimeError('AGT002_ENGINE_MODEL_CALL_FAILED', 'La respuesta INITIAL no es JSON válido.'); }
      if (synthesis) {
        const validation = validateEnvelope(output);
        if (!validation.ok) throw runtimeError('AGT002_ENGINE_MODEL_CALL_FAILED', 'La síntesis INITIAL no cumple pre_go_analysis.v2.');
        const persistence = job.payload.persistence;
        if (output?.meta?.analysis_run_id !== persistence.analysisRunId
            || output?.meta?.g1_authorization_id !== persistence.authorizationId
            || output?.meta?.package_hash !== persistence.packageHash
            || output?.meta?.g1_scope !== persistence.g1Scope) {
          throw runtimeError('AGT002_ENGINE_MODEL_CALL_FAILED', 'La síntesis INITIAL no coincide con las identidades reservadas por el servidor.');
        }
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

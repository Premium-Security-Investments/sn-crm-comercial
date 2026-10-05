import { createHash } from 'node:crypto';
import { resolveAgt002GovernedDocumentForExecution } from './agt002-governed-document-rehydration.js';
import { validatePreGoAnalysisV2 } from './agt002-pre-go-analysis-v2.js';
import {
  agt002InitialDiagnosticError, buildInitialAggregate, buildInitialMemberOutputSchema, buildInitialSynthesisModelSchema,
} from './agt002-initial-analysis-aggregate-builder.js';

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

const MEMBER_POLICY = 'Analice únicamente la evidencia suministrada. Cada nota debe indicar el documento del que sale (document_id) y dónde lo encontró (locator). No invente datos que el documento no contenga; separe lo hallado de lo pendiente. No decida GO/NO-GO ni ejecute acciones.';
const SYNTHESIS_POLICY = 'Produzca el análisis inicial usando sólo las notas de lote y el catálogo de evidencia suministrados. Cite cada fuente únicamente como {document_id, locator} tomados de las notas; no cite nada que las notas no respalden. Cubra todos los bloques de cobertura y declare como pendiente o ausente lo que la evidencia no permita afirmar. No hay perfil de empresa autorizado: la recomendación sólo puede ser HOLD_RECOMMENDED, NO_GO_RECOMMENDED o INSUFFICIENT_INFORMATION. No decida GO/NO-GO ni ejecute acciones.';

/** Creates the real INITIAL rehydration/model boundaries. Dependencies stay injectable for E0. */
export function createAgt002InitialAnalysisRuntime({
  bridgeClient,
  loadBindings = defaultLoadBindings,
  resolveDocument = resolveAgt002GovernedDocumentForExecution,
  validateEnvelope = validatePreGoAnalysisV2,
  loadPackage = defaultLoadPackage,
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

    async callModel({ job, batch, modelId, members, database }) {
      const execution = job?.payload?.execution;
      const budget = job?.payload?.budget;
      if (!execution || !budget) throw runtimeError('AGT002_ENGINE_MODEL_CALL_FAILED', 'La configuración de ejecución INITIAL no está disponible.');
      const synthesis = batch.phase === 'synthesis';
      const persistence = job.payload.persistence;

      let pkg = null;
      let outputSchema;
      const extraInput = {};
      if (synthesis) {
        pkg = await loadPackage(database, persistence.packageVersionId);
        if (pkg?.version?.package_hash !== persistence.packageHash) throw agt002InitialDiagnosticError('package_hash_mismatch');
        outputSchema = buildInitialSynthesisModelSchema({ documentIds: pkg.members.map(member => member.document_version_id) });
        extraInput.evidence_catalog = pkg.members.map(member => ({
          document_id: member.document_version_id,
          source_classification: member.source_classification,
          inclusion_reason: member.inclusion_reason,
        }));
      } else {
        outputSchema = buildInitialMemberOutputSchema({ memberIds: members.map(member => member.memberId) });
      }

      const response = await bridgeClient.run({
        model: modelId,
        policy: synthesis ? SYNTHESIS_POLICY : MEMBER_POLICY,
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
            opportunityId: job.opportunityId,
            tenderId: job.tenderId,
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

import { computeAgt002StableContentHash } from './tender-analysis-foundation.js';

export const AGT002_INCREMENTAL_DELTA_MANIFEST_VERSION = 'incremental_delta_manifest_v1';

const HEX64 = /^[0-9a-f]{64}$/;
const TRIGGER_KINDS = new Set([
  'official_document',
  'human_document',
  'company_evidence_link',
  'human_interaction',
  'actionable_review',
]);

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} es obligatorio.`);
  return value.trim();
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter(key => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} contiene campos no permitidos: ${extras.join(', ')}.`);
}

function normalizeMember(member) {
  if (!record(member)) throw new Error('Cada miembro cambiado debe ser un objeto.');
  exactKeys(member, [
    'signal_id', 'trigger_kind', 'source_table', 'source_type', 'source_id',
    'source_version', 'content_hash', 'observed_at', 'actor_profile_id', 'source_batch_id',
  ], 'El miembro cambiado');
  const triggerKind = text(member.trigger_kind, 'El tipo de disparador');
  if (!TRIGGER_KINDS.has(triggerKind)) throw new Error('El tipo de disparador no es válido.');
  const contentHash = text(member.content_hash, 'El hash del contenido');
  if (!HEX64.test(contentHash)) throw new Error('El hash del contenido debe ser SHA-256 hexadecimal.');
  return Object.freeze({
    signal_id: text(member.signal_id, 'La señal'),
    trigger_kind: triggerKind,
    source_table: text(member.source_table, 'La tabla fuente'),
    source_type: text(member.source_type, 'El tipo de fuente'),
    source_id: text(member.source_id, 'La identidad fuente'),
    source_version: text(member.source_version, 'La versión fuente'),
    content_hash: contentHash,
    observed_at: text(member.observed_at, 'El momento observado'),
    actor_profile_id: member.actor_profile_id == null ? null : text(member.actor_profile_id, 'El actor'),
    source_batch_id: member.source_batch_id == null ? null : text(member.source_batch_id, 'El lote oficial'),
  });
}

export function buildAgt002IncrementalDeltaManifest({
  opportunityId,
  tenderId,
  changeSetId,
  priorCanonicalRunId,
  priorContextVersionId,
  members,
  affectedFindingRefs = [],
  comparisonExcerpts = [],
  policyVersion,
}) {
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error('El manifiesto incremental requiere al menos un miembro cambiado.');
  }
  const normalizedMembers = members.map(normalizeMember).sort((left, right) =>
    left.signal_id.localeCompare(right.signal_id));
  if (new Set(normalizedMembers.map(item => item.signal_id)).size !== normalizedMembers.length) {
    throw new Error('El manifiesto incremental no admite señales duplicadas.');
  }
  for (const member of normalizedMembers) {
    if ((member.trigger_kind === 'official_document') !== (member.source_batch_id != null)) {
      throw new Error('source_batch_id es obligatorio sólo para miembros oficiales.');
    }
  }
  const sourceBatchIds = [...new Set(normalizedMembers.map(item => item.source_batch_id).filter(Boolean))].sort();
  const core = {
    schema_version: AGT002_INCREMENTAL_DELTA_MANIFEST_VERSION,
    opportunity_id: text(opportunityId, 'La oportunidad'),
    tender_id: text(tenderId, 'La licitación'),
    change_set_id: text(changeSetId, 'El conjunto de cambios'),
    source_batch_ids: sourceBatchIds,
    prior_canonical_run_id: text(priorCanonicalRunId, 'La corrida canónica previa'),
    prior_context_version_id: text(priorContextVersionId, 'La versión de contexto previa'),
    policy_version: text(policyVersion, 'La versión de política'),
    members: normalizedMembers,
    affected_finding_refs: [...new Set(affectedFindingRefs.map(value => text(value, 'La referencia de hallazgo')))].sort(),
    comparison_excerpts: comparisonExcerpts.map(item => {
      if (!record(item)) throw new Error('Cada excerpt de comparación debe ser un objeto.');
      exactKeys(item, ['finding_ref', 'source_id', 'content_hash', 'text'], 'El excerpt de comparación');
      const excerptHash = text(item.content_hash, 'El hash del excerpt');
      if (!HEX64.test(excerptHash) || computeAgt002StableContentHash(String(item.text ?? '')) !== excerptHash) {
        throw new Error('El excerpt de comparación no coincide con su hash.');
      }
      return {
        finding_ref: text(item.finding_ref, 'El hallazgo del excerpt'),
        source_id: text(item.source_id, 'La fuente del excerpt'),
        content_hash: excerptHash,
        text: String(item.text),
      };
    }).sort((left, right) => `${left.finding_ref}\0${left.source_id}`.localeCompare(`${right.finding_ref}\0${right.source_id}`)),
  };
  return Object.freeze({ ...core, manifest_hash: computeAgt002StableContentHash(core) });
}

export function validateAgt002IncrementalDeltaManifest(value) {
  if (!record(value)) throw new Error('El manifiesto incremental debe ser un objeto.');
  exactKeys(value, [
    'schema_version', 'opportunity_id', 'tender_id', 'change_set_id', 'source_batch_ids',
    'prior_canonical_run_id', 'prior_context_version_id', 'policy_version', 'members',
    'affected_finding_refs', 'comparison_excerpts', 'manifest_hash',
  ], 'El manifiesto incremental');
  const rebuilt = buildAgt002IncrementalDeltaManifest({
    opportunityId: value.opportunity_id,
    tenderId: value.tender_id,
    changeSetId: value.change_set_id,
    priorCanonicalRunId: value.prior_canonical_run_id,
    priorContextVersionId: value.prior_context_version_id,
    policyVersion: value.policy_version,
    members: value.members,
    affectedFindingRefs: value.affected_finding_refs,
    comparisonExcerpts: value.comparison_excerpts,
  });
  if (value.schema_version !== AGT002_INCREMENTAL_DELTA_MANIFEST_VERSION
    || JSON.stringify(value.source_batch_ids) !== JSON.stringify(rebuilt.source_batch_ids)
    || value.manifest_hash !== rebuilt.manifest_hash) {
    throw new Error('La identidad del manifiesto incremental no es válida.');
  }
  return rebuilt;
}

export function buildAgt002IncrementalAnalysisInput({ manifest, changedEvidence, priorFindings }) {
  const frozenManifest = validateAgt002IncrementalDeltaManifest(manifest);
  if (!Array.isArray(changedEvidence) || !Array.isArray(priorFindings)) {
    throw new Error('La evidencia cambiada y los hallazgos previos deben ser listas.');
  }
  const evidenceBySignal = new Map(changedEvidence.map(item => [item?.signal_id, item]));
  const analysisDocuments = frozenManifest.members.map(member => {
    const evidence = evidenceBySignal.get(member.signal_id);
    if (!record(evidence) || typeof evidence.text !== 'string'
      || computeAgt002StableContentHash(evidence.text) !== member.content_hash) {
      throw new Error('La evidencia cambiada no coincide con el miembro congelado.');
    }
    return Object.freeze({
      document_id: member.source_id,
      document_version_id: member.source_version,
      name: text(evidence.name, 'El nombre de la evidencia'),
      document_type: member.source_type,
      content: evidence.text,
      content_hash: member.content_hash,
      trigger_kind: member.trigger_kind,
      signal_id: member.signal_id,
    });
  });
  const affected = new Set(frozenManifest.affected_finding_refs);
  const affectedFindings = priorFindings.filter(item => affected.has(item?.finding_ref));
  const unaffectedFindingRefs = priorFindings
    .filter(item => !affected.has(item?.finding_ref))
    .map(item => text(item.finding_ref, 'La referencia del hallazgo previo'))
    .sort();
  return Object.freeze({
    manifest: frozenManifest,
    analysisDocuments,
    deepAnalysis: Object.freeze({
      mode: 'incremental_delta',
      prior_canonical_run_id: frozenManifest.prior_canonical_run_id,
      changed_member_count: analysisDocuments.length,
      affected_findings: affectedFindings,
      unaffected_finding_refs: unaffectedFindingRefs,
      comparison_excerpts: frozenManifest.comparison_excerpts,
    }),
  });
}

const FRONTS = ['legal', 'financial', 'technical'];
const MANIFEST_KEYS = ['requirement_manifest_version', 'requirement_manifest'];
const ENTRY_KEYS = ['requirement_id', 'front', 'label', 'sources', 'unresolved_sources'];
const SOURCE_KEYS = ['document_id', 'document_version_id', 'content_hash'];
const UNRESOLVED_SOURCE_KEYS = ['document_id', 'reason'];
export const AGT002_REQUIREMENT_MANIFEST_UNRESOLVED_REASON = 'document_identity_not_resolved';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * buildTenderDocumentAnalysis returns a legacy visual array at `.matrix` (category/status/detail
 * rows for the UI) and the real deterministic v1.0 requirement matrix nested at
 * `.deep_analysis.matrix` (Task 20/23's {legal,financial,technical} shape). This resolves the
 * correct one, preferring the nested shape and falling back to a flat `.matrix` object only when
 * it is not an array (legacy/unit-test fixtures that pass the inner shape directly).
 */
export function resolveAgt002DeepAnalysisMatrix(deepAnalysis) {
  const nested = deepAnalysis?.deep_analysis?.matrix;
  if (isRecord(nested)) return nested;
  const flat = deepAnalysis?.matrix;
  if (isRecord(flat)) return flat;
  return {};
}

function sameProvenanceTuple(left, right) {
  return left.document_id === right.document_id
    && left.document_version_id === right.document_version_id
    && left.content_hash === right.content_hash;
}

/**
 * evidence.document_id (Task 20/23's tender-requirement-extraction documentIdentity: `id ??
 * document_id` on whatever `documents` shape fed buildTenderDeepAnalysis) may legitimately carry
 * either the stable source document_id or the version id, depending on caller wiring — this
 * module has no control over that upstream choice. Both aliases are indexed to the exact same
 * provenance tuple so either one resolves. If the two aliases were ever to collide across two
 * different documents (same alias value, different tuple), that is an identity integrity error:
 * it fails closed explicitly rather than silently keeping whichever document was indexed last.
 */
function buildDocumentIndex(documents) {
  const index = new Map();
  for (const document of Array.isArray(documents) ? documents : []) {
    const documentVersionId = nonEmptyString(document?.document_version_id) ? document.document_version_id.trim() : '';
    const documentId = nonEmptyString(document?.document_id) ? document.document_id.trim() : '';
    const contentHash = typeof document?.content_hash === 'string' ? document.content_hash.trim().toLowerCase() : '';
    if (!documentVersionId || !documentId || !/^[0-9a-f]{64}$/.test(contentHash)) continue;
    const tuple = { document_id: documentId, document_version_id: documentVersionId, content_hash: contentHash };
    for (const alias of new Set([documentId, documentVersionId])) {
      const existing = index.get(alias);
      if (existing && !sameProvenanceTuple(existing, tuple)) {
        throw new Error(
          `AGT-002 requirement_manifest: el identificador de documento "${alias}" es ambiguo (conflicto entre document_id/document_version_id de procedencias distintas); no se puede resolver de forma segura.`,
        );
      }
      index.set(alias, tuple);
    }
  }
  return index;
}

/**
 * Builds the self-contained requirement provenance manifest carried inline inside
 * document_evidence/evidence_coverage (no new table). Each requirement keeps its id, label and
 * front, plus the resolved document version/hash for every evidence citation it has. An
 * evidence document_id that cannot be resolved against the adapted retrieval `documents` list
 * never becomes an invented source: it is recorded as an explicit, deterministic
 * `unresolved_sources` entry instead. A requirement with no evidence at all carries no
 * provenance claim and is dropped rather than persisted empty. If nothing anywhere resolves,
 * this fails closed instead of persisting a manifest with zero real provenance.
 */
export function buildAgt002RequirementManifest({ matrix, documents }) {
  const documentIndex = buildDocumentIndex(documents);
  const entries = [];
  const seenRequirementIds = new Set();
  let resolvedCount = 0;

  for (const front of FRONTS) {
    const requirements = Array.isArray(matrix?.[front]) ? matrix[front] : [];
    for (const requirement of requirements) {
      const requirementId = nonEmptyString(requirement?.id) ? requirement.id.trim() : '';
      const label = nonEmptyString(requirement?.label) ? requirement.label.trim() : '';
      const evidence = Array.isArray(requirement?.evidence) ? requirement.evidence : [];
      if (!requirementId || !label || evidence.length === 0) continue;

      if (seenRequirementIds.has(requirementId)) {
        throw new Error(`AGT-002 requirement_manifest: requirement_id duplicado entre fronts: ${requirementId}.`);
      }
      seenRequirementIds.add(requirementId);

      const evidenceDocumentIds = [...new Set(
        evidence
          .map(item => (nonEmptyString(item?.document_id) ? item.document_id.trim() : ''))
          .filter(Boolean),
      )].sort();
      if (!evidenceDocumentIds.length) continue;

      const sources = [];
      const unresolvedSources = [];
      for (const documentId of evidenceDocumentIds) {
        const resolved = documentIndex.get(documentId);
        if (resolved) sources.push(resolved);
        else unresolvedSources.push({ document_id: documentId, reason: AGT002_REQUIREMENT_MANIFEST_UNRESOLVED_REASON });
      }
      sources.sort((left, right) => left.document_version_id.localeCompare(right.document_version_id));

      resolvedCount += sources.length;
      entries.push({ requirement_id: requirementId, front, label, sources, unresolved_sources: unresolvedSources });
    }
  }

  entries.sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));

  if (resolvedCount === 0) {
    throw new Error(
      'AGT-002 requirement_manifest requiere al menos un requisito con procedencia documental resuelta (versión + hash); ningún document_id de evidencia resolvió contra los documentos recuperados.',
    );
  }

  return validateAgt002RequirementManifest({ requirement_manifest_version: '1.0', requirement_manifest: entries });
}

/** Defensive structural re-check: used both to self-validate the builder's own output and to
 * validate an untrusted envelope before it is persisted (agt002-preview-persistence.js never
 * trusts a manifest verbatim). */
export function validateAgt002RequirementManifest(value) {
  if (!exactKeys(value, MANIFEST_KEYS)) {
    throw new Error('El manifiesto de requisitos tiene claves no permitidas o incompletas.');
  }
  if (value.requirement_manifest_version !== '1.0') {
    throw new Error('La versión del manifiesto de requisitos no es válida.');
  }
  if (!Array.isArray(value.requirement_manifest) || value.requirement_manifest.length === 0) {
    throw new Error('El manifiesto de requisitos requiere al menos un requisito.');
  }

  const seen = new Set();
  let resolvedCount = 0;
  for (const entry of value.requirement_manifest) {
    if (!exactKeys(entry, ENTRY_KEYS)) {
      throw new Error('Un requisito del manifiesto tiene claves no permitidas o incompletas.');
    }
    if (!nonEmptyString(entry.requirement_id)) throw new Error('requirement_id inválido en el manifiesto.');
    if (seen.has(entry.requirement_id)) throw new Error(`requirement_id duplicado en el manifiesto: ${entry.requirement_id}.`);
    seen.add(entry.requirement_id);
    if (!FRONTS.includes(entry.front)) throw new Error(`front inválido en el manifiesto para ${entry.requirement_id}.`);
    if (!nonEmptyString(entry.label)) throw new Error(`label inválido en el manifiesto para ${entry.requirement_id}.`);
    if (!Array.isArray(entry.sources) || !Array.isArray(entry.unresolved_sources)) {
      throw new Error(`sources/unresolved_sources inválidos en el manifiesto para ${entry.requirement_id}.`);
    }
    for (const source of entry.sources) {
      if (!isRecord(source) || Object.hasOwn(source, 'text') || Object.hasOwn(source, 'excerpt')) {
        throw new Error(`Una fuente del manifiesto no puede persistir texto (${entry.requirement_id}).`);
      }
      if (!exactKeys(source, SOURCE_KEYS)) {
        throw new Error(`Una fuente del manifiesto tiene claves no permitidas (${entry.requirement_id}).`);
      }
      if (!nonEmptyString(source.document_id)) throw new Error(`document_id inválido en fuente (${entry.requirement_id}).`);
      if (!nonEmptyString(source.document_version_id)) throw new Error(`document_version_id inválido en fuente (${entry.requirement_id}).`);
      if (typeof source.content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(source.content_hash)) {
        throw new Error(`content_hash inválido en fuente (${entry.requirement_id}).`);
      }
    }
    for (const unresolved of entry.unresolved_sources) {
      if (!exactKeys(unresolved, UNRESOLVED_SOURCE_KEYS)) {
        throw new Error(`Una fuente no resuelta tiene claves no permitidas (${entry.requirement_id}).`);
      }
      if (!nonEmptyString(unresolved.document_id)) throw new Error(`document_id inválido en fuente no resuelta (${entry.requirement_id}).`);
      if (unresolved.reason !== AGT002_REQUIREMENT_MANIFEST_UNRESOLVED_REASON) {
        throw new Error(`reason inválido en fuente no resuelta (${entry.requirement_id}).`);
      }
    }
    resolvedCount += entry.sources.length;
  }
  if (resolvedCount === 0) {
    throw new Error('El manifiesto de requisitos requiere al menos un requisito con procedencia resuelta.');
  }
  return value;
}

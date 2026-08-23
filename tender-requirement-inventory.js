import { createHash } from 'node:crypto';

export const TENDER_REQUIREMENT_INVENTORY_VERSION = 'tender_requirement_inventory.v1';

const INVENTORY_KEYS = Object.freeze([
  'inventory_version', 'snapshot_id', 'snapshot_hash', 'inventory_hash', 'source_units',
  'coverage_ledger', 'expedient_coverage', 'analyzed_coverage', 'requirements',
  'decision_ready', 'recommendation', 'human_review_required', 'historical_catalog_not_integral',
]);
const SOURCE_UNIT_KEYS = Object.freeze([
  'source_unit_id', 'document_id', 'document_version_id', 'content_hash', 'unit_hash',
  'disposition', 'reason',
]);
const REQUIREMENT_KEYS = Object.freeze(['requirement_id', 'label', 'citations', 'supplemental_signal_ids']);
const CITATION_KEYS = Object.freeze(['source_unit_id', 'unit_hash']);
const LEDGER_KEYS = Object.freeze([
  'total_source_units', 'analyzable_count', 'unresolved_visible_count', 'excluded_with_reason_count',
  'every_source_unit_disposed',
]);
const COVERAGE_KEYS = Object.freeze(['status', 'total_source_units', 'dispositioned_source_units', 'requirement_count']);
const DISPOSITIONS = new Set(['analyzable', 'unresolved_visible', 'excluded_with_reason']);
const COVERAGE_STATUSES = new Set(['complete', 'partial', 'incomplete']);
const HISTORICAL_FIXED_IDS = new Set([
  'legal-rce-policy', 'legal-collective-life-policy', 'financial-working-capital', 'technical-video-surveillance-scope',
]);
// Fixed disposition reason for a document whose declared content_hash is absent or not a
// sha256 digest. Deterministic and closed: the untrusted declared value is never echoed here.
export const UNVERIFIABLE_CONTENT_HASH_REASON = 'unverifiable_content_hash';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value) || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} tiene claves inválidas.`);
  }
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} debe ser texto no vacío.`);
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function normalizedText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim().normalize('NFC');
}

function documentText(document) {
  return String(document?.extracted_text ?? document?.content ?? '');
}

function documentIdentity(document, field, legacyField = null) {
  return nonEmpty(document?.[field] ?? (legacyField ? document?.[legacyField] : undefined), `Documento.${field}`);
}

function declaredContentHash(document) {
  return typeof document?.content_hash === 'string' ? document.content_hash.trim().toLowerCase() : '';
}

/**
 * Single definition of "this document's content_hash can anchor a verifiable citation".
 * Shared with the preview packet builders so chunking and the inventory always partition the
 * same snapshot the same way, and the identity reserved at enqueue equals the one the engine
 * rebuilds at analysis time.
 */
export function isTenderDocumentContentHashVerifiable(document) {
  return isSha256(declaredContentHash(document));
}

const byDocumentIdentity = (left, right) => (
  left.document_id.localeCompare(right.document_id) || left.document_version_id.localeCompare(right.document_version_id)
);

function canonicalDocumentRecords(documents) {
  const seen = new Set();
  const analyzable = [];
  const unresolved = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    const documentId = documentIdentity(document, 'document_id', 'source_document_id');
    const documentVersionId = documentIdentity(document, 'document_version_id', 'id');
    const key = `${documentId}\0${documentVersionId}`;
    if (seen.has(key)) throw new Error(`Documento/version duplicado en inventario: ${documentId}.`);
    seen.add(key);
    const content = documentText(document);
    const extractedTextHash = sha256(content);
    const contentHash = declaredContentHash(document);
    // A legacy/current document whose content_hash is missing or is not a real sha256 cannot
    // anchor a verifiable citation: any requirement built from it would cite a hash nobody can
    // check. It is neither dropped (that would fabricate coverage) nor allowed to crash identity
    // building (that would take down enqueue/persistence for the whole snapshot). It becomes a
    // deterministic unresolved source unit instead, exactly like a durable import gap.
    if (!isSha256(contentHash)) {
      unresolved.push({
        document_id: documentId,
        document_version_id: documentVersionId,
        declared_content_hash: contentHash || null,
        extracted_text_hash: extractedTextHash,
        reason: UNVERIFIABLE_CONTENT_HASH_REASON,
      });
      continue;
    }
    analyzable.push({
      document_id: documentId,
      document_version_id: documentVersionId,
      content_hash: contentHash,
      extracted_text_hash: extractedTextHash,
      content,
    });
  }
  return {
    documents: analyzable.sort(byDocumentIdentity),
    unresolvedDocuments: unresolved.sort(byDocumentIdentity),
  };
}

function canonicalGaps(documentGaps) {
  const seen = new Set();
  return [...(Array.isArray(documentGaps) ? documentGaps : [])].map(gap => {
    const documentId = nonEmpty(gap?.document_id, 'Gap.document_id');
    const reason = nonEmpty(gap?.reason, 'Gap.reason');
    const key = `${documentId}\0${reason}`;
    if (seen.has(key)) throw new Error(`Gap duplicado en inventario: ${documentId}.`);
    seen.add(key);
    return { document_id: documentId, reason };
  }).sort((left, right) => left.document_id.localeCompare(right.document_id) || left.reason.localeCompare(right.reason));
}

function inventorySnapshotHash(documents, unresolvedDocuments, gaps) {
  return sha256(stableJson({
    documents: documents.map(({ document_id, document_version_id, content_hash, extracted_text_hash }) => ({
      document_id, document_version_id, content_hash, extracted_text_hash,
    })),
    // Emitted only when the snapshot actually carries an unverifiable document, so a healthy
    // expediente keeps the exact snapshot_hash (and therefore the exact idempotency identity)
    // it had before this branch existed. When present, the declared-but-rejected hash and the
    // extracted-text hash are both bound, so repairing or re-extracting such a document
    // produces a different identity and cannot silently reuse the degraded run.
    ...(unresolvedDocuments.length ? {
      unresolved_documents: unresolvedDocuments.map(({ document_id, document_version_id, declared_content_hash, extracted_text_hash, reason }) => ({
        document_id, document_version_id, declared_content_hash, extracted_text_hash, reason,
      })),
    } : {}),
    gaps,
  }));
}

function unitId({ snapshotId, documentId, documentVersionId, index, unitHash }) {
  return `unit:${sha256(`${snapshotId}\0${documentId}\0${documentVersionId}\0${index}\0${unitHash}`).slice(0, 32)}`;
}

function buildSourceUnits({ snapshotId, documents, unresolvedDocuments, gaps }) {
  const units = [];
  const unresolvedDocumentIds = new Set(gaps.map(gap => gap.document_id));
  // A document with an unverifiable content_hash is disposed exactly once, as unresolved.
  // Its own content_hash is a deterministic derivation (the source-unit contract requires a
  // sha256 there), never the rejected declared value and never a hash of the document text —
  // so it can never be mistaken for verified provenance or cited as evidence.
  for (const document of unresolvedDocuments) {
    if (unresolvedDocumentIds.has(document.document_id)) continue;
    const unitHash = sha256(`unresolved_document\0${document.document_id}\0${document.document_version_id}\0${document.reason}`);
    const contentHash = sha256(`unverifiable_content_hash\0${document.document_id}\0${document.document_version_id}\0${document.declared_content_hash ?? ''}`);
    units.push({
      source_unit_id: unitId({ snapshotId, documentId: document.document_id, documentVersionId: document.document_version_id, index: 0, unitHash }),
      document_id: document.document_id,
      document_version_id: document.document_version_id,
      content_hash: contentHash,
      unit_hash: unitHash,
      disposition: 'unresolved_visible',
      reason: document.reason,
    });
  }
  for (const document of documents) {
    // A durable extraction/import gap is authoritative for this snapshot. The same document
    // cannot simultaneously contribute analyzable paragraphs and an unresolved gap unit.
    if (unresolvedDocumentIds.has(document.document_id)) continue;
    const paragraphs = document.content.split(/\n\s*\n|\n+/).map(normalizedText).filter(Boolean);
    if (!paragraphs.length) {
      const unitHash = sha256('');
      units.push({
        source_unit_id: unitId({ snapshotId, documentId: document.document_id, documentVersionId: document.document_version_id, index: 0, unitHash }),
        document_id: document.document_id,
        document_version_id: document.document_version_id,
        content_hash: document.content_hash,
        unit_hash: unitHash,
        disposition: 'unresolved_visible',
        reason: 'empty_or_unextractable_document',
      });
      continue;
    }
    paragraphs.forEach((paragraph, index) => {
      const unitHash = sha256(paragraph);
      units.push({
        source_unit_id: unitId({ snapshotId, documentId: document.document_id, documentVersionId: document.document_version_id, index, unitHash }),
        document_id: document.document_id,
        document_version_id: document.document_version_id,
        content_hash: document.content_hash,
        unit_hash: unitHash,
        disposition: 'analyzable',
        reason: null,
        _normalized_text: paragraph,
      });
    });
  }
  for (const gap of gaps) {
    const contentHash = sha256(`gap\0${gap.document_id}\0${gap.reason}`);
    const unitHash = sha256(`unresolved\0${gap.document_id}\0${gap.reason}`);
    units.push({
      source_unit_id: unitId({ snapshotId, documentId: gap.document_id, documentVersionId: 'gap', index: 0, unitHash }),
      document_id: gap.document_id,
      document_version_id: 'gap',
      content_hash: contentHash,
      unit_hash: unitHash,
      disposition: 'unresolved_visible',
      reason: gap.reason,
    });
  }
  return units.sort((left, right) => left.source_unit_id.localeCompare(right.source_unit_id));
}

function buildRequirements({ snapshotId, sourceUnits }) {
  const byText = new Map();
  for (const unit of sourceUnits) {
    if (unit.disposition !== 'analyzable') continue;
    const normalized = unit._normalized_text;
    const entry = byText.get(normalized) ?? { normalized, citations: [] };
    entry.citations.push({ source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash });
    byText.set(normalized, entry);
  }
  return [...byText.values()].map(entry => {
    const citations = entry.citations.sort((left, right) => left.source_unit_id.localeCompare(right.source_unit_id));
    const requirementId = `req:${sha256(`${snapshotId}\0${TENDER_REQUIREMENT_INVENTORY_VERSION}\0${entry.normalized}\0${stableJson(citations)}`).slice(0, 32)}`;
    return {
      requirement_id: requirementId,
      label: `Requisito documental ${sha256(entry.normalized).slice(0, 12)}`,
      citations,
      // Fixed extractors may be correlated later, but cannot become inventory boundary or coverage.
      supplemental_signal_ids: [],
    };
  }).sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
}

function legacyCatalogOnly(historicalAnalysis) {
  const ids = historicalAnalysis?.requirement_ids;
  return Array.isArray(ids) && ids.length === 4 && ids.every(id => HISTORICAL_FIXED_IDS.has(id));
}

function publicSourceUnits(sourceUnits) {
  return sourceUnits.map(({ _normalized_text, ...unit }) => unit);
}

function coverageFor(sourceUnits, requirements) {
  const analyzable = sourceUnits.filter(unit => unit.disposition === 'analyzable').length;
  const unresolved = sourceUnits.filter(unit => unit.disposition === 'unresolved_visible').length;
  const excluded = sourceUnits.filter(unit => unit.disposition === 'excluded_with_reason').length;
  const total = sourceUnits.length;
  const dispositioned = analyzable + unresolved + excluded;
  const expStatus = total === 0 ? 'incomplete' : unresolved || excluded ? 'partial' : 'complete';
  return {
    coverage_ledger: {
      total_source_units: total,
      analyzable_count: analyzable,
      unresolved_visible_count: unresolved,
      excluded_with_reason_count: excluded,
      every_source_unit_disposed: total === dispositioned,
    },
    expedient_coverage: {
      status: expStatus,
      total_source_units: total,
      dispositioned_source_units: dispositioned,
      requirement_count: requirements.length,
    },
    // This P0 contract deliberately does not pretend that segmentation equals semantic analysis.
    analyzed_coverage: {
      status: 'incomplete',
      total_source_units: total,
      dispositioned_source_units: 0,
      requirement_count: 0,
    },
  };
}

function inventoryHash(value) {
  const { inventory_hash, ...withoutHash } = value;
  return sha256(stableJson(withoutHash));
}

export function buildTenderRequirementInventory({ snapshotId, documents = [], documentGaps = [], historicalAnalysis = null } = {}) {
  const normalizedSnapshotId = nonEmpty(snapshotId, 'snapshotId');
  const { documents: canonicalDocuments, unresolvedDocuments } = canonicalDocumentRecords(documents);
  const gaps = canonicalGaps(documentGaps);
  const sourceUnits = buildSourceUnits({ snapshotId: normalizedSnapshotId, documents: canonicalDocuments, unresolvedDocuments, gaps });
  const requirements = buildRequirements({ snapshotId: normalizedSnapshotId, sourceUnits });
  const coverage = coverageFor(sourceUnits, requirements);
  const result = {
    inventory_version: TENDER_REQUIREMENT_INVENTORY_VERSION,
    snapshot_id: normalizedSnapshotId,
    snapshot_hash: inventorySnapshotHash(canonicalDocuments, unresolvedDocuments, gaps),
    inventory_hash: '',
    source_units: publicSourceUnits(sourceUnits),
    ...coverage,
    requirements,
    decision_ready: false,
    recommendation: 'pause',
    human_review_required: true,
    historical_catalog_not_integral: legacyCatalogOnly(historicalAnalysis),
  };
  result.inventory_hash = inventoryHash(result);
  return validateTenderRequirementInventory(result);
}

export function tenderRequirementInventoryIdentity(value) {
  const inventory = validateTenderRequirementInventory(value);
  return {
    inventoryVersion: inventory.inventory_version,
    inventoryHash: inventory.inventory_hash,
    snapshotHash: inventory.snapshot_hash,
  };
}

export function validateTenderRequirementInventory(value) {
  exactKeys(value, INVENTORY_KEYS, 'Inventario de requisitos');
  if (value.inventory_version !== TENDER_REQUIREMENT_INVENTORY_VERSION) throw new Error('Versión de inventario de requisitos inválida.');
  nonEmpty(value.snapshot_id, 'snapshot_id');
  if (!isSha256(value.snapshot_hash) || !isSha256(value.inventory_hash)) throw new Error('Hash de inventario o snapshot inválido.');
  if (!Array.isArray(value.source_units) || !Array.isArray(value.requirements)) throw new Error('El inventario requiere source_units y requirements como listas.');
  exactKeys(value.coverage_ledger, LEDGER_KEYS, 'coverage_ledger');
  exactKeys(value.expedient_coverage, COVERAGE_KEYS, 'expedient_coverage');
  exactKeys(value.analyzed_coverage, COVERAGE_KEYS, 'analyzed_coverage');
  if (!COVERAGE_STATUSES.has(value.expedient_coverage.status) || !COVERAGE_STATUSES.has(value.analyzed_coverage.status)) throw new Error('Estado de cobertura inválido.');
  if (value.decision_ready !== false || value.recommendation !== 'pause' || value.human_review_required !== true) {
    throw new Error('El inventario P0 debe pausar decisión y requerir revisión humana.');
  }
  if (typeof value.historical_catalog_not_integral !== 'boolean') throw new Error('Indicador histórico de catálogo inválido.');

  const sourceById = new Map();
  for (const unit of value.source_units) {
    exactKeys(unit, SOURCE_UNIT_KEYS, 'source_unit');
    nonEmpty(unit.source_unit_id, 'source_unit_id');
    if (sourceById.has(unit.source_unit_id)) throw new Error(`source_unit_id duplicado: ${unit.source_unit_id}.`);
    nonEmpty(unit.document_id, 'source_unit.document_id');
    nonEmpty(unit.document_version_id, 'source_unit.document_version_id');
    if (!isSha256(unit.content_hash) || !isSha256(unit.unit_hash)) throw new Error(`Hash inválido para source_unit ${unit.source_unit_id}.`);
    if (!DISPOSITIONS.has(unit.disposition)) throw new Error(`Disposición inválida para source_unit ${unit.source_unit_id}.`);
    if (unit.disposition === 'analyzable' ? unit.reason !== null : typeof unit.reason !== 'string' || !unit.reason.trim()) {
      throw new Error(`La disposición de source_unit ${unit.source_unit_id} requiere reason coherente.`);
    }
    sourceById.set(unit.source_unit_id, unit);
  }

  const requirementIds = new Set();
  for (const requirement of value.requirements) {
    exactKeys(requirement, REQUIREMENT_KEYS, 'requirement');
    nonEmpty(requirement.requirement_id, 'requirement_id');
    if (requirementIds.has(requirement.requirement_id)) throw new Error(`requirement_id duplicado: ${requirement.requirement_id}.`);
    requirementIds.add(requirement.requirement_id);
    nonEmpty(requirement.label, 'requirement.label');
    if (!Array.isArray(requirement.citations) || requirement.citations.length === 0) throw new Error(`El requisito ${requirement.requirement_id} requiere citas.`);
    if (!Array.isArray(requirement.supplemental_signal_ids) || requirement.supplemental_signal_ids.some(id => typeof id !== 'string')) throw new Error('supplemental_signal_ids inválido.');
    const citedUnits = new Set();
    for (const citation of requirement.citations) {
      exactKeys(citation, CITATION_KEYS, 'cita');
      const source = sourceById.get(citation.source_unit_id);
      if (!source || source.disposition !== 'analyzable') throw new Error(`Cita no permitida para requisito ${requirement.requirement_id}.`);
      if (source.unit_hash !== citation.unit_hash || !isSha256(citation.unit_hash)) throw new Error(`Hash de cita inválido para requisito ${requirement.requirement_id}.`);
      if (citedUnits.has(citation.source_unit_id)) throw new Error(`Cita duplicada para requisito ${requirement.requirement_id}.`);
      citedUnits.add(citation.source_unit_id);
    }
  }

  const analyzable = [...sourceById.values()].filter(unit => unit.disposition === 'analyzable').length;
  const unresolved = [...sourceById.values()].filter(unit => unit.disposition === 'unresolved_visible').length;
  const excluded = [...sourceById.values()].filter(unit => unit.disposition === 'excluded_with_reason').length;
  const total = sourceById.size;
  if (value.coverage_ledger.total_source_units !== total
    || value.coverage_ledger.analyzable_count !== analyzable
    || value.coverage_ledger.unresolved_visible_count !== unresolved
    || value.coverage_ledger.excluded_with_reason_count !== excluded
    || value.coverage_ledger.every_source_unit_disposed !== true) {
    throw new Error('coverage_ledger no dispone todas las source_units de forma consistente.');
  }
  for (const coverage of [value.expedient_coverage, value.analyzed_coverage]) {
    if (coverage.total_source_units !== total || !Number.isInteger(coverage.dispositioned_source_units) || !Number.isInteger(coverage.requirement_count)) {
      throw new Error('Cobertura de expediente/análisis inconsistente.');
    }
  }
  const expectedExpedientStatus = total === 0 ? 'incomplete' : unresolved || excluded ? 'partial' : 'complete';
  if (value.expedient_coverage.status !== expectedExpedientStatus || value.expedient_coverage.dispositioned_source_units !== total || value.expedient_coverage.requirement_count !== value.requirements.length) {
    throw new Error('Cobertura del expediente no coincide con el ledger.');
  }
  if (value.analyzed_coverage.status !== 'incomplete' || value.analyzed_coverage.dispositioned_source_units !== 0 || value.analyzed_coverage.requirement_count !== 0) {
    throw new Error('La cobertura analizada P0 no puede presentarse como completa.');
  }
  if (inventoryHash(value) !== value.inventory_hash) throw new Error('El hash del inventario no coincide con su contenido.');
  return value;
}

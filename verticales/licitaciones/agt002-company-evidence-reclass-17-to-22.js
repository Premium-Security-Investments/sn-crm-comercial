// F2 read-only first slice: a deterministic 17→22 reclassification manifest/validator/
// dry-run report for the AGT-002 company evidence catalog. This module is PURE: it never
// reads a database, SharePoint, or any file; it never writes anything; it never imports
// migration 075 or touches DANE/AGT-003. It only validates a `repositoryInputs` bundle
// supplied by the caller and, when (and only when) that bundle is complete and internally
// consistent, computes a stable sha256 hash over it and reports a summary.
//
// Why this exists: the plan for a 17→22 reclassification (merges/splits, archive-not-
// delete, historical version pointers, a prospective default, governed reversible
// historical reclassification, a synchronized entry/version/hash/sensitivity group, an
// existing approval record, five independently-tracked semantic states, a revalidation
// queue, and opaque PII references) requires source data that does not exist in this
// repository today:
//   - No 22-class target manifest for any v0.3.1 (or later) revision exists anywhere in
//     this repo. The only 22-class artifact found (docs/AGT002_COMPANY_EVIDENCE_MANIFEST_V031.md)
//     is the OPPOSITE direction: a 22-documental-class → 17-technical-class projection
//     (with merges only, no splits), already carried forward by migration 075 — which
//     forwards the existing 17 rows and does not mint any 22-row target table.
//   - No approval record matching (approver, 2026-08-29, status APPROVED_CANONICAL_CONDITIONAL,
//     source/version/hash/scope/exclusions) was found anywhere in this repo.
//   - agt002-company-evidence-sharepoint-catalog.js structurally forbids ever carrying a raw
//     SharePoint item id or eTag ("never an item id, name, path, URL, eTag ... or any
//     personal data"); a literal "synchronized ... SharePoint item ID/eTag" field would
//     directly conflict with that existing control.
//   - agt002-company-evidence-classes.js's own minimal-exposure allowlist
//     (AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS) explicitly excludes a "sensibilidad"
//     (sensitivity) column from any read of the closed 17-class registry; synchronizing a
//     "sensitivity" field onto a 22-class manifest needs an explicit governance decision
//     about where that value would even come from.
//
// None of the above is invented here. Instead, this module encodes every one of those as a
// REQUIRED input shape and fails closed — with an explicit, itemized blocker per missing or
// conflicting input — whenever the supplied repositoryInputs bundle does not fully resolve
// them. It never guesses a value to make READY true.

import { createHash } from 'node:crypto';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';

export const AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS = AGT002_COMPANY_EVIDENCE_CLASS_IDS;
export const AGT002_RECLASS_17_TO_22_TARGET_CLASS_COUNT = 22;

export const AGT002_RECLASS_17_TO_22_MAPPING_KINDS = Object.freeze(['one_to_one', 'merge']);
export const AGT002_RECLASS_17_TO_22_TEMPORAL_APPLICABILITY = Object.freeze(['prospective', 'historical']);
export const AGT002_RECLASS_17_TO_22_APPROVAL_STATUSES = Object.freeze([
  'PENDING',
  'APPROVED_CANONICAL_CONDITIONAL',
  'APPROVED_UNCONDITIONAL',
  'REJECTED',
]);

// Subset of AGT002_RECLASS_17_TO_22_APPROVAL_STATUSES that actually authorizes a
// reclassification — PENDING/REJECTED/anything else must fail closed, never be treated as
// good enough because it is merely a recognized status value.
export const AGT002_RECLASS_17_TO_22_APPROVED_STATUSES = Object.freeze([
  'APPROVED_CANONICAL_CONDITIONAL',
  'APPROVED_UNCONDITIONAL',
]);

// The five semantic states this plan requires kept strictly separate — mirrors the
// existing presence/review/validity/applicability/compliance separation in
// agt002-company-evidence-classes.js: none of these may ever be derived from another.
export const AGT002_RECLASS_17_TO_22_SEMANTIC_STATE_KEYS = Object.freeze([
  'catalogueApproved',
  'evidenceCurrent',
  'requirementMatched',
  'humanValidated',
  'submissionAuthorized',
]);

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const OPAQUE_REF_PATTERN = /^(?:[0-9a-f]{64}|opaque:[a-zA-Z0-9._-]{8,})$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Any of these keys appearing anywhere inside a target entry means a raw, non-opaque
// reference (SharePoint item id/eTag, a storage path/URL, or direct PII) is being carried
// — structurally forbidden regardless of governance acknowledgements.
const FORBIDDEN_RAW_REF_KEYS = Object.freeze([
  'item_id', 'itemId', 'etag', 'eTag', 'path', 'url', 'signed_url', 'signedUrl',
  'content', 'secret', 'password', 'token', 'ssn', 'cedula', 'email', 'phone',
  'address', 'name', 'account_number', 'accountNumber',
]);

// Raw-reference/PII-ish value shapes forbidden under ANY key, anywhere in the input —
// catches a disguised raw reference (e.g. a SharePoint URL or an email) even when it is not
// carried under one of the FORBIDDEN_RAW_REF_KEYS names above.
const FORBIDDEN_RAW_REF_VALUE_PATTERNS = Object.freeze([
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/, // email
  /^(?:https?:\/\/|www\.)/i, // url
  /^(?:\/|[a-zA-Z]:\\|\\\\)/, // absolute unix/windows path
]);

// Explicit safe VALUE PATHS — not bare key names: approvalRecord.hash and
// targetEntries[i].evidenceRef/sharePointSyncRef already have their own dedicated, stricter
// format validator elsewhere (HASH_PATTERN / OPAQUE_REF_PATTERN), so the generic PII-ish
// value scan below does not double-guess them AT THOSE EXACT CANONICAL LOCATIONS. The same
// key names appearing anywhere else (e.g. governanceAcknowledgements.hash,
// archivedEntries[i].evidenceRef, mappingRules[i].hash, targetManifest.hash) are NOT exempt
// and must still be recursively scanned and rejected — a bare-key exemption would let a raw
// URL/email/path be smuggled in under one of these names at an unexpected location.
const CANONICAL_SAFE_VALUE_PATH_PATTERNS = Object.freeze([
  /^approvalRecord\.hash$/,
  /^targetEntries\[\d+\]\.evidenceRef$/,
  /^targetEntries\[\d+\]\.sharePointSyncRef$/,
]);

function isCanonicalSafeValuePath(path) {
  return CANONICAL_SAFE_VALUE_PATH_PATTERNS.some(pattern => pattern.test(path));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

/**
 * Deterministic sha256 over exactly the supplied (already-validated) input — key order
 * never affects the result. Computes over what it is given only; never fetches, infers or
 * invents anything itself.
 */
export function computeAgt002Reclass17To22Hash(input) {
  return createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');
}

// Recursively scans the ENTIRE supplied bundle — archive, approval, acknowledgements,
// rules, target manifest, target entries, everything — for forbidden raw-reference keys
// (by name) and PII-ish raw-reference values (by shape), regardless of where they appear.
function findForbiddenRawRefIssues(value, path = '') {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (
        typeof item === 'string'
        && !isCanonicalSafeValuePath(itemPath)
        && FORBIDDEN_RAW_REF_VALUE_PATTERNS.some(pattern => pattern.test(item))
      ) {
        hits.push(itemPath);
      }
      hits.push(...findForbiddenRawRefIssues(item, itemPath));
    });
  } else if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`.replace(/^\./, '');
      if (FORBIDDEN_RAW_REF_KEYS.includes(key)) hits.push(nestedPath);
      if (
        typeof nested === 'string'
        && !isCanonicalSafeValuePath(nestedPath)
        && FORBIDDEN_RAW_REF_VALUE_PATTERNS.some(pattern => pattern.test(nested))
      ) {
        hits.push(nestedPath);
      }
      hits.push(...findForbiddenRawRefIssues(nested, nestedPath));
    }
  }
  return hits;
}

function pushMissing(blockers, condition, message) {
  if (!condition) blockers.push(message);
}

function validateApprovalRecord(approvalRecord, blockers) {
  if (!isPlainObject(approvalRecord)) {
    blockers.push(
      'approvalRecord ausente: se requiere un registro de aprobación existente ' +
      '(approver, date, status, source, version, hash, scope, exclusions) — no encontrado ' +
      'en el repositorio bajo ese perfil (approver/2026-08-29/APPROVED_CANONICAL_CONDITIONAL) y no debe inventarse.',
    );
    return;
  }
  pushMissing(blockers, typeof approvalRecord.approver === 'string' && approvalRecord.approver.trim(), 'approvalRecord.approver debe ser texto no vacío.');
  pushMissing(blockers, typeof approvalRecord.date === 'string' && ISO_DATE_PATTERN.test(approvalRecord.date), 'approvalRecord.date debe ser una fecha ISO (YYYY-MM-DD).');
  pushMissing(
    blockers,
    AGT002_RECLASS_17_TO_22_APPROVED_STATUSES.includes(approvalRecord.status),
    `approvalRecord.status debe ser exactamente uno de los estados aprobados: ${AGT002_RECLASS_17_TO_22_APPROVED_STATUSES.join(', ')} ` +
    `(estados reconocidos pero NO aprobatorios como PENDING/REJECTED deben fallar cerrado, encontrado: ${String(approvalRecord.status)}).`,
  );
  pushMissing(blockers, typeof approvalRecord.source === 'string' && approvalRecord.source.trim(), 'approvalRecord.source debe ser texto no vacío.');
  pushMissing(blockers, typeof approvalRecord.version === 'string' && approvalRecord.version.trim(), 'approvalRecord.version debe ser texto no vacío.');
  pushMissing(blockers, typeof approvalRecord.hash === 'string' && HASH_PATTERN.test(approvalRecord.hash), 'approvalRecord.hash debe ser un sha256 hexadecimal de 64 caracteres.');
  pushMissing(blockers, Array.isArray(approvalRecord.scope) && approvalRecord.scope.length > 0 && approvalRecord.scope.every(item => typeof item === 'string' && item.trim()), 'approvalRecord.scope debe ser una lista no vacía de strings.');
  pushMissing(blockers, Array.isArray(approvalRecord.exclusions) && approvalRecord.exclusions.every(item => typeof item === 'string' && item.trim()), 'approvalRecord.exclusions debe ser una lista de strings (puede ser vacía).');
}

/**
 * Binds approvalRecord.version/hash/scope deterministically to the EXACT targetManifest +
 * mappingRules content being validated — on every path, not only when an entry declares a
 * historical reclassification. An approval that does not name this precise version, does not
 * hash-match this precise content, or whose scope does not explicitly cover this precise
 * version must fail closed rather than being accepted on trust.
 */
function validateApprovalBinding(approvalRecord, targetManifest, mappingRules, blockers) {
  if (!isPlainObject(approvalRecord)) return;
  if (!isPlainObject(targetManifest) || !Array.isArray(targetManifest.classes)) return;
  if (typeof targetManifest.version !== 'string' || !targetManifest.version.trim()) return;
  if (!Array.isArray(mappingRules)) return;

  if (approvalRecord.version !== targetManifest.version) {
    blockers.push(
      `approvalRecord.version (${JSON.stringify(approvalRecord.version)}) debe coincidir exactamente con ` +
      `targetManifest.version (${targetManifest.version}) — la aprobación debe estar atada a la versión exacta validada.`,
    );
  }
  const expectedHash = computeAgt002Reclass17To22Hash({ targetManifest, mappingRules });
  if (approvalRecord.hash !== expectedHash) {
    blockers.push(
      `approvalRecord.hash no coincide con el hash determinístico del contenido exacto de ` +
      `targetManifest/mappingRules siendo validado (esperado ${expectedHash}) — la aprobación no está atada al contenido exacto.`,
    );
  }
  if (!Array.isArray(approvalRecord.scope) || !approvalRecord.scope.includes(targetManifest.version)) {
    blockers.push(
      `approvalRecord.scope debe incluir explícitamente la versión exacta validada (${targetManifest.version}) — ` +
      'el alcance de la aprobación debe atarse a ese contenido en cada validación, no sólo en reclasificaciones históricas.',
    );
  }
}

function validateTargetManifest(targetManifest, blockers) {
  if (!isPlainObject(targetManifest) || !Array.isArray(targetManifest.classes)) {
    blockers.push(
      'targetManifest ausente: no existe en este repositorio un manifiesto autoritativo de ' +
      '22 clases objetivo (la única proyección de 22 clases hallada, docs/AGT002_COMPANY_EVIDENCE_MANIFEST_V031.md, ' +
      'es la dirección opuesta: 22 documentales → 17 técnicas) — debe suministrarse explícitamente, nunca inventarse.',
    );
    return null;
  }
  pushMissing(blockers, typeof targetManifest.version === 'string' && targetManifest.version.trim(), 'targetManifest.version debe ser texto no vacío.');
  const ids = [];
  targetManifest.classes.forEach((cls, index) => {
    if (!isPlainObject(cls) || typeof cls.id !== 'string' || !cls.id.trim()) {
      blockers.push(`targetManifest.classes[${index}].id debe ser texto no vacío.`);
      return;
    }
    if (typeof cls.label !== 'string' || !cls.label.trim()) blockers.push(`targetManifest.classes[${index}] (${cls.id}).label debe ser texto no vacío.`);
    if (typeof cls.sensitivity !== 'string' || !cls.sensitivity.trim()) blockers.push(`targetManifest.classes[${index}] (${cls.id}).sensitivity debe ser texto no vacío.`);
    ids.push(cls.id);
  });
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) blockers.push('targetManifest.classes tiene id(s) duplicados.');
  if (ids.length !== AGT002_RECLASS_17_TO_22_TARGET_CLASS_COUNT || uniqueIds.size !== AGT002_RECLASS_17_TO_22_TARGET_CLASS_COUNT) {
    blockers.push(`targetManifest.classes debe declarar exactamente ${AGT002_RECLASS_17_TO_22_TARGET_CLASS_COUNT} clases únicas (encontradas: ${uniqueIds.size}).`);
  }
  return ids.length ? [...uniqueIds] : null;
}

function validateMappingRules(mappingRules, declaredSplitSourceIds, targetIds, blockers) {
  if (!Array.isArray(mappingRules) || !mappingRules.length) {
    blockers.push('mappingRules ausente: no existe en este repositorio una regla de mapeo 17→22 con merges/splits explícitos — debe suministrarse explícitamente.');
    return;
  }
  const declaredSplits = new Set(Array.isArray(declaredSplitSourceIds) ? declaredSplitSourceIds : []);
  if (!Array.isArray(declaredSplitSourceIds)) {
    blockers.push('declaredSplitSourceIds debe ser una lista (puede ser vacía) de entry_id fuente declarados explícitamente como split.');
  } else {
    declaredSplitSourceIds.forEach((sourceId, index) => {
      if (!AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS.includes(sourceId)) {
        blockers.push(`declaredSplitSourceIds[${index}] (${String(sourceId)}) fuera del catálogo cerrado de 17 clases fuente.`);
      }
    });
  }

  const targetIdSet = new Set(targetIds || []);
  const seenTargetIds = new Set();
  const sourceOccurrences = new Map();

  mappingRules.forEach((rule, index) => {
    if (!isPlainObject(rule) || typeof rule.targetClassId !== 'string' || !Array.isArray(rule.sourceClassIds) || !rule.sourceClassIds.length) {
      blockers.push(`mappingRules[${index}] debe tener targetClassId (string) y sourceClassIds (lista no vacía).`);
      return;
    }
    if (targetIdSet.size && !targetIdSet.has(rule.targetClassId)) {
      blockers.push(`mappingRules[${index}].targetClassId (${rule.targetClassId}) no está en targetManifest.`);
    }
    if (seenTargetIds.has(rule.targetClassId)) blockers.push(`mappingRules: targetClassId duplicado (${rule.targetClassId}).`);
    seenTargetIds.add(rule.targetClassId);

    const expectedKind = rule.sourceClassIds.length > 1 ? 'merge' : 'one_to_one';
    if (rule.kind !== expectedKind) {
      blockers.push(`mappingRules[${index}] (${rule.targetClassId}): kind debe declararse explícitamente como '${expectedKind}' (encontrado: ${String(rule.kind)}).`);
    }
    for (const sourceId of rule.sourceClassIds) {
      if (!AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS.includes(sourceId)) {
        blockers.push(`mappingRules[${index}]: sourceClassIds contiene un id fuera del catálogo cerrado de 17 clases: ${sourceId}.`);
        continue;
      }
      sourceOccurrences.set(sourceId, (sourceOccurrences.get(sourceId) || 0) + 1);
    }
  });

  if (targetIdSet.size) {
    for (const targetId of targetIdSet) {
      if (!seenTargetIds.has(targetId)) blockers.push(`mappingRules: falta una regla para targetClassId ${targetId}.`);
    }
  }
  for (const sourceId of AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS) {
    if (!sourceOccurrences.has(sourceId)) blockers.push(`mappingRules: la clase fuente ${sourceId} no quedó mapeada a ninguna clase objetivo (toda fuente debe mapearse).`);
  }
  for (const [sourceId, count] of sourceOccurrences.entries()) {
    if (count > 1 && !declaredSplits.has(sourceId)) {
      blockers.push(`mappingRules: la clase fuente ${sourceId} se mapea a ${count} clases objetivo (split) pero no está declarada en declaredSplitSourceIds.`);
    }
    if (count === 1 && declaredSplits.has(sourceId)) {
      blockers.push(`declaredSplitSourceIds incluye ${sourceId} pero esa fuente sólo se mapea a una clase objetivo (no es un split real).`);
    }
  }
}

function validateArchivedEntries(archivedEntries, blockers) {
  if (!Array.isArray(archivedEntries) || !archivedEntries.length) {
    blockers.push('archivedEntries ausente: se requiere un registro archive-not-delete explícito de las 17 filas fuente antes de reclasificar.');
    return new Map();
  }
  const byEntryId = new Map();
  archivedEntries.forEach((entryRecord, index) => {
    if (!isPlainObject(entryRecord)) {
      blockers.push(`archivedEntries[${index}] debe ser un objeto.`);
      return;
    }
    if (Object.hasOwn(entryRecord, 'deleted')) {
      blockers.push(`archivedEntries[${index}] (${entryRecord.entryId}) declara una clave 'deleted' — prohibido: archive-not-delete no admite ningún indicador de borrado.`);
    }
    if (!AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS.includes(entryRecord.entryId)) {
      blockers.push(`archivedEntries[${index}].entryId fuera del catálogo cerrado de 17 clases: ${entryRecord.entryId}.`);
      return;
    }
    if (entryRecord.archived !== true) blockers.push(`archivedEntries[${index}] (${entryRecord.entryId}).archived debe ser exactamente true.`);
    if (!Number.isInteger(entryRecord.version) || entryRecord.version < 1) blockers.push(`archivedEntries[${index}] (${entryRecord.entryId}).version debe ser un entero >= 1.`);
    if (typeof entryRecord.archivedAt !== 'string' || Number.isNaN(new Date(entryRecord.archivedAt).getTime())) {
      blockers.push(`archivedEntries[${index}] (${entryRecord.entryId}).archivedAt debe ser una fecha ISO válida.`);
    }
    byEntryId.set(entryRecord.entryId, entryRecord);
  });
  for (const sourceId of AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS) {
    if (!byEntryId.has(sourceId)) blockers.push(`archivedEntries: falta el archivo (archive-not-delete) de la fila fuente ${sourceId}.`);
  }
  return byEntryId;
}

function validateGovernanceAcknowledgements(governanceAcknowledgements, blockers) {
  if (!isPlainObject(governanceAcknowledgements)) {
    blockers.push(
      'governanceAcknowledgements ausente: se requieren dos reconocimientos explícitos antes de sincronizar sensitivity/SharePoint — ' +
      'ver agt002-company-evidence-classes.js (AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS excluye "sensibilidad") y ' +
      'agt002-company-evidence-sharepoint-catalog.js (prohíbe estructuralmente item id/eTag crudos).',
    );
    return;
  }
  pushMissing(
    blockers,
    typeof governanceAcknowledgements.sensitivityFieldSourceDeclaration === 'string' && governanceAcknowledgements.sensitivityFieldSourceDeclaration.trim(),
    'governanceAcknowledgements.sensitivityFieldSourceDeclaration debe declarar de dónde proviene "sensitivity", dado que el allowlist de mínima exposición del registro de 17 clases lo excluye.',
  );
  pushMissing(
    blockers,
    governanceAcknowledgements.sharePointOpaqueRefsOnlyConfirmed === true,
    'governanceAcknowledgements.sharePointOpaqueRefsOnlyConfirmed debe ser true: ningún item id/eTag crudo de SharePoint puede sincronizarse, sólo referencias opacas.',
  );
}

function validateTargetEntries(targetEntries, targetIds, mappingRules, archivedById, approvalRecord, blockers) {
  if (!Array.isArray(targetEntries) || !targetEntries.length) {
    blockers.push('targetEntries ausente: se requieren las 22 entradas objetivo con sus cinco estados semánticos independientes, puntero de versión histórica y referencia opaca.');
    return [];
  }
  const targetIdSet = new Set(targetIds || []);
  const sourcesByTarget = new Map((mappingRules || []).filter(r => isPlainObject(r)).map(r => [r.targetClassId, r.sourceClassIds || []]));
  const approvalScope = new Set(isPlainObject(approvalRecord) && Array.isArray(approvalRecord.scope) ? approvalRecord.scope : []);
  const seen = new Set();
  const built = [];

  targetEntries.forEach((entryRecord, index) => {
    if (!isPlainObject(entryRecord)) {
      blockers.push(`targetEntries[${index}] debe ser un objeto.`);
      return;
    }
    const label = entryRecord.entryId || `#${index}`;
    if (targetIdSet.size && !targetIdSet.has(entryRecord.entryId)) blockers.push(`targetEntries[${index}].entryId (${label}) no está en targetManifest.`);
    if (seen.has(entryRecord.entryId)) blockers.push(`targetEntries: entryId duplicado (${label}).`);
    seen.add(entryRecord.entryId);

    pushMissing(blockers, typeof entryRecord.classDefinitionVersion === 'string' && entryRecord.classDefinitionVersion.trim(), `targetEntries (${label}).classDefinitionVersion debe ser texto no vacío.`);
    pushMissing(blockers, typeof entryRecord.sensitivity === 'string' && entryRecord.sensitivity.trim(), `targetEntries (${label}).sensitivity debe ser texto no vacío.`);
    pushMissing(blockers, typeof entryRecord.evidenceRef === 'string' && OPAQUE_REF_PATTERN.test(entryRecord.evidenceRef), `targetEntries (${label}).evidenceRef debe ser una referencia opaca (sha256 o 'opaque:<id>'), nunca ruta/URL/contenido crudo.`);
    pushMissing(blockers, typeof entryRecord.sharePointSyncRef === 'string' && OPAQUE_REF_PATTERN.test(entryRecord.sharePointSyncRef), `targetEntries (${label}).sharePointSyncRef debe ser una referencia opaca derivada, nunca un item id/eTag crudo de SharePoint.`);

    for (const key of AGT002_RECLASS_17_TO_22_SEMANTIC_STATE_KEYS) {
      if (typeof entryRecord[key] !== 'boolean') blockers.push(`targetEntries (${label}).${key} debe ser booleano (estado semántico independiente).`);
    }

    const temporal = entryRecord.temporalApplicability ?? 'prospective';
    if (!AGT002_RECLASS_17_TO_22_TEMPORAL_APPLICABILITY.includes(temporal)) {
      blockers.push(`targetEntries (${label}).temporalApplicability debe ser uno de: ${AGT002_RECLASS_17_TO_22_TEMPORAL_APPLICABILITY.join(', ')}.`);
    }
    if (temporal === 'historical') {
      if (entryRecord.reversible !== true) blockers.push(`targetEntries (${label}): reclasificación histórica requiere reversible === true (gobernada y reversible).`);
      if (!isPlainObject(entryRecord.governedReclassificationApproval)) {
        blockers.push(`targetEntries (${label}): reclasificación histórica requiere governedReclassificationApproval explícito.`);
      } else if (!approvalScope.size || !approvalScope.has(entryRecord.governedReclassificationApproval.scopeRef)) {
        blockers.push(`targetEntries (${label}): governedReclassificationApproval.scopeRef debe estar dentro de approvalRecord.scope.`);
      }
    }

    const pointers = Array.isArray(entryRecord.previousVersionPointer) ? entryRecord.previousVersionPointer : [entryRecord.previousVersionPointer];
    const expectedSources = sourcesByTarget.get(entryRecord.entryId) || [];
    if (!pointers.length || pointers.some(pointer => !isPlainObject(pointer) || typeof pointer.entryId !== 'string')) {
      blockers.push(`targetEntries (${label}).previousVersionPointer debe apuntar a al menos una fila fuente archivada.`);
    } else {
      const pointerIds = pointers.map(pointer => pointer.entryId);
      for (const pointerId of pointerIds) {
        if (!archivedById.has(pointerId)) blockers.push(`targetEntries (${label}): previousVersionPointer referencia ${pointerId}, que no está en archivedEntries.`);
      }
      // The lineage must equal — exactly, no omission/extras/duplicates — the source set
      // mappingRules declares for this target, not merely a subset or superset of it.
      if (expectedSources.length) {
        const expectedSet = new Set(expectedSources);
        const pointerCounts = new Map();
        for (const pointerId of pointerIds) pointerCounts.set(pointerId, (pointerCounts.get(pointerId) || 0) + 1);

        for (const pointerId of pointerIds) {
          if (!expectedSet.has(pointerId)) {
            blockers.push(`targetEntries (${label}): previousVersionPointer referencia ${pointerId}, que no es fuente de ${label} según mappingRules.`);
          }
        }
        for (const expectedId of expectedSources) {
          if (!pointerCounts.has(expectedId)) {
            blockers.push(`targetEntries (${label}): previousVersionPointer no incluye la fuente ${expectedId} que mappingRules declara para ${label} (lineage incompleto).`);
          }
        }
        for (const [pointerId, count] of pointerCounts.entries()) {
          if (count > 1) {
            blockers.push(`targetEntries (${label}): previousVersionPointer referencia ${pointerId} más de una vez (duplicado).`);
          }
        }
      }
    }

    built.push({ entryId: entryRecord.entryId, temporalApplicability: temporal });
  });

  if (targetIdSet.size) {
    for (const targetId of targetIdSet) {
      if (!seen.has(targetId)) blockers.push(`targetEntries: falta la entrada objetivo ${targetId}.`);
    }
  }
  return built;
}

/**
 * Validates a repositoryInputs bundle and returns the full list of blockers (empty when
 * everything required is present and internally consistent). Never throws on missing
 * sections — missing input is reported as a blocker, not an exception, so a dry-run report
 * can list every gap at once instead of stopping at the first one.
 */
export function validateAgt002Reclass17To22RepositoryInputs(repositoryInputs) {
  const blockers = [];
  const input = isPlainObject(repositoryInputs) ? repositoryInputs : {};

  const forbiddenIssues = findForbiddenRawRefIssues(input);
  if (forbiddenIssues.length) {
    blockers.push(`Entrada completa: claves/valores crudos prohibidos (referencia cruda o PII) presentes en: ${forbiddenIssues.join(', ')}.`);
  }

  const targetIds = validateTargetManifest(input.targetManifest, blockers);
  validateMappingRules(input.mappingRules, input.declaredSplitSourceIds, targetIds, blockers);
  const archivedById = validateArchivedEntries(input.archivedEntries, blockers);
  validateApprovalRecord(input.approvalRecord, blockers);
  validateApprovalBinding(input.approvalRecord, input.targetManifest, input.mappingRules, blockers);
  validateGovernanceAcknowledgements(input.governanceAcknowledgements, blockers);
  validateTargetEntries(input.targetEntries, targetIds, input.mappingRules, archivedById, input.approvalRecord, blockers);

  return blockers;
}

/**
 * Pure dry-run report: validates repositoryInputs and, only when there are zero blockers,
 * computes a stable hash and a summary (merges/splits/one-to-one, archived source ids,
 * revalidation queue). Never reconciles with any live system — this is a static
 * computation over exactly the input it is given.
 */
export function buildAgt002Reclass17To22DryRunReport(repositoryInputs = {}) {
  const blockers = validateAgt002Reclass17To22RepositoryInputs(repositoryInputs);
  const ready = blockers.length === 0;

  const report = {
    ready,
    blockers: Object.freeze([...blockers]),
    reconciliation_claim: false,
    disclaimer:
      'Reporte estático y puro sobre exactamente el input suministrado. No reconcilia con ' +
      'ninguna base de datos, SharePoint u otro sistema en vivo; no aplica ni escribe nada.',
  };

  if (!ready) return Object.freeze(report);

  const input = repositoryInputs;
  const merges = input.mappingRules.filter(rule => rule.sourceClassIds.length > 1).map(rule => rule.targetClassId).sort();
  const oneToOne = input.mappingRules.filter(rule => rule.sourceClassIds.length === 1).map(rule => rule.targetClassId).sort();
  const splits = [...new Set(input.declaredSplitSourceIds || [])].sort();
  const revalidationQueue = input.targetEntries
    .filter(entryRecord => AGT002_RECLASS_17_TO_22_SEMANTIC_STATE_KEYS.some(key => entryRecord[key] !== true))
    .map(entryRecord => entryRecord.entryId)
    .sort();

  report.sourceClassIds = [...AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS];
  report.targetClassIds = input.targetManifest.classes.map(cls => cls.id).sort();
  report.merges = merges;
  report.splits = splits;
  report.oneToOne = oneToOne;
  report.archived = input.archivedEntries.map(entryRecord => entryRecord.entryId).sort();
  report.revalidationQueue = revalidationQueue;
  report.hash = computeAgt002Reclass17To22Hash(input);

  return Object.freeze(report);
}

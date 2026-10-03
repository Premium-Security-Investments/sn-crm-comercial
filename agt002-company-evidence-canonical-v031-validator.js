// F2 preproduction slice: a PURE, fail-closed validator for the already-approved canonical
// 22-class artifact Base_Maestra_Normalizada_v0.3.1.json. This module never reads a
// database, SharePoint, the filesystem, or the network, and never makes an HTTP call — it
// only validates an `{ artifact, observedFileSha256 }` envelope supplied by the caller. It
// does not read the real source file itself; the expected identity constants below are
// exactly the values the caller told us to check against, nothing more.
//
// This is a catalogue validator only. A `valid: true` result means the supplied artifact
// matches the approved canonical shape/identity — it is NOT reconciliation readiness, NOT a
// migration authorization, and NOT a go/submission/helpdesk authorization. Those claims are
// hardcoded to false/false/false/false in the report and are never derived from entry
// content, exactly as required: no operational field may be inferred from evidence or
// proposed state.
//
// Out of scope by design (do not add here): database access, migrations, server/API wiring,
// package.json, docs, Radar/tender-fit-v1, DANE, AGT-003, production, or any external
// system. No copied canonical Base Master fixture lives in this file or its tests.

import { createHash } from 'node:crypto';

export const AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256 =
  'c1729b15bc8af95a5104aecc36476bb5c6fe6f420ab2e736ad43149eae52a776';

export const AGT002_CANONICAL_V031_EXPECTED_VERSION = 'v0.3.1-normalized-proposal-20260829';

export const AGT002_CANONICAL_V031_EXPECTED_STATUS = 'APPROVED_CANONICAL_CONDITIONAL';

export const AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY = 'Juan Botero';

export const AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC = '2026-08-29T18:01:03Z';

export const AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE = 'semantic_strict_or_abstain';

// These five counts are TOP-LEVEL numeric fields on the artifact itself — there is no
// nested `counts` object in the real approved canonical shape.
export const AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS = Object.freeze({
  previous_active_candidates: 17,
  carried_forward: 13,
  normalized_new_classes: 9,
  proposed_classes: 22,
  retained_classes_after_technical_normalization: 0,
});

export const AGT002_CANONICAL_V031_EXPECTED_APPROVAL_SCOPE = Object.freeze({
  canonical_catalog: true,
  authorizes_agt002_run: false,
  authorizes_go: false,
  authorizes_helpdesk: false,
  authorizes_submission: false,
});

// Operational authority keys that must be exactly `false` inside approval_scope — never
// true, regardless of any other field on the artifact.
const AGT002_CANONICAL_V031_APPROVAL_SCOPE_OPERATIONAL_KEYS = Object.freeze([
  'authorizes_agt002_run',
  'authorizes_go',
  'authorizes_helpdesk',
  'authorizes_submission',
]);

// Each transformation entry uses the key `original` (NOT `original_id`) and must carry the
// exact approved resolution text for that original — these are the four approved
// original -> resolution pairs, nothing else is acceptable.
export const AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS = Object.freeze({
  communications_license:
    'split_into_5_classes_low_ocr_support_quarantined_third_party_registry_not_attributed_to_holder',
  financial_and_tax_pack:
    'split_9_members_tax_and_bank_corporate_process_annex_excluded_6_personal_vault',
  overtime_authorization:
    'deprecated_no_authorization_observed_commitment_archived_as_process_specific',
  corporate_background_checks: 'split_3_authority_classes_251_natural_to_vault',
});

export const AGT002_CANONICAL_V031_ENTRY_IDS = Object.freeze([
  'supervigilancia_operating_license',
  'rup',
  'rut',
  'uniforms_resolution',
  'no_fines_sanctions_certificate',
  'authorized_weapons_list',
  'rce_policy',
  'collective_life_policy',
  'accredited_experience',
  'bank_certificate',
  'legal_representative_vault',
  'personnel_credentials_vault',
  'differential_scoring_support',
  'radio_spectrum_permit',
  'radio_network_technical_profile',
  'rutic_registration',
  'telecom_service_contract',
  'telecom_commercial_reference',
  'corporate_tax_return',
  'corporate_disciplinary_certificate',
  'corporate_fiscal_certificate',
  'corporate_corrective_measures_rnmc_certificate',
]);

// The only three entries allowed an empty evidence_sha256 — segregated vault classes whose
// evidence is deliberately not hashed inline in this catalogue artifact.
export const AGT002_CANONICAL_V031_VAULT_ENTRY_IDS = Object.freeze([
  'legal_representative_vault',
  'personnel_credentials_vault',
  'differential_scoring_support',
]);

export const AGT002_CANONICAL_V031_REQUIRED_ENTRY_STRING_FIELDS = Object.freeze([
  'document_class',
  'change_action',
  'proposed_state',
  'evidence_state',
  'validity',
  'sensitivity',
  'source_segments_or_count',
  'applicability',
  'match_policy',
  'human_gate',
  'notes',
]);

// `supersedes` is a single exact version-proposal string, NOT an array.
export const AGT002_CANONICAL_V031_EXPECTED_SUPERSEDES = 'v0.3-normalized-proposal-20260829';

export const AGT002_CANONICAL_V031_SUPERSEDED_VERSIONS = Object.freeze(['v0.2', 'v0.3']);

export const AGT002_CANONICAL_V031_EXPECTED_APPROVAL_EVIDENCE =
  'Explicit user statement: Apruebo base maestra v0.3.1';

export const AGT002_CANONICAL_V031_EXPECTED_RESIDUAL_NON_CLASS_ITEMS = Object.freeze({
  communications_low_ocr_support_segment_quarantined: 1,
  third_party_rutic_context_not_attributed_to_holder: 1,
  actual_ministry_overtime_authorization_evidence: 'not_observed',
});

// Raw-reference/PII-bearing key names forbidden anywhere in the artifact tree, regardless of
// depth. Deliberately does NOT include ordinary governance text keys such as `approved_by`
// or `notes` — those are legitimate required fields, not raw references.
export const AGT002_CANONICAL_V031_FORBIDDEN_KEYS = Object.freeze([
  'item_id', 'itemId', 'etag', 'eTag', 'path', 'url', 'signed_url', 'signedUrl',
  'content', 'secret', 'password', 'token', 'cedula', 'email', 'phone',
  'address', 'account_number', 'accountNumber',
]);

const FORBIDDEN_KEY_SET = new Set(AGT002_CANONICAL_V031_FORBIDDEN_KEYS);
const HASH_PATTERN = /^[0-9a-f]{64}$/;

// The exact 17 approved top-level keys on the artifact — no fewer, no more. Built from the
// same identity constants checked elsewhere in this module rather than typed out twice.
const AGT002_CANONICAL_V031_TOP_LEVEL_ARTIFACT_KEYS = Object.freeze([
  'version',
  'status',
  'approved_by',
  'approved_at_utc',
  'matching_rule',
  ...Object.keys(AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS),
  'approval_scope',
  'transformations',
  'entries',
  'supersedes',
  'superseded_versions',
  'approval_evidence',
  'residual_non_class_items',
]);

const AGT002_CANONICAL_V031_TRANSFORMATION_KEYS = Object.freeze([
  'original',
  'resolution',
  'technical_hold_resolved',
]);

const AGT002_CANONICAL_V031_ENTRY_KEYS = Object.freeze([
  'entry_id',
  ...AGT002_CANONICAL_V031_REQUIRED_ENTRY_STRING_FIELDS,
  'evidence_sha256',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Strict predicate used only by the canonical JSON/hash/byte-length helpers below: true only
 * for genuine object-literal / JSON.parse-shaped plain objects (prototype is exactly
 * Object.prototype). Deliberately excludes Date, RegExp, Map, Set, Buffer, Uint8Array,
 * arbitrary class instances, and null-prototype records — none of those carry meaning as an
 * ordinary JSON object and none may be silently collapsed or reinterpreted.
 */
function isCanonicalPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function pushIf(blockers, condition, message) {
  if (!condition) blockers.push(message);
}

/**
 * Recursively collects every path at which a forbidden raw-reference/PII key name appears,
 * anywhere in the tree (objects and arrays, any depth). Guards against circular references
 * with a visited set so a pathological self-referential artifact can never cause a stack
 * overflow — this function must never throw.
 */
function collectForbiddenKeyPaths(value, path, visited, found) {
  if (Array.isArray(value)) {
    if (visited.has(value)) return;
    visited.add(value);
    value.forEach((item, index) => collectForbiddenKeyPaths(item, `${path}[${index}]`, visited, found));
    return;
  }
  if (isPlainObject(value)) {
    if (visited.has(value)) return;
    visited.add(value);
    for (const key of Object.keys(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEY_SET.has(key)) found.push(nextPath);
      collectForbiddenKeyPaths(value[key], nextPath, visited, found);
    }
  }
}

function validateExactKeySet(value, expectedKeys, labelSpanish, blockers) {
  if (!isPlainObject(value)) {
    blockers.push(`${labelSpanish} debe ser un objeto plano.`);
    return;
  }
  const expected = new Set(expectedKeys);
  const actual = Object.keys(value);
  const missing = expectedKeys.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !expected.has(key));
  missing.forEach((key) => blockers.push(`${labelSpanish} carece de la clave requerida "${key}".`));
  extra.forEach((key) => blockers.push(`${labelSpanish} contiene una clave no permitida "${key}".`));
}

function validateApprovalScope(approvalScope, blockers) {
  validateExactKeySet(
    approvalScope,
    Object.keys(AGT002_CANONICAL_V031_EXPECTED_APPROVAL_SCOPE),
    'approval_scope',
    blockers,
  );
  if (!isPlainObject(approvalScope)) return;

  if (approvalScope.canonical_catalog !== true) {
    blockers.push('approval_scope.canonical_catalog debe ser exactamente true.');
  }
  for (const key of AGT002_CANONICAL_V031_APPROVAL_SCOPE_OPERATIONAL_KEYS) {
    if (approvalScope[key] !== false) {
      blockers.push(
        `approval_scope.${key} debe ser exactamente false — el catálogo aprobado no otorga ` +
        'autoridad operativa alguna.',
      );
    }
  }
}

/**
 * The five approved counts live directly on the artifact (top-level numeric fields), not
 * nested under a `counts` object. An artifact that nests them under `counts` instead simply
 * fails these top-level checks as missing.
 */
function validateTopLevelCounts(artifact, blockers) {
  for (const [key, expectedValue] of Object.entries(AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS)) {
    if (artifact[key] !== expectedValue) {
      blockers.push(
        `artifact.${key} debe ser exactamente ${expectedValue} (declarado: ${JSON.stringify(artifact[key])}).`,
      );
    }
  }
}

function validateTransformations(transformations, blockers) {
  if (!Array.isArray(transformations)) {
    blockers.push('transformations debe ser una lista.');
    return;
  }

  const expectedOriginals = Object.keys(AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS);
  const seenOriginals = [];
  transformations.forEach((transformation, index) => {
    if (!isPlainObject(transformation)) {
      blockers.push(`transformations[${index}] debe ser un objeto plano.`);
      return;
    }
    validateExactKeySet(
      transformation,
      AGT002_CANONICAL_V031_TRANSFORMATION_KEYS,
      `transformations[${index}]`,
      blockers,
    );
    const original = transformation.original;
    pushIf(
      blockers,
      isNonEmptyString(transformation.resolution),
      `transformations[${index}].resolution debe ser texto no vacío.`,
    );
    if (typeof original === 'string' && expectedOriginals.includes(original)) {
      seenOriginals.push(original);
      const expectedResolution = AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS[original];
      if (transformation.resolution !== expectedResolution) {
        blockers.push(
          `transformations[${index}].resolution debe ser exactamente "${expectedResolution}" ` +
          `para original "${original}" (declarado: ${JSON.stringify(transformation.resolution)}).`,
        );
      }
    } else {
      blockers.push(
        `transformations[${index}].original debe ser exactamente uno de: ` +
        `${expectedOriginals.join(', ')} (declarado: ${JSON.stringify(original)}).`,
      );
    }
    pushIf(
      blockers,
      transformation.technical_hold_resolved === true,
      `transformations[${index}].technical_hold_resolved debe ser exactamente true.`,
    );
  });

  expectedOriginals.forEach((expectedOriginal) => {
    if (!seenOriginals.includes(expectedOriginal)) {
      blockers.push(`transformations no incluye la transformación requerida "${expectedOriginal}".`);
    }
  });

  const idCounts = new Map();
  seenOriginals.forEach((id) => idCounts.set(id, (idCounts.get(id) || 0) + 1));
  for (const [id, count] of idCounts.entries()) {
    if (count > 1) {
      blockers.push(`transformations contiene "${id}" duplicado (${count} veces) — se requiere exactamente una vez.`);
    }
  }
}

function validateEntry(entry, index, blockers) {
  if (!isPlainObject(entry)) {
    blockers.push(`entries[${index}] debe ser un objeto plano.`);
    return;
  }
  validateExactKeySet(entry, AGT002_CANONICAL_V031_ENTRY_KEYS, `entries[${index}]`, blockers);

  const entryId = isNonEmptyString(entry.entry_id) ? entry.entry_id : null;
  const label = entryId ? `entries[${index}] (${entryId})` : `entries[${index}]`;

  if (entryId === null) {
    blockers.push(`entries[${index}].entry_id debe ser un string no vacío.`);
  }

  AGT002_CANONICAL_V031_REQUIRED_ENTRY_STRING_FIELDS.forEach((field) => {
    pushIf(blockers, isNonEmptyString(entry[field]), `${label}.${field} debe ser texto no vacío.`);
  });

  const isVaultEntry = entryId !== null && AGT002_CANONICAL_V031_VAULT_ENTRY_IDS.includes(entryId);
  const evidenceSha256 = entry.evidence_sha256;
  const isValidHash = typeof evidenceSha256 === 'string' && HASH_PATTERN.test(evidenceSha256);
  const isAllowedEmpty = isVaultEntry && evidenceSha256 === '';
  if (!isValidHash && !isAllowedEmpty) {
    if (isVaultEntry) {
      blockers.push(
        `${label}.evidence_sha256 debe ser un sha256 hexadecimal en minúsculas de 64 caracteres, o exactamente "" ` +
        '(permitido solo para esta clase bóveda segregada).',
      );
    } else {
      blockers.push(
        `${label}.evidence_sha256 debe ser un sha256 hexadecimal en minúsculas de 64 caracteres (no puede estar vacío ` +
        'fuera de las tres clases bóveda segregadas).',
      );
    }
  }
}

function validateEntries(entries, blockers) {
  if (!Array.isArray(entries)) {
    blockers.push('entries debe ser una lista.');
    return;
  }

  entries.forEach((entry, index) => validateEntry(entry, index, blockers));

  const actualIds = entries
    .map((entry) => (isPlainObject(entry) && isNonEmptyString(entry.entry_id) ? entry.entry_id : null))
    .filter((id) => id !== null);

  AGT002_CANONICAL_V031_ENTRY_IDS.forEach((expectedId) => {
    if (!actualIds.includes(expectedId)) {
      blockers.push(`entries no incluye el entry_id requerido "${expectedId}".`);
    }
  });

  const expectedSet = new Set(AGT002_CANONICAL_V031_ENTRY_IDS);
  const extraIds = [];
  actualIds.forEach((id) => {
    if (!expectedSet.has(id) && !extraIds.includes(id)) extraIds.push(id);
  });
  extraIds.forEach((id) => blockers.push(`entries contiene un entry_id no aprobado "${id}".`));

  const idCounts = new Map();
  actualIds.forEach((id) => idCounts.set(id, (idCounts.get(id) || 0) + 1));
  for (const [id, count] of idCounts.entries()) {
    if (count > 1) {
      blockers.push(`entries contiene "${id}" duplicado (${count} veces) — se requiere exactamente uno.`);
    }
  }
}

/**
 * `supersedes` is a single exact version-proposal string (not an array). `superseded_versions`
 * is a list that must contain exactly v0.2 and v0.3, each once.
 */
function validateSupersession(artifact, blockers) {
  const supersedes = artifact.supersedes;
  if (supersedes !== AGT002_CANONICAL_V031_EXPECTED_SUPERSEDES) {
    blockers.push(
      `supersedes debe ser exactamente "${AGT002_CANONICAL_V031_EXPECTED_SUPERSEDES}" ` +
      `(declarado: ${JSON.stringify(supersedes)}).`,
    );
  }

  const expectedSet = new Set(AGT002_CANONICAL_V031_SUPERSEDED_VERSIONS);
  const supersededVersions = artifact.superseded_versions;
  if (
    !Array.isArray(supersededVersions) ||
    !supersededVersions.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    blockers.push('superseded_versions debe ser una lista de strings no vacíos.');
    return;
  }
  const missing = AGT002_CANONICAL_V031_SUPERSEDED_VERSIONS.filter((v) => !supersededVersions.includes(v));
  const extra = supersededVersions.filter((v) => !expectedSet.has(v));
  const duplicates = supersededVersions.filter((v, i) => supersededVersions.indexOf(v) !== i);
  missing.forEach((v) => blockers.push(`superseded_versions carece de la versión reemplazada requerida "${v}".`));
  [...new Set(extra)].forEach((v) => blockers.push(`superseded_versions contiene una versión no reconocida "${v}".`));
  [...new Set(duplicates)].forEach((v) => blockers.push(`superseded_versions contiene "${v}" duplicado.`));
}

function validateApprovalEvidence(artifact, blockers) {
  if (artifact.approval_evidence !== AGT002_CANONICAL_V031_EXPECTED_APPROVAL_EVIDENCE) {
    blockers.push(
      `approval_evidence debe ser exactamente "${AGT002_CANONICAL_V031_EXPECTED_APPROVAL_EVIDENCE}" ` +
      `(declarado: ${JSON.stringify(artifact.approval_evidence)}).`,
    );
  }
}

function validateResidualNonClassItems(residual, blockers) {
  validateExactKeySet(
    residual,
    Object.keys(AGT002_CANONICAL_V031_EXPECTED_RESIDUAL_NON_CLASS_ITEMS),
    'residual_non_class_items',
    blockers,
  );
  if (!isPlainObject(residual)) return;
  for (const [key, expectedValue] of Object.entries(AGT002_CANONICAL_V031_EXPECTED_RESIDUAL_NON_CLASS_ITEMS)) {
    if (residual[key] !== expectedValue) {
      blockers.push(
        `residual_non_class_items.${key} debe ser exactamente ${JSON.stringify(expectedValue)} ` +
        `(declarado: ${JSON.stringify(residual[key])}).`,
      );
    }
  }
}

/**
 * Recursively rebuilds `value` with every plain-object's keys sorted lexicographically at
 * every depth, while preserving array element order. `ancestors` guards against circular
 * references so a pathological self-referential input throws a clear error instead of
 * overflowing the stack.
 */
function canonicalizeValue(value, ancestors) {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('Circular reference detected in canonical payload.');
    ancestors.add(value);
    const result = value.map((item) => canonicalizeValue(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (value !== null && typeof value === 'object') {
    if (!isCanonicalPlainObject(value)) {
      throw new Error(
        'Unsupported value in canonical payload: only Object.prototype plain objects, arrays, and JSON ' +
        'primitives are canonicalizable (Date, RegExp, Map, Set, Buffer, Uint8Array, class instances, and ' +
        'null-prototype objects are rejected, not silently collapsed or reinterpreted).',
      );
    }
    if (ancestors.has(value)) throw new Error('Circular reference detected in canonical payload.');
    ancestors.add(value);
    // A null-prototype accumulator avoids the Object.prototype `__proto__` accessor: assigning
    // through a literal `{}` to a key named "__proto__" would mutate the result's prototype
    // instead of creating a genuine own property, silently dropping the key from the output.
    const result = Object.create(null);
    Object.keys(value).sort().forEach((key) => {
      result[key] = canonicalizeValue(value[key], ancestors);
    });
    ancestors.delete(value);
    return result;
  }
  return value;
}

/**
 * Generic, artifact-agnostic canonical JSON (UTF-8) serialization: plain-object keys are
 * sorted recursively at every depth, array order is preserved, and there is no whitespace.
 * Deterministic for any two structurally-equivalent inputs regardless of original key order.
 */
export function toCanonicalJsonString(value) {
  return JSON.stringify(canonicalizeValue(value, new Set()));
}

/** Lowercase 64-char hex SHA-256 digest of the UTF-8 bytes of toCanonicalJsonString(value). */
export function computeCanonicalPayloadSha256Hex(value) {
  return createHash('sha256').update(Buffer.from(toCanonicalJsonString(value), 'utf8')).digest('hex');
}

/** UTF-8 byte length of toCanonicalJsonString(value). */
export function computeCanonicalPayloadByteLength(value) {
  return Buffer.byteLength(toCanonicalJsonString(value), 'utf8');
}

/** Never throws: returns { sha256, bytes } for a canonicalizable value, or null otherwise. */
function safeComputeCanonicalPayload(value) {
  try {
    return {
      sha256: computeCanonicalPayloadSha256Hex(value),
      bytes: computeCanonicalPayloadByteLength(value),
    };
  } catch {
    return null;
  }
}

/**
 * If the caller supplied an optional canonicalPayloadSha256 and/or canonicalPayloadBytes on
 * the envelope, both are recomputed from envelope.artifact and any mismatch fails closed
 * (pushes a blocker). Fields the caller did not supply are left unchecked.
 */
function validateCanonicalPayloadBinding(envelope, artifact, blockers) {
  const suppliedSha256 = envelope.canonicalPayloadSha256;
  const suppliedBytes = envelope.canonicalPayloadBytes;
  if (suppliedSha256 === undefined && suppliedBytes === undefined) return;

  const recomputed = safeComputeCanonicalPayload(artifact);

  if (suppliedSha256 !== undefined && (!recomputed || suppliedSha256 !== recomputed.sha256)) {
    blockers.push(
      `canonicalPayloadSha256 no coincide con el sha256 canónico recalculado a partir de artifact ` +
      `(esperado: ${JSON.stringify(recomputed ? recomputed.sha256 : null)}, observado: ${JSON.stringify(suppliedSha256)}).`,
    );
  }
  if (suppliedBytes !== undefined && (!recomputed || suppliedBytes !== recomputed.bytes)) {
    blockers.push(
      `canonicalPayloadBytes no coincide con el byte length canónico recalculado a partir de artifact ` +
      `(esperado: ${JSON.stringify(recomputed ? recomputed.bytes : null)}, observado: ${JSON.stringify(suppliedBytes)}).`,
    );
  }
}

/**
 * Validates an `{ artifact, observedFileSha256 }` envelope against the already-approved
 * canonical identity/shape constants above. Gathers every blocker it can rather than
 * stopping at the first — and never throws, regardless of how malformed the caller's input
 * is (wrong types, circular references, missing/extra fields, anything).
 *
 * Returns a frozen array of Spanish blocker strings. An empty array means the artifact
 * matches the approved canonical shape — it does NOT mean reconciliation, migration, or any
 * operational authorization; see buildAgt002CanonicalV031ValidationReport for those explicit
 * false flags.
 */
export function validateAgt002CanonicalV031Envelope(envelope) {
  try {
    if (!isPlainObject(envelope)) {
      return Object.freeze(['El sobre (envelope) debe ser un objeto plano con { artifact, observedFileSha256 }.']);
    }

    const blockers = [];
    const { artifact, observedFileSha256 } = envelope;

    if (observedFileSha256 !== AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256) {
      blockers.push(
        `observedFileSha256 no coincide con el sha256 esperado del artefacto canónico ` +
        `(esperado: ${AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256}, observado: ${JSON.stringify(observedFileSha256)}).`,
      );
    }

    if (!isPlainObject(artifact)) {
      blockers.push('artifact debe ser un objeto plano.');
      return Object.freeze(blockers);
    }

    if (artifact.version !== AGT002_CANONICAL_V031_EXPECTED_VERSION) {
      blockers.push(
        `artifact.version debe ser exactamente "${AGT002_CANONICAL_V031_EXPECTED_VERSION}" ` +
        `(declarado: ${JSON.stringify(artifact.version)}).`,
      );
    }
    if (artifact.status !== AGT002_CANONICAL_V031_EXPECTED_STATUS) {
      blockers.push(
        `artifact.status debe ser exactamente "${AGT002_CANONICAL_V031_EXPECTED_STATUS}" ` +
        `(declarado: ${JSON.stringify(artifact.status)}).`,
      );
    }
    if (artifact.approved_by !== AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY) {
      blockers.push(
        `artifact.approved_by debe ser exactamente "${AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY}" ` +
        `(declarado: ${JSON.stringify(artifact.approved_by)}).`,
      );
    }
    if (artifact.approved_at_utc !== AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC) {
      blockers.push(
        `artifact.approved_at_utc debe ser exactamente "${AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC}" ` +
        `(declarado: ${JSON.stringify(artifact.approved_at_utc)}).`,
      );
    }
    if (artifact.matching_rule !== AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE) {
      blockers.push(
        `artifact.matching_rule debe ser exactamente "${AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE}" ` +
        `(declarado: ${JSON.stringify(artifact.matching_rule)}).`,
      );
    }

    validateExactKeySet(artifact, AGT002_CANONICAL_V031_TOP_LEVEL_ARTIFACT_KEYS, 'artifact', blockers);
    validateTopLevelCounts(artifact, blockers);
    validateApprovalScope(artifact.approval_scope, blockers);
    validateTransformations(artifact.transformations, blockers);
    validateEntries(artifact.entries, blockers);
    validateSupersession(artifact, blockers);
    validateApprovalEvidence(artifact, blockers);
    validateResidualNonClassItems(artifact.residual_non_class_items, blockers);

    const forbiddenPaths = [];
    collectForbiddenKeyPaths(artifact, '', new WeakSet(), forbiddenPaths);
    forbiddenPaths.forEach((path) => {
      blockers.push(
        `Clave prohibida detectada en la ruta "${path}": no se permiten referencias crudas ni datos ` +
        'personales en el artefacto canónico.',
      );
    });

    validateCanonicalPayloadBinding(envelope, artifact, blockers);

    return Object.freeze(blockers);
  } catch {
    return Object.freeze([
      'No fue posible validar el sobre suministrado: la entrada es inválida o está malformada de forma inesperada.',
    ]);
  }
}

function safeString(value) {
  return typeof value === 'string' ? value : null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

/**
 * Fail-closed report returned when reading the envelope/artifact throws unexpectedly (a Proxy
 * with a throwing get trap, or a plain object with a throwing accessor property somewhere on
 * the envelope). Never derived from partially-read data — every observed value is null and
 * every governance/operational authority flag is false, same as any other invalid report.
 */
function buildUnreadableEnvelopeReport() {
  const observed = Object.freeze({
    observed_file_sha256: null,
    version: null,
    status: null,
    approved_by: null,
    approved_at_utc: null,
    matching_rule: null,
  });

  const expected = Object.freeze({
    file_sha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256,
    version: AGT002_CANONICAL_V031_EXPECTED_VERSION,
    status: AGT002_CANONICAL_V031_EXPECTED_STATUS,
    approved_by: AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY,
    approved_at_utc: AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC,
    matching_rule: AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE,
  });

  return deepFreeze({
    valid: false,
    blockers: Object.freeze([
      'No fue posible construir el informe de validación: la lectura del sobre o del artefacto ' +
      'falló de forma inesperada (propiedad inaccesible).',
    ]),
    observed,
    expected,
    catalogue_only: true,
    reconciliation_claim: false,
    authorizes_migration: false,
    authorizes_runtime_activation: false,
    authorizes_go: false,
    authorizes_submission: false,
  });
}

/**
 * Builds a deeply immutable validation report for the supplied envelope. `valid` reflects
 * only whether the artifact matches the approved canonical catalogue shape/identity —
 * `catalogue_only` is always `true` and `reconciliation_claim`/`authorizes_migration`/
 * `authorizes_runtime_activation`/`authorizes_go`/`authorizes_submission` are always `false`,
 * regardless of `valid`. A valid catalogue is not reconciliation readiness, a migration
 * authorization, or a go/submission authorization, and none of those flags is ever inferred
 * from entry evidence or proposed state.
 *
 * Never throws: if reading the envelope or artifact (a Proxy, or a plain object with a
 * throwing accessor property) fails unexpectedly, this fails closed via
 * buildUnreadableEnvelopeReport instead of propagating the exception.
 */
export function buildAgt002CanonicalV031ValidationReport(envelope) {
  try {
    const blockers = validateAgt002CanonicalV031Envelope(envelope);

    const envelopeOk = isPlainObject(envelope);
    const artifact = envelopeOk && isPlainObject(envelope.artifact) ? envelope.artifact : null;

    const observed = {
      observed_file_sha256: envelopeOk ? safeString(envelope.observedFileSha256) : null,
      version: artifact ? safeString(artifact.version) : null,
      status: artifact ? safeString(artifact.status) : null,
      approved_by: artifact ? safeString(artifact.approved_by) : null,
      approved_at_utc: artifact ? safeString(artifact.approved_at_utc) : null,
      matching_rule: artifact ? safeString(artifact.matching_rule) : null,
    };

    const expected = {
      file_sha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256,
      version: AGT002_CANONICAL_V031_EXPECTED_VERSION,
      status: AGT002_CANONICAL_V031_EXPECTED_STATUS,
      approved_by: AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY,
      approved_at_utc: AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC,
      matching_rule: AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE,
    };

    const suppliedCanonicalSha256 = envelopeOk ? envelope.canonicalPayloadSha256 : undefined;
    const suppliedCanonicalBytes = envelopeOk ? envelope.canonicalPayloadBytes : undefined;
    if (suppliedCanonicalSha256 !== undefined || suppliedCanonicalBytes !== undefined) {
      const recomputed = artifact ? safeComputeCanonicalPayload(artifact) : null;
      observed.canonical_payload_sha256 = suppliedCanonicalSha256 ?? null;
      observed.canonical_payload_bytes = suppliedCanonicalBytes ?? null;
      expected.canonical_payload_sha256 = recomputed ? recomputed.sha256 : null;
      expected.canonical_payload_bytes = recomputed ? recomputed.bytes : null;
    }

    Object.freeze(observed);
    Object.freeze(expected);

    const report = {
      valid: blockers.length === 0,
      blockers,
      observed,
      expected,
      catalogue_only: true,
      reconciliation_claim: false,
      authorizes_migration: false,
      authorizes_runtime_activation: false,
      authorizes_go: false,
      authorizes_submission: false,
    };

    return deepFreeze(report);
  } catch {
    return buildUnreadableEnvelopeReport();
  }
}

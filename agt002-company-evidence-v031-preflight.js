// F2 preflight slice: a PURE, fail-closed cross-binding gate between the already-approved
// canonical v0.3.1 catalogue validator (agt002-company-evidence-canonical-v031-validator.js)
// and the 17->22 reclassification dry-run validator
// (agt002-company-evidence-reclass-17-to-22.js). This module never reads a database,
// SharePoint, the filesystem, or the network, and never makes an HTTP call — it only
// validates a `{ canonicalEnvelope, reclassInputs }` bundle supplied by the caller.
//
// The gate, in order:
//   1. buildAgt002CanonicalV031ValidationReport(canonicalEnvelope) must report valid:true.
//   2. Only then: canonicalEnvelope.canonicalPayloadSha256 AND canonicalPayloadBytes must be
//      explicitly supplied (the underlying validator already binds/verifies them when
//      supplied; preflight additionally REQUIRES their presence — a valid catalogue shape
//      with no bound payload hash is not enough to proceed).
//   3. Only then: reclassInputs is cross-bound to the canonical catalogue with explicit
//      rules (never accepted on trust) — the exact 22-id target set and version, the exact
//      archive-only declaration (overtime_authorization only, with its exact approved
//      resolution text as provenance), split coverage for every canonical transformation
//      whose approved resolution is a split, and approval governance (status/approver/date/
//      source/version/scope) bound to the canonical governance record, never to arbitrary
//      synthetic governance — and buildAgt002Reclass17To22DryRunReport(reclassInputs) is run.
//
// A report is preflight_ready:true only when every one of the above holds with zero
// blockers. Like both underlying validators, this report NEVER claims reconciliation, and
// NEVER authorizes migration, runtime activation, go, or submission — those five flags are
// hardcoded false/false/false/false/false regardless of preflight_ready, and are never
// inferred from any evidence or proposed state. A preflight_ready:true synthetic fixture
// carries no more authority than that.
//
// Out of scope by design (do not add here): database access, migrations, server/API wiring,
// package.json, docs, Radar/tender-fit-v1, DANE, AGT-003, production, or any external system.

import {
  AGT002_CANONICAL_V031_ENTRY_IDS,
  AGT002_CANONICAL_V031_EXPECTED_VERSION,
  AGT002_CANONICAL_V031_EXPECTED_STATUS,
  AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY,
  AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC,
  AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS,
  buildAgt002CanonicalV031ValidationReport,
} from './agt002-company-evidence-canonical-v031-validator.js';
import { buildAgt002Reclass17To22DryRunReport } from './agt002-company-evidence-reclass-17-to-22.js';

// Fixed literal marking that an approvalRecord is bound to THIS canonical v0.3.1 governance
// record, rather than an arbitrary synthetic source string the caller happens to supply.
export const AGT002_PREFLIGHT_EXPECTED_APPROVAL_SOURCE = 'agt002-canonical-v031-governance-record';

// The single source whose approved canonical provenance is archive-only (deprecated, no
// authorization observed) rather than an active split/merge/one-to-one mapping.
export const AGT002_PREFLIGHT_REQUIRED_ARCHIVE_ONLY_SOURCE_IDS = Object.freeze(['overtime_authorization']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

/**
 * reclassInputs.targetManifest must be exactly bound to the canonical 22-id target set and
 * the canonical approved version — no extra id, no missing id, no version drift. Silently
 * skipped (reclass's own validator already reports it) when targetManifest is not even
 * shaped like a manifest.
 */
function crossBindTargetManifest(targetManifest, blockers) {
  if (!isPlainObject(targetManifest) || !Array.isArray(targetManifest.classes)) return;

  if (targetManifest.version !== AGT002_CANONICAL_V031_EXPECTED_VERSION) {
    blockers.push(
      'reclassInputs.targetManifest.version debe coincidir exactamente con la versión canónica aprobada ' +
      `("${AGT002_CANONICAL_V031_EXPECTED_VERSION}"). Declarado: ${JSON.stringify(targetManifest.version)}.`,
    );
  }

  const actualIds = targetManifest.classes
    .filter((cls) => isPlainObject(cls) && typeof cls.id === 'string')
    .map((cls) => cls.id);
  const actualSet = new Set(actualIds);
  const expectedSet = new Set(AGT002_CANONICAL_V031_ENTRY_IDS);

  AGT002_CANONICAL_V031_ENTRY_IDS.forEach((expectedId) => {
    if (!actualSet.has(expectedId)) {
      blockers.push(
        `reclassInputs.targetManifest no incluye la clase canónica objetivo requerida "${expectedId}" ` +
        '(AGT002_CANONICAL_V031_ENTRY_IDS).',
      );
    }
  });
  actualSet.forEach((id) => {
    if (!expectedSet.has(id)) {
      blockers.push(
        `reclassInputs.targetManifest contiene una clase objetivo "${id}" fuera del conjunto canónico aprobado ` +
        'de 22 clases (AGT002_CANONICAL_V031_ENTRY_IDS).',
      );
    }
  });
}

/**
 * declaredArchiveOnlySourceIds must be exactly the one canonical archive-only source
 * (overtime_authorization), and archiveOnlyProvenance for it must be exactly the canonical
 * approved transformation resolution text — never an invented/synthetic justification.
 */
function crossBindArchiveOnly(declaredArchiveOnlySourceIds, archiveOnlyProvenance, blockers) {
  const declared = Array.isArray(declaredArchiveOnlySourceIds) ? declaredArchiveOnlySourceIds : [];
  const isExactRequiredSet =
    declared.length === AGT002_PREFLIGHT_REQUIRED_ARCHIVE_ONLY_SOURCE_IDS.length
    && AGT002_PREFLIGHT_REQUIRED_ARCHIVE_ONLY_SOURCE_IDS.every((id) => declared.includes(id));
  if (!isExactRequiredSet) {
    blockers.push(
      'reclassInputs.declaredArchiveOnlySourceIds debe ser exactamente ' +
      `${JSON.stringify(AGT002_PREFLIGHT_REQUIRED_ARCHIVE_ONLY_SOURCE_IDS)} — la única fuente cuya procedencia canónica ` +
      `aprobada es archive-only. Declarado: ${JSON.stringify(declared)}.`,
    );
  }

  const expectedProvenance = AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS.overtime_authorization;
  const actualProvenance = isPlainObject(archiveOnlyProvenance) ? archiveOnlyProvenance.overtime_authorization : undefined;
  if (actualProvenance !== expectedProvenance) {
    blockers.push(
      'reclassInputs.archiveOnlyProvenance.overtime_authorization debe ser exactamente la resolución de la transformación ' +
      `canónica aprobada ("${expectedProvenance}") — no se acepta una justificación sintética inventada. ` +
      `Declarado: ${JSON.stringify(actualProvenance)}.`,
    );
  }
}

/**
 * Every canonical transformation whose approved resolution text is a split must have its
 * original source explicitly present in declaredSplitSourceIds — a source may not be
 * silently treated as a simple mapping when the canonical governance text already says it
 * was approved as a split. Derived purely from the canonical module's own exported
 * transformation constants; no split evidence is invented here.
 */
function crossBindSplitCoverage(declaredSplitSourceIds, blockers) {
  const declared = new Set(Array.isArray(declaredSplitSourceIds) ? declaredSplitSourceIds : []);
  for (const [original, resolution] of Object.entries(AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS)) {
    if (!resolution.startsWith('split')) continue;
    if (!declared.has(original)) {
      blockers.push(
        `reclassInputs.declaredSplitSourceIds no incluye "${original}", cuya transformación canónica aprobada es un split ` +
        `("${resolution}") — no puede tratarse como mapeo simple sin declarar el split explícitamente.`,
      );
    }
  }
}

/**
 * reclassInputs.approvalRecord must be bound, with explicit per-field rules, to the
 * canonical governance record — never accepted merely because it is internally consistent
 * or carries a recognized approved status. Silently skipped (reclass's own validator already
 * reports it) when approvalRecord is entirely absent/malformed.
 */
function crossBindApprovalGovernance(approvalRecord, blockers) {
  if (!isPlainObject(approvalRecord)) return;

  if (approvalRecord.status !== AGT002_CANONICAL_V031_EXPECTED_STATUS) {
    blockers.push(
      'reclassInputs.approvalRecord.status debe coincidir exactamente con el estado de gobernanza canónico aprobado ' +
      `("${AGT002_CANONICAL_V031_EXPECTED_STATUS}") — no se acepta otro estado aprobado, aunque el módulo de reclasificación ` +
      `lo reconozca. Declarado: ${JSON.stringify(approvalRecord.status)}.`,
    );
  }
  if (approvalRecord.approver !== AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY) {
    blockers.push(
      'reclassInputs.approvalRecord.approver debe coincidir exactamente con approved_by del catálogo canónico ' +
      `("${AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY}"). Declarado: ${JSON.stringify(approvalRecord.approver)}.`,
    );
  }
  const expectedDate = AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC.slice(0, 10);
  if (approvalRecord.date !== expectedDate) {
    blockers.push(
      `reclassInputs.approvalRecord.date debe coincidir exactamente con la fecha de aprobación canónica ("${expectedDate}"). ` +
      `Declarado: ${JSON.stringify(approvalRecord.date)}.`,
    );
  }
  if (approvalRecord.source !== AGT002_PREFLIGHT_EXPECTED_APPROVAL_SOURCE) {
    blockers.push(
      `reclassInputs.approvalRecord.source debe ser exactamente "${AGT002_PREFLIGHT_EXPECTED_APPROVAL_SOURCE}" — no se acepta ` +
      `gobernanza sintética arbitraria como si estuviera aprobada por el catálogo canónico. Declarado: ${JSON.stringify(approvalRecord.source)}.`,
    );
  }
  if (approvalRecord.version !== AGT002_CANONICAL_V031_EXPECTED_VERSION) {
    blockers.push(
      'reclassInputs.approvalRecord.version debe coincidir exactamente con la versión canónica aprobada ' +
      `("${AGT002_CANONICAL_V031_EXPECTED_VERSION}"). Declarado: ${JSON.stringify(approvalRecord.version)}.`,
    );
  }
  if (!Array.isArray(approvalRecord.scope) || !approvalRecord.scope.includes(AGT002_CANONICAL_V031_EXPECTED_VERSION)) {
    blockers.push(
      'reclassInputs.approvalRecord.scope debe incluir explícitamente la versión canónica aprobada ' +
      `("${AGT002_CANONICAL_V031_EXPECTED_VERSION}").`,
    );
  }
}

/**
 * Runs the full gate over `{ canonicalEnvelope, reclassInputs }` and returns
 * { blockers, canonicalReport, reclassReport } (reclassReport is null whenever the gate
 * stops before running it). May throw on pathological input (a Proxy/accessor that throws);
 * callers below always go through safeComputePreflight, never this directly.
 */
function computePreflight(input) {
  const safeInput = isPlainObject(input) ? input : {};
  const canonicalEnvelope = safeInput.canonicalEnvelope;
  const reclassInputs = isPlainObject(safeInput.reclassInputs) ? safeInput.reclassInputs : {};

  const canonicalReport = buildAgt002CanonicalV031ValidationReport(canonicalEnvelope);
  const blockers = [];

  if (!canonicalReport.valid) {
    blockers.push(
      'canonicalEnvelope no es un catálogo canónico v0.3.1 válido: el preflight no puede continuar sin un catálogo ' +
      'canónico aprobado y verificado.',
    );
    canonicalReport.blockers.forEach((b) => blockers.push(`canonicalEnvelope: ${b}`));
    return { blockers, canonicalReport, reclassReport: null };
  }

  const envelopeOk = isPlainObject(canonicalEnvelope);
  const suppliedSha256 = envelopeOk ? canonicalEnvelope.canonicalPayloadSha256 : undefined;
  const suppliedBytes = envelopeOk ? canonicalEnvelope.canonicalPayloadBytes : undefined;
  if (suppliedSha256 === undefined || suppliedBytes === undefined) {
    blockers.push(
      'canonicalEnvelope.canonicalPayloadSha256 y canonicalEnvelope.canonicalPayloadBytes deben suministrarse ' +
      'explícitamente y estar atados (bound) al artifact exacto suministrado antes de continuar — el preflight nunca ata ' +
      'la reclasificación a un catálogo canónico sin hash/bytes de payload verificados.',
    );
    return { blockers, canonicalReport, reclassReport: null };
  }

  crossBindTargetManifest(reclassInputs.targetManifest, blockers);
  crossBindArchiveOnly(reclassInputs.declaredArchiveOnlySourceIds, reclassInputs.archiveOnlyProvenance, blockers);
  crossBindSplitCoverage(reclassInputs.declaredSplitSourceIds, blockers);
  crossBindApprovalGovernance(reclassInputs.approvalRecord, blockers);

  const reclassReport = buildAgt002Reclass17To22DryRunReport(reclassInputs);
  if (!reclassReport.ready) {
    reclassReport.blockers.forEach((b) => blockers.push(`reclassInputs: ${b}`));
  }

  return { blockers, canonicalReport, reclassReport };
}

/** Never throws: returns { blockers, canonicalReport, reclassReport } or null on unreadable input. */
function safeComputePreflight(input) {
  try {
    return computePreflight(input);
  } catch {
    return null;
  }
}

/**
 * Fail-closed report returned when reading the input (a Proxy with a throwing get trap, or a
 * plain object with a throwing accessor property somewhere on canonicalEnvelope/reclassInputs)
 * throws unexpectedly. Every observed value is absent and every authority flag is false, same
 * as any other invalid report.
 */
function buildUnreadablePreflightReport() {
  return deepFreeze({
    preflight_ready: false,
    blockers: Object.freeze([
      'No fue posible construir el informe de preflight: la lectura del sobre canónico o de reclassInputs falló de ' +
      'forma inesperada (propiedad inaccesible).',
    ]),
    canonical_valid: false,
    canonical_blockers: Object.freeze([]),
    reclass_ready: false,
    reclass_blockers: Object.freeze([]),
    reconciliation_claim: false,
    authorizes_migration: false,
    authorizes_runtime_activation: false,
    authorizes_go: false,
    authorizes_submission: false,
    disclaimer:
      'Reporte de preflight determinístico y puro. No reconcilia con ningún sistema en vivo; no autoriza go, submission, ' +
      'migración ni activación en runtime.',
  });
}

function buildPreflightReportFromComputed({ blockers, canonicalReport, reclassReport }) {
  const ready = blockers.length === 0 && reclassReport !== null && reclassReport.ready === true;

  const report = {
    preflight_ready: ready,
    blockers: Object.freeze([...blockers]),
    canonical_valid: canonicalReport.valid,
    canonical_blockers: Object.freeze([...canonicalReport.blockers]),
    reclass_ready: reclassReport ? reclassReport.ready : false,
    reclass_blockers: reclassReport ? Object.freeze([...reclassReport.blockers]) : Object.freeze([]),
    reconciliation_claim: false,
    authorizes_migration: false,
    authorizes_runtime_activation: false,
    authorizes_go: false,
    authorizes_submission: false,
    disclaimer:
      'Reporte de preflight determinístico y puro sobre exactamente el canonicalEnvelope y reclassInputs suministrados. ' +
      'No reconcilia con ninguna base de datos, SharePoint u otro sistema en vivo; no aplica, migra ni activa nada; no ' +
      'autoriza go, submission, migración ni activación en runtime.',
  };

  if (ready) {
    report.canonical_payload_sha256 = canonicalReport.observed.canonical_payload_sha256;
    report.canonical_payload_bytes = canonicalReport.observed.canonical_payload_bytes;
    report.reclass_hash = reclassReport.hash;
    report.target_class_ids = reclassReport.targetClassIds;
    report.merges = reclassReport.merges;
    report.splits = reclassReport.splits;
    report.archive_only = reclassReport.archiveOnly;
    report.one_to_one = reclassReport.oneToOne;
  }

  return deepFreeze(report);
}

/**
 * Validates a `{ canonicalEnvelope, reclassInputs }` bundle and returns the full frozen list
 * of blockers (empty when every gate above passes with zero blockers). Never throws.
 */
export function validateAgt002CompanyEvidenceV031PreflightInputs(input) {
  const computed = safeComputePreflight(input);
  if (!computed) {
    return Object.freeze([
      'No fue posible validar la entrada de preflight: la lectura del sobre canónico o de reclassInputs falló de forma ' +
      'inesperada (propiedad inaccesible).',
    ]);
  }
  return Object.freeze([...computed.blockers]);
}

/**
 * Builds a deeply immutable preflight report for the supplied `{ canonicalEnvelope,
 * reclassInputs }`. `preflight_ready` reflects only whether every cross-binding gate above
 * passes with zero blockers — `reconciliation_claim`/`authorizes_migration`/
 * `authorizes_runtime_activation`/`authorizes_go`/`authorizes_submission` are always `false`,
 * regardless of `preflight_ready`. Never throws.
 */
export function buildAgt002CompanyEvidenceV031PreflightReport(input) {
  const computed = safeComputePreflight(input);
  if (!computed) return buildUnreadablePreflightReport();
  return buildPreflightReportFromComputed(computed);
}

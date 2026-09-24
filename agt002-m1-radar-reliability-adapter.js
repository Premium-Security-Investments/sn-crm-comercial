// AGT-002 M1: adapts a frozen legacy radar result shape into the M1 reliability bundle
// shape consumed by validateAgt002M1RadarReliabilityBundle. Pure, fail-closed, no IO.

import { AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION, validateAgt002M1RadarReliabilityBundle } from './agt002-m1-radar-reliability-contract.js';

const LEGACY_SCHEMA_VERSION = 'agt002-radar-legacy-synthetic-v1';

const RUN_KEYS = Object.freeze(['id', 'status', 'started_at', 'finished_at']);
const SOURCE_KEYS = Object.freeze([
  'pages_fetched', 'total_pages', 'exhaustive', 'claims_absence', 'snapshot_sha256', 'record_count',
]);
const PERSISTENCE_KEYS = Object.freeze(['record_count', 'snapshot_sha256', 'committed_at']);
const PRESENTATION_KEYS = Object.freeze(['record_count', 'snapshot_sha256', 'rendered_at']);
const EVIDENCE_ITEM_KEYS = Object.freeze(['id', 'kind', 'uri', 'captured_at', 'sha256']);
const FRESHNESS_KEYS = Object.freeze(['evaluated_at', 'data_as_of', 'max_calendar_days']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPresent(obj, key) {
  return isPlainObject(obj) && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

function collectSectionMissing(legacy, section, keys, missing) {
  const obj = legacy[section];
  for (const key of keys) {
    if (!isPresent(obj, key)) missing.push(`${section}.${key}`);
  }
}

function collectEvidenceMissing(legacy, missing) {
  const evidence = legacy.evidence;
  if (!Array.isArray(evidence)) {
    missing.push('evidence');
    return;
  }
  evidence.forEach((item, index) => {
    for (const key of EVIDENCE_ITEM_KEYS) {
      if (!isPresent(item, key)) missing.push(`evidence[${index}].${key}`);
    }
  });
}

function collectMissingFields(legacy) {
  const missing = [];
  collectSectionMissing(legacy, 'run', RUN_KEYS, missing);
  collectSectionMissing(legacy, 'source', SOURCE_KEYS, missing);
  collectSectionMissing(legacy, 'persistence', PERSISTENCE_KEYS, missing);
  collectSectionMissing(legacy, 'presentation', PRESENTATION_KEYS, missing);
  collectEvidenceMissing(legacy, missing);
  collectSectionMissing(legacy, 'freshness', FRESHNESS_KEYS, missing);
  return missing;
}

function rejected(reason, missingFields) {
  return Object.freeze({
    status: 'REJECTED',
    bundle: null,
    verdict: 'INVALID',
    promotable: false,
    reasons: Object.freeze([reason]),
    missing_fields: Object.freeze([...missingFields]),
  });
}

function buildBundle(legacy) {
  const evidence = Object.freeze(legacy.evidence.map((item) => Object.freeze({
    evidence_id: item.id,
    kind: item.kind,
    locator: item.uri,
    captured_at_utc: item.captured_at,
    content_sha256: item.sha256,
  })));

  return Object.freeze({
    schema_version: AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION,
    run_id: legacy.run.id,
    scan: Object.freeze({
      status: legacy.run.status,
      started_at_utc: legacy.run.started_at,
      completed_at_utc: legacy.run.finished_at,
      pagination: Object.freeze({
        pages_fetched: legacy.source.pages_fetched,
        total_pages_declared: legacy.source.total_pages,
        exhaustive: legacy.source.exhaustive,
        claims_absence: legacy.source.claims_absence,
      }),
      source_snapshot_hash: legacy.source.snapshot_sha256,
      item_count: legacy.source.record_count,
    }),
    persistence: Object.freeze({
      persisted_count: legacy.persistence.record_count,
      persisted_snapshot_hash: legacy.persistence.snapshot_sha256,
      persisted_at_utc: legacy.persistence.committed_at,
    }),
    ui_projection: Object.freeze({
      rendered_count: legacy.presentation.record_count,
      rendered_snapshot_hash: legacy.presentation.snapshot_sha256,
      rendered_at_utc: legacy.presentation.rendered_at,
    }),
    evidence,
    freshness: Object.freeze({
      now_utc: legacy.freshness.evaluated_at,
      data_as_of_utc: legacy.freshness.data_as_of,
      max_staleness_calendar_days: legacy.freshness.max_calendar_days,
    }),
  });
}

export function adaptLegacyRadarResultToM1(legacy) {
  if (!isPlainObject(legacy)) {
    return rejected('adapter.legacy.invalid_input', []);
  }
  if (!isPresent(legacy, 'legacy_schema_version')) {
    return rejected('adapter.legacy.missing_required_field', ['legacy_schema_version']);
  }
  if (legacy.legacy_schema_version !== LEGACY_SCHEMA_VERSION) {
    return rejected('adapter.legacy.unsupported_schema_version', []);
  }

  const missingFields = collectMissingFields(legacy);
  if (missingFields.length > 0) {
    return rejected('adapter.legacy.missing_required_field', missingFields);
  }

  const bundle = buildBundle(legacy);
  const validation = validateAgt002M1RadarReliabilityBundle(bundle);

  return Object.freeze({
    status: 'ADAPTED',
    bundle,
    verdict: validation.verdict,
    reasons: validation.reasons,
    promotable: validation.promotable,
    missing_fields: Object.freeze([]),
  });
}

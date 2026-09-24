import assert from 'node:assert/strict';
import {
  AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION,
  AGT002_M1_RADAR_RELIABILITY_VERDICTS,
  AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG,
  validateAgt002M1RadarReliabilityBundle,
  resolveAgt002M1RadarReliabilityPromotion,
} from '../agt002-m1-radar-reliability-contract.js';

// FASE RED: este import falla hasta que exista `agt002-m1-radar-reliability-contract.js`
// (FASE GREEN, ver docs/superpowers/plans/2026-09-24-agt002-m1-radar-reliability-contracts.md).
// Todos los datos son 100% sintéticos: identificadores con prefijo `synthetic-` y locators de
// evidencia con esquema `fixture://`, nunca resueltos a bytes reales. Cero disco, cero red, cero
// SQL, cero runtime/UI.

assert.deepEqual([...AGT002_M1_RADAR_RELIABILITY_VERDICTS].sort(), ['INVALID', 'UNVERIFIED', 'VALID']);
assert.equal(Object.isFrozen(AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG), true);
assert.ok(AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG.length > 0);

const HASH_A = 'a'.repeat(64);
const HASH_EMPTY = '0'.repeat(64);
const CONTENT_HASH = 'b'.repeat(64);

function synthetic(id) { return `synthetic-${id}`; }

function baseBundle() {
  return {
    schema_version: AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION,
    run_id: synthetic('run-0001'),
    scan: {
      status: 'completed',
      started_at_utc: '2026-09-24T05:00:00Z',
      completed_at_utc: '2026-09-24T05:30:00Z',
      pagination: { pages_fetched: 3, total_pages_declared: 3, exhaustive: true, claims_absence: true },
      source_snapshot_hash: HASH_A,
      item_count: 42,
    },
    persistence: {
      persisted_count: 42,
      persisted_snapshot_hash: HASH_A,
      persisted_at_utc: '2026-09-24T05:35:00Z',
    },
    ui_projection: {
      rendered_count: 42,
      rendered_snapshot_hash: HASH_A,
      rendered_at_utc: '2026-09-24T05:40:00Z',
    },
    evidence: [
      {
        evidence_id: synthetic('evidence-0001'),
        kind: 'scan_manifest',
        locator: 'fixture://agt002-m1-radar-reliability/scan-manifest/synthetic-run-0001',
        captured_at_utc: '2026-09-24T05:30:00Z',
        content_sha256: CONTENT_HASH,
      },
    ],
    freshness: {
      now_utc: '2026-09-24T12:00:00Z',
      data_as_of_utc: '2026-09-24T05:30:00Z',
      max_staleness_calendar_days: 1,
    },
  };
}

const allObservedReasons = [];
function evaluate(bundle) {
  const result = validateAgt002M1RadarReliabilityBundle(bundle);
  allObservedReasons.push(...result.reasons);
  return result;
}

// 1. Happy path promovible.
const happyPath = baseBundle();
const happyResult = evaluate(happyPath);
assert.equal(happyResult.verdict, 'VALID');
assert.equal(happyResult.promotable, true);
assert.deepEqual(happyResult.reasons, []);
const happyPromotion = resolveAgt002M1RadarReliabilityPromotion(happyPath);
assert.equal(happyPromotion.promoted, true);
assert.equal(happyPromotion.verdict, 'VALID');
assert.deepEqual(happyPromotion.reasons, []);

// 2. No-terminal.
const notTerminal = { ...baseBundle(), scan: { ...baseBundle().scan, status: 'running' } };
const notTerminalResult = evaluate(notTerminal);
assert.equal(notTerminalResult.verdict, 'UNVERIFIED');
assert.equal(notTerminalResult.promotable, false);
assert.ok(notTerminalResult.reasons.includes('scan.status.not_terminal'));

// 3. Partial (cobertura incompleta, sin reclamar ausencia).
const partial = {
  ...baseBundle(),
  scan: {
    ...baseBundle().scan,
    pagination: { pages_fetched: 1, total_pages_declared: 3, exhaustive: false, claims_absence: false },
  },
};
const partialResult = evaluate(partial);
assert.equal(partialResult.verdict, 'UNVERIFIED');
assert.ok(partialResult.reasons.includes('coverage.partial'));

// 4. Stale (frescura calculada por días de calendario UTC, no por duración).
const stale = {
  ...baseBundle(),
  freshness: { ...baseBundle().freshness, data_as_of_utc: '2026-09-21T05:30:00Z', max_staleness_calendar_days: 1 },
};
const staleResult = evaluate(stale);
assert.equal(staleResult.verdict, 'INVALID');
assert.ok(staleResult.reasons.includes('freshness.stale'));

// 5. Evidencia vacía (fail-closed: ausencia de evidencia nunca es prueba de validez).
const noEvidence = { ...baseBundle(), evidence: [] };
const noEvidenceResult = evaluate(noEvidence);
assert.equal(noEvidenceResult.verdict, 'UNVERIFIED');
assert.ok(noEvidenceResult.reasons.includes('evidence.absent'));

// 6. Promoción inválida sobre partial / stale / sin evidencia: nunca hay promoción parcial.
for (const [bundle, expected] of [[partial, partialResult], [stale, staleResult], [noEvidence, noEvidenceResult]]) {
  const promotion = resolveAgt002M1RadarReliabilityPromotion(bundle);
  assert.equal(promotion.promoted, false);
  assert.equal(promotion.verdict, expected.verdict);
  assert.deepEqual([...promotion.reasons].sort(), [...expected.reasons].sort());
}

// 7. Bundle mixto / no atómico: sólo trazabilidad rota, todo lo demás válido.
const mixed = {
  ...baseBundle(),
  persistence: { ...baseBundle().persistence, persisted_snapshot_hash: 'c'.repeat(64) },
};
const mixedResult = evaluate(mixed);
assert.equal(mixedResult.verdict, 'INVALID');
assert.deepEqual(mixedResult.reasons, ['traceability.source_persistence_mismatch']);
assert.ok(
  mixedResult.checked_terms.filter((term) => term.term !== 'traceability').every((term) => term.verdict === 'VALID'),
  'los términos no relacionados con trazabilidad deben seguir siendo VALID en un fallo puntual',
);
const mixedPromotion = resolveAgt002M1RadarReliabilityPromotion(mixed);
assert.equal(mixedPromotion.promoted, false);
assert.deepEqual(Object.keys(mixedPromotion).sort(), ['promoted', 'reasons', 'verdict']);

// 8. Mismatch fuente→persistencia (aislado: persistencia→UI sigue coherente).
const sourcePersistenceMismatch = {
  ...baseBundle(),
  persistence: { ...baseBundle().persistence, persisted_snapshot_hash: 'c'.repeat(64) },
  ui_projection: { ...baseBundle().ui_projection, rendered_snapshot_hash: 'c'.repeat(64) },
};
const sourcePersistenceResult = evaluate(sourcePersistenceMismatch);
assert.equal(sourcePersistenceResult.verdict, 'INVALID');
assert.deepEqual(sourcePersistenceResult.reasons, ['traceability.source_persistence_mismatch']);

// 9. Mismatch persistencia→UI (aislado: fuente→persistencia sigue coherente).
const persistenceUiMismatch = {
  ...baseBundle(),
  ui_projection: { ...baseBundle().ui_projection, rendered_snapshot_hash: 'd'.repeat(64) },
};
const persistenceUiResult = evaluate(persistenceUiMismatch);
assert.equal(persistenceUiResult.verdict, 'INVALID');
assert.deepEqual(persistenceUiResult.reasons, ['traceability.persistence_ui_mismatch']);

// 10. Primera página reclama ausencia: la cobertura parcial nunca prueba ausencia.
const firstPageClaimsAbsence = {
  ...baseBundle(),
  scan: {
    ...baseBundle().scan,
    pagination: { pages_fetched: 1, total_pages_declared: 5, exhaustive: false, claims_absence: true },
  },
};
const firstPageResult = evaluate(firstPageClaimsAbsence);
assert.equal(firstPageResult.verdict, 'INVALID');
assert.ok(firstPageResult.reasons.includes('coverage.first_page_claims_absence'));

// 11. Ausencia exhaustiva válida: sólo la exhaustividad, no la sola afirmación, habilita la ausencia.
const exhaustiveAbsence = {
  ...baseBundle(),
  scan: {
    ...baseBundle().scan,
    pagination: { pages_fetched: 5, total_pages_declared: 5, exhaustive: true, claims_absence: true },
    source_snapshot_hash: HASH_EMPTY,
    item_count: 0,
  },
  persistence: { ...baseBundle().persistence, persisted_snapshot_hash: HASH_EMPTY, persisted_count: 0 },
  ui_projection: { ...baseBundle().ui_projection, rendered_snapshot_hash: HASH_EMPTY, rendered_count: 0 },
};
const exhaustiveAbsenceResult = evaluate(exhaustiveAbsence);
assert.equal(exhaustiveAbsenceResult.verdict, 'VALID');
assert.deepEqual(exhaustiveAbsenceResult.reasons, []);

// 12. Timestamp imposible (30 de febrero no existe en ningún año).
const impossibleTimestamp = {
  ...baseBundle(),
  scan: { ...baseBundle().scan, completed_at_utc: '2026-02-30T10:00:00Z' },
};
const impossibleTimestampResult = evaluate(impossibleTimestamp);
assert.equal(impossibleTimestampResult.verdict, 'INVALID');
assert.ok(impossibleTimestampResult.reasons.includes('temporal.timestamp_invalid'));

// 13. Campo extra: forma cerrada en el nivel superior y dentro de un elemento de evidencia.
const extraTopLevelField = { ...baseBundle(), unexpected_field: true };
const extraTopLevelResult = evaluate(extraTopLevelField);
assert.equal(extraTopLevelResult.verdict, 'INVALID');
assert.ok(extraTopLevelResult.reasons.includes('schema.additional_property'));

const extraEvidenceField = {
  ...baseBundle(),
  evidence: [{ ...baseBundle().evidence[0], unexpected_field: true }],
};
const extraEvidenceResult = evaluate(extraEvidenceField);
assert.equal(extraEvidenceResult.verdict, 'INVALID');
assert.ok(extraEvidenceResult.reasons.includes('schema.additional_property'));

// 14. Ninguna razón emitida por ningún caso anterior cae fuera del catálogo cerrado.
assert.ok(allObservedReasons.length > 0);
for (const reason of allObservedReasons) {
  assert.ok(
    AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG.includes(reason),
    `razón "${reason}" emitida fuera del catálogo cerrado`,
  );
}

console.log('AGT-002 M1 radar reliability contract: todas las aserciones pasan contra el módulo evaluador existente.');

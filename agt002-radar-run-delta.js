// AGT-002 Radar — delta puro entre dos corridas ("run delta") del Corte 3.
//
// Dominio puro: sin IO, sin red, sin base de datos, sin UI. Nunca lee el reloj — no hay
// `Date.now()` ni `new Date()` sin argumentos en este archivo. Toda noción de "ahora" llega como
// `finished_at` explícito en los recibos/snapshots de corrida que entrega quien llama; el único uso
// de `Date.parse` en este módulo es sobre esas cadenas ya recibidas, para comparar instantes, nunca
// para leer la hora real.
//
// Dos funciones públicas:
//   - `buildAgt002RadarRunSnapshot(receipt)` proyecta un recibo de corrida (candidatos crudos por
//     fuente, con posible payload arbitrario) a un snapshot compacto: sólo los ocho campos del
//     contrato sobreviven por candidato — nunca `raw`, tokens ni secretos, porque se copian campo a
//     campo por allowlist, nunca por spread del candidato de entrada.
//   - `computeAgt002RadarRunDelta(previousSnapshot, currentSnapshot)` compara dos snapshots y
//     produce una lista determinística de cambios de candidato (nuevo, cierre modificado, encaje
//     actualizado, vencido) más eventos de salud de fuente (recuperada/degradada).
//
// Fail-closed: cualquier recibo o snapshot con forma inválida lanza
// `Agt002RadarRunDeltaValidationError` en vez de producir una proyección parcial o silenciosa.

export const AGT002_RADAR_RUN_DELTA_MAX_FIT_REASONS = 3;

export const AGT002_RADAR_RUN_DELTA_SOURCE_STATUSES = Object.freeze(['success', 'failed']);

// Orden canónico de categorías: también el orden estable en que se emiten los cambios de una
// misma corrida (ver `sortChanges`).
export const AGT002_RADAR_RUN_DELTA_CATEGORIES = Object.freeze([
  'new',
  'deadline_changed',
  'fit_changed',
  'expired',
  'source_recovered',
  'source_degraded',
]);

const CATEGORY_LABELS = Object.freeze({
  new: 'Nuevo',
  deadline_changed: 'Cierre modificado',
  fit_changed: 'Encaje actualizado',
  expired: 'Vencido desde la última corrida',
  source_recovered: 'Fuente recuperada',
  source_degraded: 'Fuente degradada',
});

export class Agt002RadarRunDeltaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Agt002RadarRunDeltaValidationError';
  }
}

function fail(message) {
  throw new Agt002RadarRunDeltaValidationError(message);
}

/** Etiqueta en español de una categoría del catálogo cerrado. Falla cerrado ante categoría desconocida. */
export function agt002RadarRunDeltaCategoryLabel(category) {
  const label = CATEGORY_LABELS[category];
  if (!label) fail(`unknown radar run delta category: ${String(category)}`);
  return label;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isIsoDate(value) {
  return isNonEmptyString(value) && ISO_DATE_RE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function isIsoDateTime(value) {
  return isNonEmptyString(value) && ISO_DATETIME_RE.test(value) && Number.isFinite(Date.parse(value));
}

// `deadline` es la fecha de cierre ya canónica (`YYYY-MM-DD`) o `null` si no se conoce. Normalizar
// formatos crudos del proveedor (otras zonas horarias, timestamps completos) es responsabilidad de
// la capa adaptadora, no de este dominio puro.
function isCanonicalDeadline(value) {
  return value === null || isIsoDate(value);
}

const CANDIDATE_KEYS = Object.freeze(['stable_key', 'source', 'title', 'entity', 'deadline', 'fit_band', 'fit_reasons', 'known_phases']);
const SOURCE_KEYS = Object.freeze(['source', 'status']);
const SNAPSHOT_KEYS = Object.freeze(['run_id', 'finished_at', 'sources', 'candidates']);

function assertClosedShape(value, keys, context) {
  const keySet = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!keySet.has(key)) fail(`${context} has unexpected field: ${key}`);
  }
}

// --- Validación del recibo de corrida (entrada cruda; tolerante a campos extra de pipeline, ---
// --- porque es `buildAgt002RadarRunSnapshot` quien decide qué sobrevive a la proyección). -------

function validateRawCandidateShape(candidate, parentSource, index) {
  const context = `sources["${parentSource}"].candidates[${index}]`;
  if (!isPlainObject(candidate)) fail(`${context} must be an object`);
  if (!isNonEmptyString(candidate.stable_key)) fail(`${context} requires stable_key`);
  if (candidate.source !== parentSource) fail(`${context} ("${candidate.stable_key}") source must match parent source "${parentSource}"`);
  if (!isNonEmptyString(candidate.title)) fail(`${context} ("${candidate.stable_key}") requires title`);
  if (!isNonEmptyString(candidate.entity)) fail(`${context} ("${candidate.stable_key}") requires entity`);
  if (!isCanonicalDeadline(candidate.deadline)) fail(`${context} ("${candidate.stable_key}") requires deadline as YYYY-MM-DD or null`);
  if (!isNonEmptyString(candidate.fit_band)) fail(`${context} ("${candidate.stable_key}") requires fit_band`);
  if (!isStringArray(candidate.fit_reasons)) fail(`${context} ("${candidate.stable_key}") requires fit_reasons as a string array`);
  if (!isStringArray(candidate.known_phases)) fail(`${context} ("${candidate.stable_key}") requires known_phases as a string array`);
}

function validateRunReceipt(receipt) {
  if (!isPlainObject(receipt)) fail('run receipt must be an object');
  if (!isNonEmptyString(receipt.run_id)) fail('run receipt requires run_id');
  if (!isIsoDateTime(receipt.finished_at)) fail('run receipt requires finished_at as an ISO-8601 UTC datetime');
  if (!Array.isArray(receipt.sources) || receipt.sources.length === 0) fail('run receipt requires a non-empty sources array');

  const seenSources = new Set();
  for (const src of receipt.sources) {
    if (!isPlainObject(src)) fail('source entry must be an object');
    if (!isNonEmptyString(src.source)) fail('source entry requires a source name');
    if (seenSources.has(src.source)) fail(`duplicate source in receipt: ${src.source}`);
    seenSources.add(src.source);
    if (!AGT002_RADAR_RUN_DELTA_SOURCE_STATUSES.includes(src.status)) {
      fail(`source "${src.source}" has invalid status: ${String(src.status)}`);
    }
    if (src.status === 'failed') {
      if (Array.isArray(src.candidates) && src.candidates.length > 0) {
        fail(`failed source "${src.source}" must not report candidates`);
      }
    } else {
      if (!Array.isArray(src.candidates)) fail(`successful source "${src.source}" requires a candidates array`);
      src.candidates.forEach((candidate, index) => validateRawCandidateShape(candidate, src.source, index));
    }
  }
  return receipt;
}

// --- Proyección a snapshot compacto: allowlist explícita de ocho campos por candidato. ---

function toCompactCandidate(candidate) {
  return Object.freeze({
    stable_key: candidate.stable_key,
    source: candidate.source,
    title: candidate.title,
    entity: candidate.entity,
    deadline: candidate.deadline,
    fit_band: candidate.fit_band,
    fit_reasons: Object.freeze(candidate.fit_reasons.slice(0, AGT002_RADAR_RUN_DELTA_MAX_FIT_REASONS)),
    known_phases: Object.freeze([...new Set(candidate.known_phases)].sort(compareStrings)),
  });
}

export function buildAgt002RadarRunSnapshot(receipt) {
  validateRunReceipt(receipt);

  const sources = receipt.sources
    .map((src) => Object.freeze({ source: src.source, status: src.status }))
    .sort((a, b) => compareStrings(a.source, b.source));

  const candidatesByKey = new Map();
  for (const src of receipt.sources) {
    if (src.status !== 'success') continue;
    for (const candidate of src.candidates) {
      if (candidatesByKey.has(candidate.stable_key)) {
        fail(`duplicate stable_key across successful sources: ${candidate.stable_key}`);
      }
      candidatesByKey.set(candidate.stable_key, toCompactCandidate(candidate));
    }
  }

  const candidates = [...candidatesByKey.values()].sort((a, b) => compareStrings(a.stable_key, b.stable_key));

  return Object.freeze({
    run_id: receipt.run_id,
    finished_at: receipt.finished_at,
    sources: Object.freeze(sources),
    candidates: Object.freeze(candidates),
  });
}

// --- Validación de snapshots: forma CERRADA. Es la frontera que garantiza que `computeAgt002RadarRunDelta` ---
// --- nunca opera sobre algo que cargue `raw`, tokens o cualquier campo fuera del contrato. ------------------

function validateSnapshotCandidate(candidate, snapshot, label) {
  if (!isPlainObject(candidate)) fail(`${label} snapshot candidate must be an object`);
  assertClosedShape(candidate, CANDIDATE_KEYS, `${label} snapshot candidate`);
  if (!isNonEmptyString(candidate.stable_key)) fail(`${label} snapshot candidate requires stable_key`);
  if (!isNonEmptyString(candidate.source)) fail(`${label} candidate "${candidate.stable_key}" requires source`);
  if (!isNonEmptyString(candidate.title)) fail(`${label} candidate "${candidate.stable_key}" requires title`);
  if (!isNonEmptyString(candidate.entity)) fail(`${label} candidate "${candidate.stable_key}" requires entity`);
  if (!isCanonicalDeadline(candidate.deadline)) fail(`${label} candidate "${candidate.stable_key}" has an invalid deadline`);
  if (!isNonEmptyString(candidate.fit_band)) fail(`${label} candidate "${candidate.stable_key}" requires fit_band`);
  if (!isStringArray(candidate.fit_reasons) || candidate.fit_reasons.length > AGT002_RADAR_RUN_DELTA_MAX_FIT_REASONS) {
    fail(`${label} candidate "${candidate.stable_key}" has invalid fit_reasons (max ${AGT002_RADAR_RUN_DELTA_MAX_FIT_REASONS})`);
  }
  if (!isStringArray(candidate.known_phases)) fail(`${label} candidate "${candidate.stable_key}" has invalid known_phases`);

  const sourceEntry = snapshot.sources.find((s) => s.source === candidate.source);
  if (!sourceEntry || sourceEntry.status !== 'success') {
    fail(`${label} candidate "${candidate.stable_key}" belongs to a non-successful source: ${candidate.source}`);
  }
}

function validateSnapshot(snapshot, label) {
  if (!isPlainObject(snapshot)) fail(`${label} snapshot must be an object`);
  assertClosedShape(snapshot, SNAPSHOT_KEYS, `${label} snapshot`);
  if (!isNonEmptyString(snapshot.run_id)) fail(`${label} snapshot requires run_id`);
  if (!isIsoDateTime(snapshot.finished_at)) fail(`${label} snapshot requires finished_at as an ISO-8601 UTC datetime`);
  if (!Array.isArray(snapshot.sources)) fail(`${label} snapshot requires a sources array`);

  const seenSources = new Set();
  for (const src of snapshot.sources) {
    if (!isPlainObject(src)) fail(`${label} snapshot source entry must be an object`);
    assertClosedShape(src, SOURCE_KEYS, `${label} snapshot source entry`);
    if (!isNonEmptyString(src.source)) fail(`${label} snapshot source entry requires source name`);
    if (seenSources.has(src.source)) fail(`${label} snapshot has duplicate source: ${src.source}`);
    seenSources.add(src.source);
    if (!AGT002_RADAR_RUN_DELTA_SOURCE_STATUSES.includes(src.status)) {
      fail(`${label} snapshot source "${src.source}" has invalid status: ${String(src.status)}`);
    }
  }

  if (!Array.isArray(snapshot.candidates)) fail(`${label} snapshot requires a candidates array`);
  const seenKeys = new Set();
  for (const candidate of snapshot.candidates) {
    if (isPlainObject(candidate) && seenKeys.has(candidate.stable_key)) {
      fail(`${label} snapshot has duplicate stable_key: ${candidate.stable_key}`);
    }
    validateSnapshotCandidate(candidate, snapshot, label);
    seenKeys.add(candidate.stable_key);
  }
  return snapshot;
}

// --- Cómputo del delta ---

function deriveRunStatus(snapshot) {
  const statuses = snapshot.sources.map((s) => s.status);
  if (statuses.every((s) => s === 'success')) return 'complete';
  if (statuses.every((s) => s === 'failed')) return 'failed';
  return 'partial';
}

function runSummary(snapshot) {
  return Object.freeze({ run_id: snapshot.run_id, finished_at: snapshot.finished_at, status: deriveRunStatus(snapshot) });
}

function normalizeFitBand(band) {
  return band.trim().toLowerCase();
}

// Instante de cierre = fin del día canónico de `deadline`, en milisegundos. Pura función de una
// cadena ya validada — nunca lee el reloj real.
function deadlineClosesAtMs(deadline) {
  return Date.parse(`${deadline}T23:59:59.999Z`);
}

function pushChange(changes, change) {
  changes.push(Object.freeze({ ...change, label: agt002RadarRunDeltaCategoryLabel(change.category) }));
}

function computeSourceHealthEvents(previousSnapshot, currentSnapshot, changes) {
  const prevStatus = new Map(previousSnapshot.sources.map((s) => [s.source, s.status]));
  const currStatus = new Map(currentSnapshot.sources.map((s) => [s.source, s.status]));
  const sourceNames = [...new Set([...prevStatus.keys(), ...currStatus.keys()])].sort(compareStrings);
  for (const source of sourceNames) {
    const before = prevStatus.get(source);
    const after = currStatus.get(source);
    if (before === undefined || after === undefined) continue; // fuente agregada/retirada: no es una transición de salud
    if (before === 'failed' && after === 'success') {
      pushChange(changes, { category: 'source_recovered', source });
    } else if (before === 'success' && after === 'failed') {
      pushChange(changes, { category: 'source_degraded', source });
    }
  }
}

function computeCandidateChanges(previousSnapshot, currentSnapshot, changes) {
  const prevCandidates = new Map(previousSnapshot.candidates.map((c) => [c.stable_key, c]));
  const currCandidates = new Map(currentSnapshot.candidates.map((c) => [c.stable_key, c]));
  // Por invariante del snapshot (validateSnapshotCandidate), toda llave presente aquí pertenece a
  // una fuente con status 'success' en esa misma corrida — por eso "new"/"deadline_changed"/
  // "fit_changed" no necesitan volver a chequear el status de la fuente actual explícitamente.
  const prevSourceStatus = new Map(previousSnapshot.sources.map((s) => [s.source, s.status]));
  const currSourceStatus = new Map(currentSnapshot.sources.map((s) => [s.source, s.status]));

  const currentKeysSorted = [...currCandidates.keys()].sort(compareStrings);
  for (const key of currentKeysSorted) {
    const curr = currCandidates.get(key);
    const prev = prevCandidates.get(key);
    if (!prev) {
      // Sólo es "nuevo" si la MISMA fuente ya había terminado con éxito en la corrida anterior.
      // Sin baseline, fuente no intentada, o fuente que falló antes: no se inventa "nuevo".
      if (prevSourceStatus.get(curr.source) === 'success') {
        pushChange(changes, { category: 'new', stable_key: key, source: curr.source, title: curr.title });
      }
      continue;
    }
    if (prev.deadline !== curr.deadline) {
      pushChange(changes, {
        category: 'deadline_changed', stable_key: key, source: curr.source, before: prev.deadline, after: curr.deadline,
      });
    }
    if (normalizeFitBand(prev.fit_band) !== normalizeFitBand(curr.fit_band)) {
      pushChange(changes, {
        category: 'fit_changed',
        stable_key: key,
        source: curr.source,
        before: prev.fit_band,
        after: curr.fit_band,
        reason: curr.fit_reasons[0] ?? null,
      });
    }
  }

  const previousKeysSorted = [...prevCandidates.keys()].sort(compareStrings);
  const previousFinishedAtMs = Date.parse(previousSnapshot.finished_at);
  const currentFinishedAtMs = Date.parse(currentSnapshot.finished_at);
  for (const key of previousKeysSorted) {
    const prev = prevCandidates.get(key);
    // Vencido exige éxito de la MISMA fuente en ambas corridas. Si la fuente falló (o no se
    // intentó) en la corrida actual, la ausencia del candidato no prueba nada sobre su cierre.
    if (currSourceStatus.get(prev.source) !== 'success') continue;
    const curr = currCandidates.get(key);
    const effectiveDeadline = curr ? curr.deadline : prev.deadline;
    if (effectiveDeadline === null) continue; // sin fecha de cierre conocida: no hay cruce que verificar
    const closesAtMs = deadlineClosesAtMs(effectiveDeadline);
    // El cruce es verificable: el cierre debía seguir vigente en la corrida anterior y haber
    // quedado atrás para la corrida actual. Una ausencia sin este cruce NUNCA se llama "vencido".
    const crossed = closesAtMs >= previousFinishedAtMs && closesAtMs < currentFinishedAtMs;
    if (!crossed) continue;
    pushChange(changes, {
      category: 'expired', stable_key: key, source: prev.source, deadline: effectiveDeadline, still_listed: Boolean(curr),
    });
  }
}

function sortChanges(changes) {
  changes.sort((a, b) => {
    const orderDiff = AGT002_RADAR_RUN_DELTA_CATEGORIES.indexOf(a.category) - AGT002_RADAR_RUN_DELTA_CATEGORIES.indexOf(b.category);
    if (orderDiff !== 0) return orderDiff;
    return compareStrings(a.stable_key ?? a.source, b.stable_key ?? b.source);
  });
}

function buildCounts(changes) {
  const counts = Object.fromEntries(AGT002_RADAR_RUN_DELTA_CATEGORIES.map((category) => [category, 0]));
  for (const change of changes) counts[change.category] += 1;
  return Object.freeze(counts);
}

/**
 * Compara el snapshot de la corrida actual contra el de la corrida anterior (o `null`/`undefined`
 * si no hay baseline todavía) y produce un reporte de cambios determinístico.
 *
 * Si la corrida actual no tiene baseline, o si una fuente falló/no fue intentada en alguno de los
 * dos lados, esta función simplemente no genera cambios de candidato para esa fuente — nunca los
 * inventa. Eventos de salud de fuente (`source_recovered`/`source_degraded`) sí se evalúan siempre
 * que haya baseline, incluso si la corrida actual falló por completo.
 */
export function computeAgt002RadarRunDelta(previousSnapshot, currentSnapshot) {
  validateSnapshot(currentSnapshot, 'current');
  const baselineAvailable = previousSnapshot !== null && previousSnapshot !== undefined;
  if (baselineAvailable) validateSnapshot(previousSnapshot, 'previous');

  const changes = [];
  if (baselineAvailable) {
    computeSourceHealthEvents(previousSnapshot, currentSnapshot, changes);
    computeCandidateChanges(previousSnapshot, currentSnapshot, changes);
  }
  sortChanges(changes);

  return Object.freeze({
    run: runSummary(currentSnapshot),
    previous_run: baselineAvailable ? runSummary(previousSnapshot) : null,
    baseline_available: baselineAvailable,
    counts: buildCounts(changes),
    changes: Object.freeze(changes),
  });
}

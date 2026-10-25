// AGT-002 Radar — recibo de corrida (Corte 2, mitad backend). Función pura de construcción del
// recibo + adaptadores de persistencia idempotente reutilizando `psi_tender_radar_runs.errors`
// (jsonb, existente, nunca usado hasta ahora). Sin IO/fs/red en el constructor del recibo: el
// estado (`complete`/`partial`/`failed`) y los totales se derivan exclusivamente de lo que el
// llamador reporta por fuente, que a su vez debe venir de datos reales del pipeline (diagnostics
// de `fetchPublicTenderRadar`), nunca de un contador inventado aquí.

export const AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION = 'agt002-radar-run-receipt-v1';

export const AGT002_RADAR_RUN_RECEIPT_STATUSES = Object.freeze(['complete', 'partial', 'failed']);

export const AGT002_RADAR_RUN_RECEIPT_HISTORY_MAX = 10;

// Fail-safe exigido por el encargo: la ausencia de candidatos de una fuente que falló o de una
// corrida parcial/fallida nunca puede leerse como cierre, remoción o descarte de licitaciones. Sólo
// significa que esa fuente no fue leída (o no se terminó de leer) en esta corrida concreta.
export const AGT002_RADAR_RUN_RECEIPT_ABSENCE_NOTICE =
  'Corrida parcial o fallida: la ausencia de candidatos de una fuente que no terminó no puede interpretarse como cierre, remoción o descarte. Sólo significa que esa fuente no fue leída (o no terminó de leerse) en esta corrida.';

const MAX_SANITIZED_ERROR_LENGTH = 500;
const BEARER_RE = /\bBearer\s+\S+/gi;
// 'authorization' is deliberately excluded here: "Authorization: Bearer <token>" is handled by
// BEARER_RE above (applied first), and letting this pattern also match the literal word
// "Authorization:" would swallow the "Bearer" marker into a redundant, confusing redaction.
const SECRET_KV_RE = /\b(token|apikey|api[_-]?key|secret|password|passwd)\b\s*[:=]\s*[^\s&"'<>]+/gi;
const QUERY_STRING_RE = /\?[^\s"'<>]+/g;

// Sanitiza un mensaje de error antes de que entre al recibo: redacta tokens/apikeys/secrets/
// passwords/Authorization y descarta cualquier query string (puede traer credenciales en la URL),
// y acota la longitud. Nunca lanza; una entrada no-string o vacía produce `null`.
export function sanitizeAgt002RadarRunReceiptErrorMessage(message) {
  const text = message instanceof Error ? message.message : message;
  if (typeof text !== 'string' || !text.trim()) return null;
  let sanitized = text
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(SECRET_KV_RE, (_match, key) => `${key}=[REDACTED]`)
    .replace(QUERY_STRING_RE, '?[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) return null;
  if (sanitized.length > MAX_SANITIZED_ERROR_LENGTH) sanitized = `${sanitized.slice(0, MAX_SANITIZED_ERROR_LENGTH)}…`;
  return sanitized;
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// Una fuente no exitosa nunca puede aportar records_read/candidates_found: no hay dato parcial
// confiable que reportar más allá de haber sido intentada, así que esos contadores se fuerzan a 0
// sin importar lo que el llamador haya pasado. pages_read sí se conserva tal como lo reporta el
// llamador porque mide intentos de lectura (siempre 1 por fuente intentada en la orquestación
// actual), no resultado.
function normalizeAgt002RadarRunReceiptSource(source) {
  if (!source || typeof source !== 'object' || typeof source.name !== 'string' || !source.name.trim()) {
    throw new Error('AGT002_RADAR_RUN_RECEIPT_SOURCE_NAME_REQUIRED');
  }
  const attempted = source.attempted !== false;
  const succeeded = attempted && source.succeeded === true;
  return Object.freeze({
    name: source.name,
    attempted,
    succeeded,
    pages_read: attempted ? nonNegativeInt(source.pages_read) : 0,
    records_read: succeeded ? nonNegativeInt(source.records_read) : 0,
    candidates_found: succeeded ? nonNegativeInt(source.candidates_found) : 0,
    error: attempted && !succeeded ? sanitizeAgt002RadarRunReceiptErrorMessage(source.error) : null,
  });
}

function isValidRfc3339(value) {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

// Construye el recibo de una corrida real del Radar a partir de lo que el pipeline reportó por
// fuente. Pura y determinística: mismo input -> mismo output, sin lecturas de reloj (hora actual)
// internas, sin IO. Reglas de estado exigidas por el encargo:
//   - 'complete' sólo si hubo al menos una fuente intentada y TODAS las intentadas terminaron
//     (ninguna en `failed`).
//   - 'partial' si al menos una fuente falló y al menos una terminó.
//   - 'failed' si todas las intentadas fallaron, si no se intentó ninguna fuente, o si se declara
//     `fatalError` (corrida fatal: la corrida completa no terminó, sin importar cuántas fuentes
//     hubieran reportado éxito hasta ese punto).
export function buildAgt002RadarRunReceipt({ runId, startedAt, finishedAt, sources = [], fatalError = null } = {}) {
  if (typeof runId !== 'string' || !runId.trim()) throw new Error('AGT002_RADAR_RUN_RECEIPT_RUN_ID_REQUIRED');
  if (!isValidRfc3339(startedAt)) throw new Error('AGT002_RADAR_RUN_RECEIPT_STARTED_AT_INVALID');
  if (!isValidRfc3339(finishedAt)) throw new Error('AGT002_RADAR_RUN_RECEIPT_FINISHED_AT_INVALID');
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error('AGT002_RADAR_RUN_RECEIPT_FINISHED_BEFORE_STARTED');
  if (!Array.isArray(sources)) throw new Error('AGT002_RADAR_RUN_RECEIPT_SOURCES_INVALID');

  const normalizedSources = sources.map(normalizeAgt002RadarRunReceiptSource);
  const attempted = normalizedSources.filter(source => source.attempted);
  const succeeded = attempted.filter(source => source.succeeded);
  const failed = attempted.filter(source => !source.succeeded);

  let status;
  if (fatalError) status = 'failed';
  else if (attempted.length === 0) status = 'failed';
  else if (failed.length === 0) status = 'complete';
  else if (succeeded.length === 0) status = 'failed';
  else status = 'partial';

  const totals = attempted.reduce((acc, source) => {
    acc.pages_read += source.pages_read;
    acc.records_read += source.records_read;
    acc.candidates_found += source.candidates_found;
    return acc;
  }, { pages_read: 0, records_read: 0, candidates_found: 0 });

  return Object.freeze({
    schema_version: AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION,
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    sources_attempted: Object.freeze(attempted.map(source => source.name)),
    sources_succeeded: Object.freeze(succeeded.map(source => source.name)),
    sources_failed: Object.freeze(failed.map(source => source.name)),
    sources: Object.freeze(normalizedSources),
    totals: Object.freeze(totals),
    fatal_error: sanitizeAgt002RadarRunReceiptErrorMessage(fatalError),
    absence_notice: status === 'complete' ? null : AGT002_RADAR_RUN_RECEIPT_ABSENCE_NOTICE,
  });
}

function requireDatabase(database) {
  if (!database || typeof database.from !== 'function') throw new Error('AGT002_RADAR_RUN_RECEIPT_DATABASE_REQUIRED');
  return database;
}

// Escritura idempotente por run_id: usa `id` (PK existente, uuid) como run_id y hace upsert con
// onConflict:'id'. Dos escrituras con el mismo run_id nunca producen dos filas: la segunda
// reemplaza el mismo registro en vez de duplicarlo. Reutiliza la tabla y columna `errors`
// existentes (`psi_tender_radar_runs`); no requiere migración.
export async function recordAgt002RadarRunReceipt(database, receipt, extraRow = {}) {
  requireDatabase(database);
  if (!receipt || typeof receipt !== 'object' || typeof receipt.run_id !== 'string' || !receipt.run_id) {
    throw new Error('AGT002_RADAR_RUN_RECEIPT_INVALID');
  }
  const row = {
    ...extraRow,
    id: receipt.run_id,
    run_at: extraRow.run_at || receipt.finished_at || receipt.started_at,
    errors: receipt,
  };
  const response = await database.from('psi_tender_radar_runs').upsert(row, { onConflict: 'id' });
  if (response?.error) throw response.error;
  return receipt;
}

function normalizeStoredAgt002RadarRunReceipt(row) {
  const receipt = row?.errors;
  if (!receipt || typeof receipt !== 'object' || receipt.schema_version !== AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION) return null;
  return receipt;
}

// `psi_tender_radar_runs` es compartida con escritores ajenos al recibo de corrida (por ejemplo
// `mode:'company_profile'`, ver `getTenderCompanyProfile` en server/index.js), que insertan filas
// sin `errors`/con `errors` ajeno y pueden quedar con `run_at` más reciente que la última corrida
// real del Radar. El filtro se aplica en la base (jsonb ->> ) para que esas filas ajenas nunca
// oculten ni recorten un recibo real: "más reciente" siempre significa "la fila con recibo válido
// más reciente", no "la fila más reciente de la tabla, sea cual sea su origen".
const RECEIPT_SCHEMA_FILTER_COLUMN = 'errors->>schema_version';

// Lectura de sólo lectura de la última corrida. Devuelve `null` únicamente cuando NINGUNA fila de
// `psi_tender_radar_runs` trae todavía un recibo válido; nunca por culpa de filas más nuevas de
// otro modo/origen sin recibo.
export async function readLatestAgt002RadarRunReceipt(database) {
  requireDatabase(database);
  const response = await database.from('psi_tender_radar_runs').select('id,run_at,errors')
    .eq(RECEIPT_SCHEMA_FILTER_COLUMN, AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION)
    .order('run_at', { ascending: false }).limit(1).maybeSingle();
  if (response?.error) throw response.error;
  return normalizeStoredAgt002RadarRunReceipt(response?.data);
}

// Historial de sólo lectura, acotado SIEMPRE a un máximo de 10 sin importar lo que pida el
// llamador. El filtro por schema_version se aplica en la base ANTES del límite: las 10 filas
// devueltas son siempre las 10 corridas reales más recientes, nunca menos porque filas de otro
// modo/origen sin recibo se hayan colado en la ventana.
export async function readAgt002RadarRunReceiptHistory(database, { limit = AGT002_RADAR_RUN_RECEIPT_HISTORY_MAX } = {}) {
  requireDatabase(database);
  const requested = Number.isInteger(limit) && limit > 0 ? limit : AGT002_RADAR_RUN_RECEIPT_HISTORY_MAX;
  const clampedLimit = Math.min(AGT002_RADAR_RUN_RECEIPT_HISTORY_MAX, requested);
  const response = await database.from('psi_tender_radar_runs').select('id,run_at,errors')
    .eq(RECEIPT_SCHEMA_FILTER_COLUMN, AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION)
    .order('run_at', { ascending: false }).limit(clampedLimit);
  if (response?.error) throw response.error;
  return (response?.data || []).map(normalizeStoredAgt002RadarRunReceipt).filter(Boolean);
}

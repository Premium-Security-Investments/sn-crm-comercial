// AGT-002 Radar — persistencia idempotente del snapshot de corrida (Corte 3, mitad backend).
//
// Adaptador de IO que envuelve el dominio puro de agt002-radar-run-delta.js (ya validado) con
// lectura/escritura real contra `psi_tender_radar_runs`, reutilizando exactamente el mismo patrón
// de recibo del Corte 2 (misma tabla, mismo upsert onConflict:'id' por run_id, sin migración): el
// snapshot queda anidado dentro de la misma columna `errors` jsonb, junto al recibo existente si lo
// hay, sin borrarlo nunca.
import { computeAgt002RadarRunDelta } from './agt002-radar-run-delta.js';

export const AGT002_RADAR_RUN_DELTA_SNAPSHOT_SCHEMA_VERSION = 'agt002-radar-run-delta-v1';

function requireDatabase(database) {
  if (!database || typeof database.from !== 'function') throw new Error('AGT002_RADAR_RUN_DELTA_PERSISTENCE_DATABASE_REQUIRED');
  return database;
}

// Escritura idempotente por run_id: lee la fila existente (si la hay, p.ej. el recibo del Corte 2
// ya escrito para esta misma corrida) y fusiona el snapshot dentro de la misma columna `errors`,
// sin tocar ningún otro campo que ya estuviera ahí. Fail-closed: un snapshot con forma inválida
// (fuera del allowlist cerrado del dominio puro) lanza antes de tocar la base, nunca se persiste ni
// parcialmente.
export async function recordAgt002RadarRunSnapshot(database, snapshot) {
  requireDatabase(database);
  // Reutiliza la validación de forma cerrada de `computeAgt002RadarRunDelta` (sin baseline, sólo
  // para validar `snapshot` como "current"); el delta resultante se descarta.
  computeAgt002RadarRunDelta(null, snapshot);
  const { data: existing, error: readError } = await database.from('psi_tender_radar_runs')
    .select('id,run_at,errors').eq('id', snapshot.run_id).maybeSingle();
  if (readError) throw readError;
  const row = {
    id: snapshot.run_id,
    run_at: existing?.run_at || snapshot.finished_at,
    errors: {
      ...(existing?.errors || {}),
      radar_run_snapshot_schema_version: AGT002_RADAR_RUN_DELTA_SNAPSHOT_SCHEMA_VERSION,
      radar_run_snapshot: snapshot,
    },
  };
  const response = await database.from('psi_tender_radar_runs').upsert(row, { onConflict: 'id' });
  if (response?.error) throw response.error;
  return snapshot;
}

// `psi_tender_radar_runs` es compartida con escritores ajenos al snapshot (otros modos/recibos sin
// snapshot todavía); el filtro se aplica en la base (jsonb ->> ) para que esas filas nunca se cuelen
// como `latest`/`previous` ni oculten una corrida real más vieja pero con snapshot válido.
const SNAPSHOT_SCHEMA_FILTER_COLUMN = 'errors->>radar_run_snapshot_schema_version';

function normalizeStoredAgt002RadarRunSnapshot(row) {
  const errors = row?.errors;
  if (!errors || typeof errors !== 'object') return null;
  if (errors.radar_run_snapshot_schema_version !== AGT002_RADAR_RUN_DELTA_SNAPSHOT_SCHEMA_VERSION) return null;
  return errors.radar_run_snapshot || null;
}

// Lectura de sólo lectura de las DOS corridas con snapshot válido más recientes. Nunca valida la
// forma del snapshot leído (esa responsabilidad fail-closed vive en `computeAgt002RadarRunDelta`,
// a cargo de quien consuma el par); esta función sólo decide qué filas cuentan como "con snapshot".
//
// El filtro por schema_version se envía a la base, pero nunca se confía únicamente en que el
// backend lo haya aplicado (un PostgREST real lo hace, pero no todo adaptador de pruebas lo
// respeta): se vuelve a comprobar en proceso, fila por fila, antes de ordenar y recortar a las dos
// más recientes. Por eso tampoco se pide `.limit(2)` a la base -- un límite aplicado antes de este
// segundo filtrado podría recortar filas ajenas y esconder una corrida real más vieja.
export async function readAgt002RadarRunDeltaPair(database) {
  requireDatabase(database);
  const response = await database.from('psi_tender_radar_runs').select('id,run_at,errors')
    .eq(SNAPSHOT_SCHEMA_FILTER_COLUMN, AGT002_RADAR_RUN_DELTA_SNAPSHOT_SCHEMA_VERSION)
    .order('run_at', { ascending: false });
  if (response?.error) throw response.error;
  const rows = response?.data || [];
  const withSnapshot = rows
    .map((row) => ({ run_at: row?.run_at, snapshot: normalizeStoredAgt002RadarRunSnapshot(row) }))
    .filter((entry) => entry.snapshot !== null)
    .sort((a, b) => String(b.run_at).localeCompare(String(a.run_at)))
    .slice(0, 2);
  return {
    latest: withSnapshot[0]?.snapshot || null,
    previous: withSnapshot[1]?.snapshot || null,
  };
}
